-- Migration: Old and New Data Management
-- 1. Add existing_count, reassigned_count, strategy to lead_imports
ALTER TABLE public.lead_imports
ADD COLUMN IF NOT EXISTS existing_count integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS reassigned_count integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS strategy text DEFAULT 'retain';

-- 2. Function to handle existing / old leads actions safely
CREATE OR REPLACE FUNCTION public.handle_existing_leads_action(
  p_company_id uuid,
  p_admin_id uuid,
  p_lead_ids uuid[],
  p_action text, -- 'RETAIN', 'REASSIGN_TO_QUEUE', 'REASSIGN_TO_AGENT'
  p_target_folder text DEFAULT NULL,
  p_target_agent_id uuid DEFAULT NULL,
  p_append_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_processed_count integer := 0;
  v_lead_id uuid;
  v_now timestamptz := clock_timestamp();
  v_agent_name text;
BEGIN
  IF p_lead_ids IS NULL OR array_length(p_lead_ids, 1) IS NULL OR array_length(p_lead_ids, 1) = 0 THEN
    RETURN jsonb_build_object('success', true, 'count', 0, 'message', 'No leads selected');
  END IF;

  IF p_action = 'RETAIN' THEN
    -- Keep existing leads completely intact with existing agent, call history, and notes
    RETURN jsonb_build_object(
      'success', true,
      'count', array_length(p_lead_ids, 1),
      'message', 'Retained existing assignments for ' || array_length(p_lead_ids, 1) || ' leads.'
    );

  ELSIF p_action = 'REASSIGN_TO_QUEUE' THEN
    -- Move selected uncontacted leads back to the unassigned queue for the target folder
    -- Never touch leads that have already been called (last_call_at is not null)
    WITH updated AS (
      UPDATE public.leads
      SET assigned_to = NULL,
          status = 'New',
          assigned_at = NULL,
          folder_date = COALESCE(
            CASE WHEN p_target_folder IS NOT NULL AND p_target_folder != '' THEN p_target_folder::date ELSE NULL END,
            folder_date
          ),
          notes = CASE
            WHEN p_append_notes IS NOT NULL AND p_append_notes != '' THEN
              COALESCE(notes || E'\n', '') || p_append_notes
            ELSE notes
          END
      WHERE company_id = p_company_id
        AND id = ANY(p_lead_ids)
        AND last_call_at IS NULL
      RETURNING id
    )
    SELECT COUNT(*) INTO v_processed_count FROM updated;

    -- Record status history audit
    INSERT INTO public.lead_status_history (lead_id, company_id, old_status, new_status, changed_by, notes)
    SELECT id, p_company_id, 'Assigned', 'New', p_admin_id, 'Moved to unassigned folder queue via old data import'
    FROM public.leads
    WHERE company_id = p_company_id
      AND id = ANY(p_lead_ids)
      AND last_call_at IS NULL
    ON CONFLICT DO NOTHING;

    RETURN jsonb_build_object(
      'success', true,
      'count', v_processed_count,
      'message', v_processed_count || ' uncontacted old leads moved to folder queue.'
    );

  ELSIF p_action = 'REASSIGN_TO_AGENT' THEN
    IF p_target_agent_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'count', 0, 'message', 'Target agent is required for reassignment');
    END IF;

    SELECT COALESCE(full_name, email) INTO v_agent_name
    FROM public.profiles WHERE id = p_target_agent_id;

    WITH updated AS (
      UPDATE public.leads
      SET assigned_to = p_target_agent_id,
          status = 'Assigned',
          assigned_at = v_now,
          folder_date = COALESCE(
            CASE WHEN p_target_folder IS NOT NULL AND p_target_folder != '' THEN p_target_folder::date ELSE NULL END,
            folder_date
          ),
          notes = CASE
            WHEN p_append_notes IS NOT NULL AND p_append_notes != '' THEN
              COALESCE(notes || E'\n', '') || p_append_notes
            ELSE notes
          END
      WHERE company_id = p_company_id
        AND id = ANY(p_lead_ids)
        AND last_call_at IS NULL
      RETURNING id
    )
    SELECT COUNT(*) INTO v_processed_count FROM updated;

    -- Record assignment audit history for employee ownership changes
    FOREACH v_lead_id IN ARRAY p_lead_ids
    LOOP
      INSERT INTO public.lead_assignments(lead_id, company_id, employee_id, assigned_by, assigned_at)
      VALUES (v_lead_id, p_company_id, p_target_agent_id, p_admin_id, v_now)
      ON CONFLICT DO NOTHING;
    END LOOP;

    RETURN jsonb_build_object(
      'success', true,
      'count', v_processed_count,
      'message', v_processed_count || ' old leads reassigned to ' || COALESCE(v_agent_name, 'Agent') || '.'
    );
  END IF;

  RETURN jsonb_build_object('success', false, 'count', 0, 'message', 'Invalid action');
END;
$$;

GRANT EXECUTE ON FUNCTION public.handle_existing_leads_action(uuid, uuid, uuid[], text, text, uuid, text) TO authenticated, service_role;
