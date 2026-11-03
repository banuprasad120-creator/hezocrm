-- Migration: Lead Taking Tracker
-- 1. Add taking_status and action timestamps to public.leads
ALTER TABLE public.leads
ADD COLUMN IF NOT EXISTS taking_status text DEFAULT 'Assigned',
ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
ADD COLUMN IF NOT EXISTS started_working_at timestamptz,
ADD COLUMN IF NOT EXISTS completed_at timestamptz,
ADD COLUMN IF NOT EXISTS last_action_at timestamptz;

-- Ensure constraint on taking_status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_taking_status_check'
  ) THEN
    ALTER TABLE public.leads
    ADD CONSTRAINT leads_taking_status_check
    CHECK (taking_status IN ('Assigned', 'Accepted', 'In Progress', 'Completed', 'Follow-up Required'));
  END IF;
END $$;

-- Backfill taking_status for existing records cleanly
UPDATE public.leads
SET taking_status = CASE
      WHEN status IN ('Contacted', 'Interested', 'Not Interested', 'Approved', 'Disbursed', 'Closed', 'Documents Pending', 'Application Submitted') THEN 'Completed'
      WHEN status = 'Follow-up' THEN 'Follow-up Required'
      WHEN last_call_at IS NOT NULL THEN 'Completed'
      ELSE 'Assigned'
    END,
    accepted_at = CASE WHEN assigned_to IS NOT NULL THEN COALESCE(assigned_at, created_at) ELSE NULL END,
    started_working_at = last_call_at,
    completed_at = CASE WHEN status IN ('Contacted', 'Interested', 'Not Interested', 'Approved', 'Disbursed', 'Closed') THEN last_call_at ELSE NULL END,
    last_action_at = COALESCE(last_call_at, assigned_at, created_at)
WHERE taking_status IS NULL OR taking_status = 'Assigned';

-- 2. Create lead_taking_logs table to track every employee taking/working action
CREATE TABLE IF NOT EXISTS public.lead_taking_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  folder_id text,
  action text NOT NULL, -- 'ASSIGNED', 'ACCEPTED', 'OPENED', 'IN_PROGRESS', 'COMPLETED', 'FOLLOW_UP_REQUIRED'
  prev_status text,
  new_status text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Indexes for lightning-fast queries and monitoring aggregations
