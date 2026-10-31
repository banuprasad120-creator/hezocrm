-- Migration: Live Priority Auto Assignment
-- 1. Add priority column to leads with HIGH, MEDIUM, LOW constraint
ALTER TABLE public.leads
ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'LOW';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_leads_priority'
  ) THEN
    ALTER TABLE public.leads
    ADD CONSTRAINT chk_leads_priority CHECK (priority IN ('HIGH', 'MEDIUM', 'LOW'));
  END IF;
END $$;

-- 2. Index for prioritized queue (HIGH=1, MEDIUM=2, LOW=3)
CREATE INDEX IF NOT EXISTS idx_leads_priority_queue ON public.leads (
  company_id,
  (CASE priority WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END),
  created_at ASC
) WHERE assigned_to IS NULL AND status = 'New' AND last_call_at IS NULL;

-- 3. Update allocate_lead_batch to assign leads ordered strictly by priority (HIGH first)
CREATE OR REPLACE FUNCTION public.allocate_lead_batch(
  p_company_id uuid,
  p_employee_id uuid,
  p_batch_size integer DEFAULT 100,
  p_source text DEFAULT 'MANUAL',
  p_allow_when_pending boolean DEFAULT false,
  p_folder_date text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_ids uuid[];
  v_lead_mobiles text[];
  v_batch_num integer;
  v_allocated_count integer := 0;
  v_now timestamptz := clock_timestamp();
  v_batch_id uuid;
  v_lead_id uuid;
  v_pending_count integer := 0;
  v_auto_status text := 'RUNNING';
  v_auto_enabled boolean := true;
  v_company_batch_size integer := 100;
BEGIN
  -- Strict check: if auto assignment is STOPPED or PAUSED, block automatic batch refill or assignment
  SELECT COALESCE(auto_assign_status, 'RUNNING'), COALESCE(lead_batch_automation_enabled, true)
  INTO v_auto_status, v_auto_enabled
  FROM public.companies
  WHERE id = p_company_id;

  IF v_auto_status != 'RUNNING' AND p_source NOT IN ('MANUAL_ADMIN_DIRECT', 'MANUAL_DISTRIBUTE', 'ADMIN_MANUAL_ALLOCATION', 'ADMIN_TEST_REFILL') THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', v_auto_status,
      'message', 'Auto-assignment is currently ' || v_auto_status || ' by administrator. Automatic lead allocation is blocked.',
      'assigned_count', 0
    );
  END IF;

  IF NOT p_allow_when_pending THEN
    SELECT COUNT(*) INTO v_pending_count
    FROM public.leads
    WHERE company_id = p_company_id
      AND assigned_to = p_employee_id
      AND status IN ('New', 'Assigned');

    IF v_pending_count > 0 THEN
      RETURN jsonb_build_object(
        'success', false,
        'message', 'Agent still has ' || v_pending_count || ' pending leads in active batch',
        'assigned_count', 0,
        'pending_count', v_pending_count
      );
    END IF;
  END IF;

  SELECT COALESCE(MAX(batch_number), 0) + 1
  INTO v_batch_num
  FROM public.lead_batches
  WHERE company_id = p_company_id AND employee_id = p_employee_id;

  -- Select unassigned leads strictly prioritized: HIGH (1) -> MEDIUM (2) -> LOW (3)
  IF p_folder_date IS NOT NULL AND p_folder_date != '' AND p_folder_date != 'all' THEN
    SELECT ARRAY_AGG(id), ARRAY_AGG(mobile)
    INTO v_lead_ids, v_lead_mobiles
    FROM (
      SELECT id, mobile
      FROM public.leads
      WHERE company_id = p_company_id
        AND assigned_to IS NULL
        AND status = 'New'
        AND last_call_at IS NULL
        AND folder_date::text LIKE (p_folder_date || '%')
      ORDER BY
        CASE priority
          WHEN 'HIGH' THEN 1
          WHEN 'MEDIUM' THEN 2
          WHEN 'LOW' THEN 3
          ELSE 4
        END ASC,
        created_at ASC
      LIMIT GREATEST(1, p_batch_size)
      FOR UPDATE SKIP LOCKED
    ) t;
  ELSE
    SELECT ARRAY_AGG(id), ARRAY_AGG(mobile)
    INTO v_lead_ids, v_lead_mobiles
    FROM (
      SELECT id, mobile
      FROM public.leads
      WHERE company_id = p_company_id
        AND assigned_to IS NULL
        AND status = 'New'
        AND last_call_at IS NULL
      ORDER BY
        CASE priority
          WHEN 'HIGH' THEN 1
          WHEN 'MEDIUM' THEN 2
          WHEN 'LOW' THEN 3
          ELSE 4
        END ASC,
        created_at ASC
      LIMIT GREATEST(1, p_batch_size)
      FOR UPDATE SKIP LOCKED
    ) t;
  END IF;

  IF v_lead_ids IS NULL OR array_length(v_lead_ids, 1) IS NULL OR array_length(v_lead_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'No unassigned leads available in company',
      'assigned_count', 0,
      'batch_number', v_batch_num
    );
  END IF;

  v_allocated_count := array_length(v_lead_ids, 1);

  UPDATE public.leads
  SET assigned_to = p_employee_id,
      assigned_at = v_now,
      status = 'Assigned'
  WHERE id = ANY(v_lead_ids);

  IF v_lead_mobiles IS NOT NULL AND array_length(v_lead_mobiles, 1) > 0 THEN
    UPDATE public.leads
    SET assigned_to = p_employee_id,
        assigned_at = v_now,
        status = 'Assigned'
    WHERE company_id = p_company_id
      AND mobile = ANY(v_lead_mobiles)
      AND (assigned_to IS NULL OR assigned_to = p_employee_id);
  END IF;

  FOREACH v_lead_id IN ARRAY v_lead_ids
  LOOP
    INSERT INTO public.lead_assignments(lead_id, company_id, employee_id, assigned_by)
    VALUES (v_lead_id, p_company_id, p_employee_id, p_employee_id)
    ON CONFLICT DO NOTHING;
  END LOOP;

  INSERT INTO public.lead_batches(
    company_id, employee_id, batch_number, batch_size, assigned_count,
    lead_ids, status, assigned_at, assignment_source, created_by
  )
  VALUES (
    p_company_id, p_employee_id, v_batch_num, p_batch_size, v_allocated_count,
    to_jsonb(v_lead_ids), 'IN_PROGRESS', v_now, p_source, 'SYSTEM'
  )
  RETURNING id INTO v_batch_id;

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', v_batch_id,
    'batch_number', v_batch_num,
    'assigned_count', v_allocated_count,
    'batch_size', p_batch_size,
    'message', v_allocated_count || ' priority leads assigned in Batch #' || v_batch_num
  );
