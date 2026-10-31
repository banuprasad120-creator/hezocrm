-- ====================================================================
-- Enterprise Suite Enhancements Migration
-- Auto-Assignment Tri-State Controls, Intelligent Distribution & Attendance
-- ====================================================================

-- 1. Companies Table Columns
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS auto_assign_status text NOT NULL DEFAULT 'RUNNING',
  ADD COLUMN IF NOT EXISTS lead_batch_automation_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS agent_lead_batch_size integer NOT NULL DEFAULT 100;

-- 2. Partial Performance Indexes
CREATE INDEX IF NOT EXISTS idx_leads_unassigned_pool ON public.leads(company_id, folder_date, created_at)
  WHERE assigned_to IS NULL AND status = 'New' AND last_call_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_leads_agent_pending ON public.leads(company_id, assigned_to, status)
  WHERE status IN ('New', 'Assigned');

CREATE INDEX IF NOT EXISTS idx_attendance_company_date ON public.attendance(company_id, work_date);

-- 3. Canonical allocate_lead_batch Function (with active check)
CREATE OR REPLACE FUNCTION public.allocate_lead_batch(
  p_company_id uuid,
  p_employee_id uuid,
  p_batch_size integer DEFAULT 100,
  p_source text DEFAULT 'AUTO_BATCH_REFILL'::text,
  p_allow_when_pending boolean DEFAULT false,
  p_folder_date text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_ids uuid[];
  v_lead_mobiles text[];
  v_batch_num integer := 1;
  v_allocated_count integer := 0;
  v_batch_id uuid;
  v_now timestamptz := now();
  v_lead_id uuid;
  v_pending_count integer := 0;
  v_is_active boolean := true;
BEGIN
  -- 0. Check if agent profile is active
  SELECT COALESCE(is_active, true) INTO v_is_active
  FROM public.profiles
  WHERE id = p_employee_id;

  IF NOT v_is_active THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Agent is marked inactive',
      'assigned_count', 0
    );
  END IF;

  -- 1. Check if agent already has uncompleted leads in status New or Assigned (unless allow_when_pending is true)
  IF NOT COALESCE(p_allow_when_pending, false) THEN
    SELECT COUNT(*) INTO v_pending_count
    FROM public.leads
    WHERE company_id = p_company_id
      AND assigned_to = p_employee_id
      AND status IN ('New', 'Assigned');

    IF v_pending_count > 0 THEN
      RETURN jsonb_build_object(
        'success', false,
        'message', 'Agent already has ' || v_pending_count || ' pending leads in current batch',
        'assigned_count', 0,
        'remaining_pending', v_pending_count
      );
    END IF;
  END IF;

  -- 2. Mark previous IN_PROGRESS batches for this agent as COMPLETED
  UPDATE public.lead_batches
  SET status = 'COMPLETED', completed_at = v_now
  WHERE company_id = p_company_id
    AND employee_id = p_employee_id
    AND status = 'IN_PROGRESS';

  -- 3. Calculate next batch number for this agent
  SELECT COALESCE(MAX(batch_number), 0) + 1 INTO v_batch_num
  FROM public.lead_batches
  WHERE company_id = p_company_id AND employee_id = p_employee_id;

  -- 4. Atomically select up to p_batch_size eligible UNASSIGNED leads using FOR UPDATE SKIP LOCKED
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
      ORDER BY folder_date DESC, created_at ASC
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
      ORDER BY folder_date DESC, created_at ASC
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

  -- 5. Update assigned leads
  UPDATE public.leads
  SET assigned_to = p_employee_id,
      assigned_at = v_now,
      status = 'Assigned'
  WHERE id = ANY(v_lead_ids);

  -- 6. Also lock duplicate mobile numbers in the company to this agent
  IF v_lead_mobiles IS NOT NULL AND array_length(v_lead_mobiles, 1) > 0 THEN
    UPDATE public.leads
    SET assigned_to = p_employee_id,
        assigned_at = v_now,
        status = 'Assigned'
    WHERE company_id = p_company_id
      AND mobile = ANY(v_lead_mobiles)
      AND (assigned_to IS NULL OR assigned_to = p_employee_id);
  END IF;

  -- 7. Record assignments in lead_assignments audit table
  FOREACH v_lead_id IN ARRAY v_lead_ids
  LOOP
    INSERT INTO public.lead_assignments(lead_id, company_id, employee_id, assigned_by)
    VALUES (v_lead_id, p_company_id, p_employee_id, p_employee_id)
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- 8. Create lead_batches record
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
    'message', v_allocated_count || ' new leads assigned in Batch #' || v_batch_num
  );
END;
$$;