CREATE INDEX IF NOT EXISTS idx_leads_taking_status ON public.leads (company_id, taking_status);
CREATE INDEX IF NOT EXISTS idx_leads_emp_taking ON public.leads (company_id, assigned_to, taking_status);
CREATE INDEX IF NOT EXISTS idx_lead_taking_logs_company ON public.lead_taking_logs (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_taking_logs_emp ON public.lead_taking_logs (company_id, employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_taking_logs_lead ON public.lead_taking_logs (lead_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.lead_taking_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "lead_taking_logs_select"
ON public.lead_taking_logs FOR SELECT TO authenticated
USING (
  is_super_admin() OR
  (company_id = current_company_id() AND (is_company_admin() OR employee_id = auth.uid()))
);

CREATE POLICY "lead_taking_logs_insert"
ON public.lead_taking_logs FOR INSERT TO authenticated
WITH CHECK (
  is_super_admin() OR
  (company_id = current_company_id() AND (is_company_admin() OR employee_id = auth.uid()))
);

GRANT SELECT, INSERT ON public.lead_taking_logs TO authenticated;
GRANT ALL ON public.lead_taking_logs TO service_role;

-- Add to realtime publication if available
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_taking_logs;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 3. Core RPC function: record employee lead taking action
CREATE OR REPLACE FUNCTION public.record_lead_taking_action(
  p_company_id uuid,
  p_employee_id uuid,
  p_lead_ids uuid[],
  p_action text, -- 'ACCEPTED', 'OPENED', 'IN_PROGRESS', 'COMPLETED', 'FOLLOW_UP_REQUIRED'
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_new_taking_status text;
  v_processed_count integer := 0;
  v_rec record;
BEGIN
  IF p_lead_ids IS NULL OR array_length(p_lead_ids, 1) IS NULL OR array_length(p_lead_ids, 1) = 0 THEN
    RETURN jsonb_build_object('success', false, 'count', 0, 'message', 'No leads provided');
  END IF;

  -- Determine new taking status from action
  IF p_action = 'ACCEPTED' THEN
    v_new_taking_status := 'Accepted';
  ELSIF p_action IN ('OPENED', 'IN_PROGRESS') THEN
    v_new_taking_status := 'In Progress';
  ELSIF p_action = 'COMPLETED' THEN
    v_new_taking_status := 'Completed';
  ELSIF p_action = 'FOLLOW_UP_REQUIRED' THEN
    v_new_taking_status := 'Follow-up Required';
  ELSE
    RETURN jsonb_build_object('success', false, 'count', 0, 'message', 'Invalid action: ' || p_action);
  END IF;

  FOR v_rec IN
    SELECT id, folder_date, taking_status, status
    FROM public.leads
    WHERE company_id = p_company_id
      AND id = ANY(p_lead_ids)
      AND (assigned_to = p_employee_id OR is_company_admin() OR is_super_admin())
    FOR UPDATE
  LOOP
    -- Update lead status & action timestamps
    UPDATE public.leads
    SET taking_status = v_new_taking_status,
        accepted_at = CASE
          WHEN v_new_taking_status IN ('Accepted', 'In Progress') AND accepted_at IS NULL THEN v_now
          ELSE accepted_at
        END,
        started_working_at = CASE
          WHEN v_new_taking_status = 'In Progress' AND started_working_at IS NULL THEN v_now
          ELSE started_working_at
        END,
        completed_at = CASE
          WHEN v_new_taking_status = 'Completed' THEN v_now
          ELSE completed_at
        END,
        last_action_at = v_now
    WHERE id = v_rec.id;

    -- Insert audit log
    INSERT INTO public.lead_taking_logs (
      company_id,
      lead_id,
      employee_id,
      folder_id,
      action,
      prev_status,
      new_status,
      notes,
      created_at
    ) VALUES (
      p_company_id,
      v_rec.id,
      p_employee_id,
      v_rec.folder_date::text,
      p_action,
      COALESCE(v_rec.taking_status, 'Assigned'),
      v_new_taking_status,
      p_notes,
      v_now
    );

    v_processed_count := v_processed_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'count', v_processed_count,
    'action', p_action,
    'new_status', v_new_taking_status,
    'message', v_processed_count || ' lead(s) marked as ' || v_new_taking_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_lead_taking_action(uuid, uuid, uuid[], text, text) TO authenticated, service_role;

-- 4. Aggregated Admin Monitoring RPC
CREATE OR REPLACE FUNCTION public.get_lead_taking_summary(
  p_company_id uuid,
  p_folder_date text DEFAULT NULL,
  p_employee_id uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH agent_list AS (
    SELECT p.id as employee_id,
           COALESCE(p.full_name, p.email, 'Agent') as employee_name,
           p.email as employee_email,
           p.is_active
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE p.company_id = p_company_id
      AND ur.role = 'agent'
      AND (p_employee_id IS NULL OR p.id = p_employee_id)
  ),
  lead_counts AS (
    SELECT l.assigned_to as employee_id,
           COUNT(*) as total_assigned,
           COUNT(*) FILTER (WHERE l.taking_status IN ('Accepted', 'In Progress', 'Completed', 'Follow-up Required')) as total_accepted,
           COUNT(*) FILTER (WHERE l.taking_status = 'Assigned' OR l.taking_status IS NULL) as not_accepted,
           COUNT(*) FILTER (WHERE l.taking_status = 'In Progress') as in_progress,
           COUNT(*) FILTER (WHERE l.taking_status = 'Completed') as completed,
           COUNT(*) FILTER (WHERE l.taking_status = 'Follow-up Required') as follow_up_required,
           -- Idle: Accepted > 30 minutes ago but never started or called
           COUNT(*) FILTER (WHERE l.taking_status = 'Accepted' AND l.accepted_at < (clock_timestamp() - interval '30 minutes') AND l.last_call_at IS NULL) as idle_accepted_count,
           MAX(l.accepted_at) as last_lead_taken_at
    FROM public.leads l
    WHERE l.company_id = p_company_id
      AND l.assigned_to IS NOT NULL
      AND (p_folder_date IS NULL OR p_folder_date = 'all' OR l.folder_date::text = p_folder_date)
      AND (p_employee_id IS NULL OR l.assigned_to = p_employee_id)
      AND (p_date_from IS NULL OR l.created_at >= p_date_from)
      AND (p_date_to IS NULL OR l.created_at <= p_date_to)
    GROUP BY l.assigned_to
  ),
  aggregated AS (
    SELECT a.employee_id,
           a.employee_name,
           a.employee_email,
           a.is_active,
           COALESCE(lc.total_assigned, 0) as total_assigned,
           COALESCE(lc.total_accepted, 0) as total_accepted,
           COALESCE(lc.not_accepted, 0) as not_accepted,
           COALESCE(lc.in_progress, 0) as in_progress,
           COALESCE(lc.completed, 0) as completed,
           COALESCE(lc.follow_up_required, 0) as follow_up_required,
           COALESCE(lc.idle_accepted_count, 0) as idle_accepted_count,
           lc.last_lead_taken_at
    FROM agent_list a
    LEFT JOIN lead_counts lc ON lc.employee_id = a.employee_id
    ORDER BY total_assigned DESC, a.employee_name ASC
  )
  SELECT jsonb_build_object(
    'employees', COALESCE(jsonb_agg(to_jsonb(aggregated)), '[]'::jsonb),
    'totals', jsonb_build_object(
      'total_assigned', COALESCE(SUM(total_assigned), 0),
      'total_accepted', COALESCE(SUM(total_accepted), 0),
      'not_accepted', COALESCE(SUM(not_accepted), 0),
      'in_progress', COALESCE(SUM(in_progress), 0),
      'completed', COALESCE(SUM(completed), 0),
      'follow_up_required', COALESCE(SUM(follow_up_required), 0),
      'idle_accepted_count', COALESCE(SUM(idle_accepted_count), 0),
      'acceptance_rate', CASE WHEN COALESCE(SUM(total_assigned), 0) > 0
        THEN ROUND((COALESCE(SUM(total_accepted), 0)::numeric / SUM(total_assigned)::numeric) * 100, 1)
        ELSE 0 END
    )
  )
  INTO v_result
  FROM aggregated;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_lead_taking_summary(uuid, text, uuid, timestamptz, timestamptz) TO authenticated, service_role;

-- 5. RPC function to fetch detailed Lead Taking Activity Logs for Admin
CREATE OR REPLACE FUNCTION public.get_lead_taking_logs(
  p_company_id uuid,
  p_employee_id uuid DEFAULT NULL,
  p_folder_date text DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_logs jsonb;
  v_total integer := 0;
BEGIN
  SELECT COUNT(*) INTO v_total
  FROM public.lead_taking_logs ltl
  WHERE ltl.company_id = p_company_id
    AND (p_employee_id IS NULL OR ltl.employee_id = p_employee_id)
    AND (p_folder_date IS NULL OR p_folder_date = 'all' OR ltl.folder_id = p_folder_date)
    AND (p_action IS NULL OR p_action = 'ALL' OR ltl.action = p_action);

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  INTO v_logs
  FROM (
    SELECT ltl.id,
           ltl.lead_id,
           l.customer_name,
           l.mobile,
           l.loan_amount,
           l.loan_type,
           ltl.folder_id as folder_date,
           ltl.employee_id,
           COALESCE(p.full_name, p.email, 'Agent') as employee_name,
           p.email as employee_email,
           ltl.action,
           ltl.prev_status,
           ltl.new_status,
           ltl.notes,
           ltl.created_at
    FROM public.lead_taking_logs ltl
    LEFT JOIN public.leads l ON l.id = ltl.lead_id
    LEFT JOIN public.profiles p ON p.id = ltl.employee_id
    WHERE ltl.company_id = p_company_id
      AND (p_employee_id IS NULL OR ltl.employee_id = p_employee_id)
      AND (p_folder_date IS NULL OR p_folder_date = 'all' OR ltl.folder_id = p_folder_date)
      AND (p_action IS NULL OR p_action = 'ALL' OR ltl.action = p_action)
    ORDER BY ltl.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) t;

  RETURN jsonb_build_object(
    'total', v_total,
    'logs', v_logs
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_lead_taking_logs(uuid, uuid, text, text, integer, integer) TO authenticated, service_role;

