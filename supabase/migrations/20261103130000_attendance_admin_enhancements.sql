-- =========================================================
-- ATTENDANCE ADMIN ENHANCEMENTS & MONTHLY TIMESHEET SUMMARY
-- =========================================================

CREATE OR REPLACE FUNCTION public.admin_mark_attendance(
  p_company_id uuid,
  p_employee_id uuid,
  p_work_date date,
  p_status text,
  p_action text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec record;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_rec
  FROM public.attendance
  WHERE company_id = p_company_id
    AND employee_id = p_employee_id
    AND work_date = p_work_date;

  IF p_action = 'CLOCK_IN' THEN
    IF v_rec.id IS NOT NULL THEN
      UPDATE public.attendance
      SET clock_in = COALESCE(clock_in, v_now),
          status = p_status::public.attendance_status,
          note = COALESCE(p_note, note),
          updated_at = v_now
      WHERE id = v_rec.id;
    ELSE
      INSERT INTO public.attendance (company_id, employee_id, work_date, clock_in, status, note)
      VALUES (p_company_id, p_employee_id, p_work_date, v_now, p_status::public.attendance_status, p_note);
    END IF;
  ELSIF p_action = 'CLOCK_OUT' THEN
    IF v_rec.id IS NOT NULL THEN
      UPDATE public.attendance
      SET clock_out = v_now,
          break_started_at = NULL,
          updated_at = v_now
      WHERE id = v_rec.id;
    END IF;
  ELSE
    -- Generic status update (Present, Late, Absent, Leave)
    IF v_rec.id IS NOT NULL THEN
      UPDATE public.attendance
      SET status = p_status::public.attendance_status,
          note = COALESCE(p_note, note),
          updated_at = v_now
      WHERE id = v_rec.id;
    ELSE
      INSERT INTO public.attendance (company_id, employee_id, work_date, status, note)
      VALUES (p_company_id, p_employee_id, p_work_date, p_status::public.attendance_status, p_note);
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'work_date', p_work_date, 'action', p_action);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mark_attendance(uuid, uuid, date, text, text, text) TO authenticated, service_role;

-- Team Monthly Attendance Summary RPC (Includes accurate absent calculation based on working days)
DROP FUNCTION IF EXISTS public.get_team_monthly_attendance_summary(uuid, integer, integer);

CREATE OR REPLACE FUNCTION public.get_team_monthly_attendance_summary(
  p_company_id uuid,
  p_year integer,
  p_month integer
)
RETURNS TABLE (
  employee_id uuid,
  full_name text,
  email text,
  total_working_days bigint,
  total_days_present bigint,
  total_days_late bigint,
  total_days_absent bigint,
  total_days_leave bigint,
  total_worked_seconds bigint,
  total_break_seconds bigint,
  days_in_month integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH month_range AS (
    SELECT 
      make_date(p_year, p_month, 1) AS start_date,
      (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date AS end_date
  ),
  agents AS (
    SELECT p.id, p.full_name, p.email
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE p.company_id = p_company_id
      AND p.is_active = true
      AND ur.role = 'agent'
  ),
  working_days AS (
    SELECT DISTINCT a.work_date AS day
    FROM public.attendance a
    CROSS JOIN month_range mr
    WHERE a.company_id = p_company_id
      AND a.work_date >= mr.start_date
      AND a.work_date <= mr.end_date
    UNION
    SELECT CURRENT_DATE AS day
    FROM month_range mr
    WHERE CURRENT_DATE >= mr.start_date
      AND CURRENT_DATE <= mr.end_date
      AND EXTRACT(ISODOW FROM CURRENT_DATE) != 7
  ),
  total_wd AS (
    SELECT COUNT(*)::bigint AS cnt FROM working_days
  ),
  agent_days AS (
    SELECT 
      ag.id AS employee_id,
      ag.full_name,
      ag.email,
      wd.day AS work_date,
      COALESCE(a.status::text, 'Absent') AS effective_status,
      a.clock_in,
      a.clock_out,
      COALESCE(a.break_seconds, 0) AS break_seconds
    FROM agents ag
    CROSS JOIN working_days wd
    LEFT JOIN public.attendance a 
      ON a.employee_id = ag.id 
     AND a.work_date = wd.day 
     AND a.company_id = p_company_id
  )
  SELECT 
    ag.id AS employee_id,
    ag.full_name,
    ag.email,
    (SELECT cnt FROM total_wd) AS total_working_days,
    COUNT(ad.effective_status) FILTER (WHERE ad.effective_status IN ('Present', 'Late', 'Half Day'))::bigint AS total_days_present,
    COUNT(ad.effective_status) FILTER (WHERE ad.effective_status = 'Late')::bigint AS total_days_late,
    COUNT(ad.effective_status) FILTER (WHERE ad.effective_status = 'Absent')::bigint AS total_days_absent,
    COUNT(ad.effective_status) FILTER (WHERE ad.effective_status = 'Leave')::bigint AS total_days_leave,
    COALESCE(SUM(
      CASE 
        WHEN ad.clock_in IS NOT NULL AND ad.clock_out IS NOT NULL THEN
          GREATEST(0, EXTRACT(EPOCH FROM (ad.clock_out - ad.clock_in))::bigint - ad.break_seconds)
        ELSE 0
      END
    ), 0)::bigint AS total_worked_seconds,
    COALESCE(SUM(ad.break_seconds), 0)::bigint AS total_break_seconds,
    EXTRACT(DAY FROM (SELECT end_date FROM month_range))::integer AS days_in_month
  FROM agents ag
  LEFT JOIN agent_days ad ON ad.employee_id = ag.id
  GROUP BY ag.id, ag.full_name, ag.email
  ORDER BY ag.full_name ASC, ag.email ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_team_monthly_attendance_summary(uuid, integer, integer) TO authenticated, service_role;

