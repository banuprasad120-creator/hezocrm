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

-- Team Monthly Attendance Summary RPC
CREATE OR REPLACE FUNCTION public.get_team_monthly_attendance_summary(
  p_company_id uuid,
  p_year integer,
  p_month integer
)
RETURNS TABLE (
  employee_id uuid,
  full_name text,
  email text,
  total_days_present bigint,
  total_days_late bigint,
  total_days_absent bigint,
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
  att AS (
    SELECT 
      a.employee_id,
      COUNT(*) FILTER (WHERE a.status = 'Present' OR a.status = 'Late') AS present_count,
      COUNT(*) FILTER (WHERE a.status = 'Late') AS late_count,
      COUNT(*) FILTER (WHERE a.status = 'Absent') AS absent_count,
      COALESCE(SUM(
        CASE 
          WHEN a.clock_in IS NOT NULL AND a.clock_out IS NOT NULL THEN
            GREATEST(0, EXTRACT(EPOCH FROM (a.clock_out - a.clock_in))::bigint - a.break_seconds)
          ELSE 0
        END
      ), 0) AS worked_sec,
      COALESCE(SUM(a.break_seconds), 0)::bigint AS break_sec
    FROM public.attendance a
    CROSS JOIN month_range mr
    WHERE a.company_id = p_company_id
      AND a.work_date >= mr.start_date
      AND a.work_date <= mr.end_date
    GROUP BY a.employee_id
  )
  SELECT 
    ag.id AS employee_id,
    ag.full_name,
    ag.email,
    COALESCE(att.present_count, 0)::bigint AS total_days_present,
    COALESCE(att.late_count, 0)::bigint AS total_days_late,
    COALESCE(att.absent_count, 0)::bigint AS total_days_absent,
    COALESCE(att.worked_sec, 0)::bigint AS total_worked_seconds,
    COALESCE(att.break_sec, 0)::bigint AS total_break_seconds,
    EXTRACT(DAY FROM (mr.end_date))::integer AS days_in_month
  FROM agents ag
  CROSS JOIN month_range mr
  LEFT JOIN att ON att.employee_id = ag.id
  ORDER BY ag.full_name ASC, ag.email ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_team_monthly_attendance_summary(uuid, integer, integer) TO authenticated, service_role;
