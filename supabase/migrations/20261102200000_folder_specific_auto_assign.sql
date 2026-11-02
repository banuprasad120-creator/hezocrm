-- Migration: Folder-specific Auto Assignment Controls
-- 1. Add active_auto_assign_folder to companies table
ALTER TABLE public.companies
ADD COLUMN IF NOT EXISTS active_auto_assign_folder text DEFAULT NULL;

-- 2. Update allocate_lead_batch to respect active_auto_assign_folder
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
  v_now timestamptz := clock_timestamp();
  v_lead_id uuid;
  v_pending_count integer := 0;
  v_is_active boolean := true;
  v_auto_status text := 'RUNNING';
  v_auto_enabled boolean := true;
  v_company_active_folder text := NULL;
  v_effective_folder text := NULL;
BEGIN
  -- Strict check: auto assignment status & active folder
  SELECT COALESCE(auto_assign_status, 'RUNNING'), COALESCE(lead_batch_automation_enabled, true), active_auto_assign_folder
  INTO v_auto_status, v_auto_enabled, v_company_active_folder
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

  UPDATE public.lead_batches
  SET status = 'COMPLETED', completed_at = v_now
  WHERE company_id = p_company_id
    AND employee_id = p_employee_id
    AND status = 'IN_PROGRESS';

  SELECT COALESCE(MAX(batch_number), 0) + 1 INTO v_batch_num
  FROM public.lead_batches
  WHERE company_id = p_company_id AND employee_id = p_employee_id;

  -- Determine effective folder: explicit parameter > company active_auto_assign_folder
  v_effective_folder := COALESCE(
    CASE WHEN p_folder_date IS NOT NULL AND p_folder_date != '' AND p_folder_date != 'all' THEN p_folder_date ELSE NULL END,
    CASE WHEN v_company_active_folder IS NOT NULL AND v_company_active_folder != '' AND v_company_active_folder != 'all' THEN v_company_active_folder ELSE NULL END
  );

  IF v_effective_folder IS NOT NULL THEN
    SELECT ARRAY_AGG(id), ARRAY_AGG(mobile)
    INTO v_lead_ids, v_lead_mobiles
    FROM (
      SELECT id, mobile
      FROM public.leads
      WHERE company_id = p_company_id
        AND assigned_to IS NULL
        AND status = 'New'
        AND last_call_at IS NULL
        AND folder_date::text LIKE (v_effective_folder || '%')
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
      'message', 'No eligible unassigned leads available' || CASE WHEN v_effective_folder IS NOT NULL THEN ' in folder ' || v_effective_folder ELSE ' in company' END,
      'assigned_count', 0,
      'batch_number', v_batch_num,
      'folder', v_effective_folder
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
    'folder', v_effective_folder,
    'message', v_allocated_count || ' leads assigned in Batch #' || v_batch_num || CASE WHEN v_effective_folder IS NOT NULL THEN ' from folder ' || v_effective_folder ELSE '' END
  );
END;
$$;