END;
$$;

-- 4. Live Priority Queue Processor
CREATE OR REPLACE FUNCTION public.process_live_priority_queue(
  p_company_id uuid,
  p_folder_date text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text := 'RUNNING';
  v_agent record;
  v_batch_size integer := 100;
  v_total_assigned integer := 0;
  v_allocated jsonb;
  v_high_waiting integer := 0;
  v_med_waiting integer := 0;
  v_low_waiting integer := 0;
  v_total_unassigned integer := 0;
  v_total_assigned_count integer := 0;
  v_agents_served integer := 0;
BEGIN
  -- 1. Check folder / company auto-assign state
  SELECT COALESCE(auto_assign_status, 'RUNNING'), COALESCE(agent_lead_batch_size, 100)
  INTO v_status, v_batch_size
  FROM public.companies
  WHERE id = p_company_id;

  -- 2. If PAUSED or STOPPED, do not assign! Save leads in queue.
  IF v_status != 'RUNNING' THEN
    SELECT
      COUNT(*) FILTER (WHERE priority = 'HIGH'),
      COUNT(*) FILTER (WHERE priority = 'MEDIUM'),
      COUNT(*) FILTER (WHERE priority = 'LOW'),
      COUNT(*)
    INTO v_high_waiting, v_med_waiting, v_low_waiting, v_total_unassigned
    FROM public.leads
    WHERE company_id = p_company_id
      AND assigned_to IS NULL
      AND status = 'New'
      AND last_call_at IS NULL
      AND (p_folder_date IS NULL OR folder_date::text = p_folder_date);

    RETURN jsonb_build_object(
      'success', true,
      'status', v_status,
      'assigned_count', 0,
      'high_priority_waiting', v_high_waiting,
      'medium_priority_waiting', v_med_waiting,
      'low_priority_waiting', v_low_waiting,
      'total_unassigned', v_total_unassigned,
      'message', 'Folder is ' || v_status || '. Leads safely queued by priority without auto-assignment.'
    );
  END IF;

  -- 3. If RUNNING: Assign leads prioritizing HIGH -> MEDIUM -> LOW
  FOR v_agent IN
    SELECT p.id, p.full_name
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'agent' AND ur.company_id = p_company_id
    WHERE p.company_id = p_company_id
      AND COALESCE(p.is_active, true) = true
    ORDER BY p.full_name ASC
  LOOP
    DECLARE
      v_agent_pending integer := 0;
    BEGIN
      SELECT COUNT(*) INTO v_agent_pending
      FROM public.leads
      WHERE company_id = p_company_id
        AND assigned_to = v_agent.id
        AND status IN ('New', 'Assigned');

      -- Only assign to available active agents who have room (do not interrupt ongoing calls)
      IF v_agent_pending = 0 THEN
        v_allocated := public.allocate_lead_batch(
          p_company_id, v_agent.id, v_batch_size, 'LIVE_PRIORITY_DISPATCH', true, p_folder_date
        );
        IF (v_allocated->>'assigned_count')::integer > 0 THEN
          v_total_assigned := v_total_assigned + (v_allocated->>'assigned_count')::integer;
          v_agents_served := v_agents_served + 1;
        END IF;
      END IF;
    END;
  END LOOP;

  -- 4. Calculate remaining queue counts
  SELECT
    COUNT(*) FILTER (WHERE priority = 'HIGH'),
    COUNT(*) FILTER (WHERE priority = 'MEDIUM'),
    COUNT(*) FILTER (WHERE priority = 'LOW'),
    COUNT(*)
  INTO v_high_waiting, v_med_waiting, v_low_waiting, v_total_unassigned
  FROM public.leads
  WHERE company_id = p_company_id
    AND assigned_to IS NULL
    AND status = 'New'
    AND last_call_at IS NULL
    AND (p_folder_date IS NULL OR folder_date::text = p_folder_date);

  SELECT COUNT(*)
  INTO v_total_assigned_count
  FROM public.leads
  WHERE company_id = p_company_id
    AND assigned_to IS NOT NULL
    AND (p_folder_date IS NULL OR folder_date::text = p_folder_date);

  RETURN jsonb_build_object(
    'success', true,
    'status', 'RUNNING',
    'assigned_count', v_total_assigned,
    'agents_served', v_agents_served,
    'high_priority_waiting', v_high_waiting,
    'medium_priority_waiting', v_med_waiting,
    'low_priority_waiting', v_low_waiting,
    'total_unassigned', v_total_unassigned,
    'total_assigned', v_total_assigned_count,
    'message', 'Live queue processed: ' || v_total_assigned || ' leads assigned across ' || v_agents_served || ' agents.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_live_priority_queue(uuid, text) TO authenticated, service_role;

-- 5. Stop auto-assignment: Default p_recall_uncontacted to TRUE to return uncontacted leads immediately
CREATE OR REPLACE FUNCTION public.stop_auto_assignment(
  p_company_id uuid,
  p_recall_uncontacted boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recalled_count integer := 0;
BEGIN
  UPDATE public.companies
  SET auto_assign_status = 'STOPPED',
      lead_batch_automation_enabled = false
  WHERE id = p_company_id;

  IF COALESCE(p_recall_uncontacted, true) THEN
    WITH recalled AS (
      UPDATE public.leads
      SET assigned_to = NULL,
          status = 'New',
          assigned_at = NULL
      WHERE company_id = p_company_id
        AND assigned_to IS NOT NULL
        AND status = 'Assigned'
        AND last_call_at IS NULL
      RETURNING id
    )
    SELECT COUNT(*) INTO v_recalled_count FROM recalled;

    UPDATE public.lead_batches
    SET status = 'COMPLETED', completed_at = clock_timestamp()
    WHERE company_id = p_company_id
      AND status = 'IN_PROGRESS';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'STOPPED',
    'recalled_count', v_recalled_count,
    'message', 'Auto-assign stopped' || CASE WHEN v_recalled_count > 0 THEN '. ' || v_recalled_count || ' uncontacted leads returned to unassigned pool.' ELSE '.' END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.stop_auto_assignment(uuid, boolean) TO authenticated, service_role;

-- 6. Trigger guards: check auto_assign_status before attempting refill
CREATE OR REPLACE FUNCTION public.check_and_refill_agent_batch_on_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending_count integer := 0;
  v_auto_enabled boolean := true;
  v_auto_status text := 'RUNNING';
  v_batch_size integer := 100;
  v_emp_active boolean := true;
BEGIN
  IF OLD.assigned_to IS NOT NULL AND (
    NEW.last_call_at IS DISTINCT FROM OLD.last_call_at OR
    (OLD.status IN ('New', 'Assigned') AND NEW.status NOT IN ('New', 'Assigned'))
  ) THEN
    SELECT COALESCE(lead_batch_automation_enabled, true), COALESCE(agent_lead_batch_size, 100), COALESCE(auto_assign_status, 'RUNNING')
    INTO v_auto_enabled, v_batch_size, v_auto_status
    FROM public.companies
    WHERE id = NEW.company_id;

    IF NOT v_auto_enabled OR v_auto_status != 'RUNNING' THEN
      RETURN NEW;
    END IF;

    SELECT COALESCE(is_active, true) INTO v_emp_active
    FROM public.profiles
    WHERE id = NEW.assigned_to;

    IF NOT v_emp_active THEN
      RETURN NEW;
    END IF;

    SELECT COUNT(*) INTO v_pending_count
    FROM public.leads
    WHERE company_id = NEW.company_id
      AND assigned_to = NEW.assigned_to
      AND status IN ('New', 'Assigned')
      AND id != NEW.id;

    IF v_pending_count = 0 THEN
      PERFORM public.allocate_lead_batch(NEW.company_id, NEW.assigned_to, v_batch_size, 'AUTO_BATCH_REFILL', false, NULL);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_and_refill_agent_batch_on_call()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending_count integer := 0;
  v_auto_enabled boolean := true;
  v_auto_status text := 'RUNNING';
  v_batch_size integer := 100;
  v_emp_active boolean := true;
BEGIN
  SELECT COALESCE(lead_batch_automation_enabled, true), COALESCE(agent_lead_batch_size, 100), COALESCE(auto_assign_status, 'RUNNING')
  INTO v_auto_enabled, v_batch_size, v_auto_status
  FROM public.companies
  WHERE id = NEW.company_id;

  IF NOT v_auto_enabled OR v_auto_status != 'RUNNING' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(is_active, true) INTO v_emp_active
  FROM public.profiles
  WHERE id = NEW.employee_id;

  IF NOT v_emp_active THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_pending_count
  FROM public.leads
  WHERE company_id = NEW.company_id
    AND assigned_to = NEW.employee_id
    AND status IN ('New', 'Assigned');

  IF v_pending_count = 0 THEN
    PERFORM public.allocate_lead_batch(NEW.company_id, NEW.employee_id, v_batch_size, 'AUTO_BATCH_REFILL', false, NULL);
  END IF;

  RETURN NEW;
END;
$$;