-- 4. Start Auto-Assignment RPC (Immediate Refill for Zero-Lead Agents)
CREATE OR REPLACE FUNCTION public.start_auto_assignment(
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_size integer := 100;
  v_agent record;
  v_refilled_agents integer := 0;
  v_total_assigned integer := 0;
  v_alloc_res jsonb;
  v_pending integer;
BEGIN
  -- 1. Update company status to RUNNING
  UPDATE public.companies
  SET auto_assign_status = 'RUNNING',
      lead_batch_automation_enabled = true
  WHERE id = p_company_id
  RETURNING COALESCE(agent_lead_batch_size, 100) INTO v_batch_size;

  -- 2. Find all active agents in this company
  FOR v_agent IN
    SELECT p.id, p.full_name, p.email
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE p.company_id = p_company_id
      AND p.is_active = true
      AND ur.role = 'agent'
  LOOP
    -- Check if agent has 0 pending leads
    SELECT COUNT(*) INTO v_pending
    FROM public.leads
    WHERE company_id = p_company_id
      AND assigned_to = v_agent.id
      AND status IN ('New', 'Assigned');

    IF v_pending = 0 THEN
      v_alloc_res := public.allocate_lead_batch(p_company_id, v_agent.id, v_batch_size, 'START_AUTO_ASSIGN', false, NULL);
      IF (v_alloc_res->>'assigned_count')::integer > 0 THEN
        v_refilled_agents := v_refilled_agents + 1;
        v_total_assigned := v_total_assigned + (v_alloc_res->>'assigned_count')::integer;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'RUNNING',
    'agents_refilled', v_refilled_agents,
    'total_leads_assigned', v_total_assigned,
    'message', 'Auto-assign started. ' || v_refilled_agents || ' agents allocated ' || v_total_assigned || ' leads immediately.'
  );
END;
$$;

-- 5. Pause Auto-Assignment RPC
CREATE OR REPLACE FUNCTION public.pause_auto_assignment(
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.companies
  SET auto_assign_status = 'PAUSED',
      lead_batch_automation_enabled = false
  WHERE id = p_company_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'PAUSED',
    'message', 'Auto-assign paused. Background automatic refilling is on hold.'
  );
END;
$$;

-- 6. Stop Auto-Assignment RPC (with optional recall of uncontacted leads)
CREATE OR REPLACE FUNCTION public.stop_auto_assignment(
  p_company_id uuid,
  p_recall_uncontacted boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recalled_count integer := 0;
BEGIN
  -- 1. Update company status to STOPPED
  UPDATE public.companies
  SET auto_assign_status = 'STOPPED',
      lead_batch_automation_enabled = false
  WHERE id = p_company_id;

  -- 2. If recall requested: recall leads assigned but never called
  IF COALESCE(p_recall_uncontacted, false) THEN
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

    -- Update ongoing batches to reflect stoppage
    UPDATE public.lead_batches
    SET status = 'COMPLETED', completed_at = now()
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

-- 7. Distribute Leads Equally RPC (Manual or Controlled Batch Distribution)
CREATE OR REPLACE FUNCTION public.distribute_leads_equally(
  p_company_id uuid,
  p_agent_ids uuid[],
  p_leads_per_agent integer DEFAULT 100,
  p_folder_date text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent_id uuid;
  v_alloc_res jsonb;
  v_total_assigned integer := 0;
  v_successful_agents integer := 0;
  v_details jsonb := '[]'::jsonb;
BEGIN
  IF p_agent_ids IS NULL OR array_length(p_agent_ids, 1) IS NULL OR array_length(p_agent_ids, 1) = 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'No agents selected for distribution', 'total_assigned', 0);
  END IF;

  FOREACH v_agent_id IN ARRAY p_agent_ids
  LOOP
    v_alloc_res := public.allocate_lead_batch(p_company_id, v_agent_id, p_leads_per_agent, 'EQUAL_DISTRIBUTION', true, p_folder_date);
    v_details := v_details || jsonb_build_object('agent_id', v_agent_id, 'result', v_alloc_res);
    IF (v_alloc_res->>'assigned_count')::integer > 0 THEN
      v_successful_agents := v_successful_agents + 1;
      v_total_assigned := v_total_assigned + (v_alloc_res->>'assigned_count')::integer;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'agents_count', v_successful_agents,
    'total_assigned', v_total_assigned,
    'details', v_details,
    'message', 'Distributed ' || v_total_assigned || ' leads across ' || v_successful_agents || ' agents.'
  );
END;
$$;

-- 8. Get Team Attendance For Any Date (Including Absent Agents)
CREATE OR REPLACE FUNCTION public.get_team_attendance_by_date(
  p_company_id uuid,
  p_work_date date
)
RETURNS TABLE (
  employee_id uuid,
  full_name text,
  email text,
  attendance_id uuid,
  work_date date,
  clock_in timestamptz,
  clock_out timestamptz,
  break_seconds integer,
  break_started_at timestamptz,
  status text,
  note text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    p.id AS employee_id,
    p.full_name,
    p.email,
    a.id AS attendance_id,
    COALESCE(a.work_date, p_work_date) AS work_date,
    a.clock_in,
    a.clock_out,
    COALESCE(a.break_seconds, 0) AS break_seconds,
    a.break_started_at,
    COALESCE(a.status, 'Absent') AS status,
    a.note
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  LEFT JOIN public.attendance a 
    ON a.employee_id = p.id 
    AND a.work_date = p_work_date
  WHERE p.company_id = p_company_id
    AND p.is_active = true
    AND ur.role = 'agent'
  ORDER BY p.full_name ASC, p.email ASC;
$$;

-- 9. Permissions & Execution Grants
GRANT EXECUTE ON FUNCTION public.allocate_lead_batch(uuid, uuid, integer, text, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_auto_assignment(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pause_auto_assignment(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stop_auto_assignment(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.distribute_leads_equally(uuid, uuid[], integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_team_attendance_by_date(uuid, date) TO authenticated, service_role;