-- 3. Function to start auto-assignment with folder target
CREATE OR REPLACE FUNCTION public.start_auto_assignment(
  p_company_id uuid,
  p_folder_date text DEFAULT NULL
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
  v_target_folder text := NULL;
BEGIN
  IF p_folder_date IS NOT NULL AND p_folder_date != '' AND p_folder_date != 'all' THEN
    v_target_folder := p_folder_date;
  ELSE
    SELECT active_auto_assign_folder INTO v_target_folder
    FROM public.companies WHERE id = p_company_id;
  END IF;

  UPDATE public.companies
  SET auto_assign_status = 'RUNNING',
      lead_batch_automation_enabled = true,
      active_auto_assign_folder = v_target_folder
  WHERE id = p_company_id
  RETURNING COALESCE(agent_lead_batch_size, 100) INTO v_batch_size;

  FOR v_agent IN
    SELECT p.id, p.full_name, p.email
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE p.company_id = p_company_id
      AND p.is_active = true
      AND ur.role = 'agent'
    ORDER BY p.full_name ASC
  LOOP
    SELECT COUNT(*) INTO v_pending
    FROM public.leads
    WHERE company_id = p_company_id
      AND assigned_to = v_agent.id
      AND status IN ('New', 'Assigned');

    IF v_pending = 0 THEN
      v_alloc_res := public.allocate_lead_batch(p_company_id, v_agent.id, v_batch_size, 'START_AUTO_ASSIGN', false, v_target_folder);
      IF (v_alloc_res->>'assigned_count')::integer > 0 THEN
        v_refilled_agents := v_refilled_agents + 1;
        v_total_assigned := v_total_assigned + (v_alloc_res->>'assigned_count')::integer;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'RUNNING',
    'folder', v_target_folder,
    'agents_refilled', v_refilled_agents,
    'total_leads_assigned', v_total_assigned,
    'message', 'Auto-assign started for ' || COALESCE('folder ' || v_target_folder, 'all folders') || '. ' || v_refilled_agents || ' agents allocated ' || v_total_assigned || ' leads immediately.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_auto_assignment(uuid, text) TO authenticated, service_role;

-- 4. Function to stop auto-assignment with folder-specific recall
CREATE OR REPLACE FUNCTION public.stop_auto_assignment(
  p_company_id uuid,
  p_recall_uncontacted boolean DEFAULT true,
  p_folder_date text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recalled_count integer := 0;
  v_target_folder text := NULL;
BEGIN
  IF p_folder_date IS NOT NULL AND p_folder_date != '' AND p_folder_date != 'all' THEN
    v_target_folder := p_folder_date;
  END IF;

  UPDATE public.companies
  SET auto_assign_status = 'STOPPED',
      lead_batch_automation_enabled = false
  WHERE id = p_company_id;

  IF COALESCE(p_recall_uncontacted, true) THEN
    IF v_target_folder IS NOT NULL THEN
      WITH recalled AS (
        UPDATE public.leads
        SET assigned_to = NULL,
            status = 'New',
            assigned_at = NULL
        WHERE company_id = p_company_id
          AND assigned_to IS NOT NULL
          AND status = 'Assigned'
          AND last_call_at IS NULL
          AND folder_date::text LIKE (v_target_folder || '%')
        RETURNING id
      )
      SELECT COUNT(*) INTO v_recalled_count FROM recalled;
    ELSE
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
    END IF;

    UPDATE public.lead_batches
    SET status = 'COMPLETED', completed_at = clock_timestamp()
    WHERE company_id = p_company_id
      AND status = 'IN_PROGRESS';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'STOPPED',
    'folder', v_target_folder,
    'recalled_count', v_recalled_count,
    'message', 'Auto-assign stopped' || CASE WHEN v_recalled_count > 0 THEN '. ' || v_recalled_count || ' uncontacted leads returned to unassigned pool.' ELSE '.' END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.stop_auto_assignment(uuid, boolean, text) TO authenticated, service_role;

-- 5. Function to set/switch the active auto-assign folder
CREATE OR REPLACE FUNCTION public.set_auto_assign_folder(
  p_company_id uuid,
  p_folder_date text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_batch_size integer := 100;
  v_target_folder text := NULL;
  v_refilled_agents integer := 0;
  v_total_assigned integer := 0;
  v_agent record;
  v_pending integer;
  v_alloc_res jsonb;
BEGIN
  IF p_folder_date IS NOT NULL AND p_folder_date != '' AND p_folder_date != 'all' THEN
    v_target_folder := p_folder_date;
  END IF;

  UPDATE public.companies
  SET active_auto_assign_folder = v_target_folder
  WHERE id = p_company_id
  RETURNING COALESCE(auto_assign_status, 'STOPPED'), COALESCE(agent_lead_batch_size, 100)
  INTO v_status, v_batch_size;

  -- If status is RUNNING, immediately trigger distribution from the newly selected folder for available agents
  IF v_status = 'RUNNING' THEN
    FOR v_agent IN
      SELECT p.id, p.full_name
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id
      WHERE p.company_id = p_company_id
        AND p.is_active = true
        AND ur.role = 'agent'
      ORDER BY p.full_name ASC
    LOOP
      SELECT COUNT(*) INTO v_pending
      FROM public.leads
      WHERE company_id = p_company_id
        AND assigned_to = v_agent.id
        AND status IN ('New', 'Assigned');

      IF v_pending = 0 THEN
        v_alloc_res := public.allocate_lead_batch(p_company_id, v_agent.id, v_batch_size, 'FOLDER_SWITCH_DISPATCH', false, v_target_folder);
        IF (v_alloc_res->>'assigned_count')::integer > 0 THEN
          v_refilled_agents := v_refilled_agents + 1;
          v_total_assigned := v_total_assigned + (v_alloc_res->>'assigned_count')::integer;
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'folder', v_target_folder,
    'status', v_status,
    'agents_refilled', v_refilled_agents,
    'total_assigned', v_total_assigned,
    'message', 'Auto-assign target set to ' || COALESCE('folder ' || v_target_folder, 'all folders') || CASE WHEN v_total_assigned > 0 THEN ' (' || v_total_assigned || ' leads assigned immediately).' ELSE '.' END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_auto_assign_folder(uuid, text) TO authenticated, service_role;

