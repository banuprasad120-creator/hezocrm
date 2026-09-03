
CREATE TYPE public.attendance_status AS ENUM ('Present','Late','Half Day','Absent','Leave');

CREATE TABLE public.attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  work_date date NOT NULL DEFAULT CURRENT_DATE,
  clock_in timestamptz,
  clock_out timestamptz,
  break_seconds integer NOT NULL DEFAULT 0,
  break_started_at timestamptz,
  status public.attendance_status NOT NULL DEFAULT 'Present',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date)
);

CREATE INDEX idx_attendance_company_date ON public.attendance (company_id, work_date DESC);

GRANT SELECT, INSERT, UPDATE ON public.attendance TO authenticated;
GRANT ALL ON public.attendance TO service_role;

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attendance visible" ON public.attendance FOR SELECT TO authenticated
USING (
  (SELECT private.is_super_admin())
  OR (company_id = (SELECT private.current_company_id())
      AND ((SELECT private.is_company_admin()) OR employee_id = (SELECT auth.uid())))
);

CREATE POLICY "employees create own attendance" ON public.attendance FOR INSERT TO authenticated
WITH CHECK (employee_id = (SELECT auth.uid()) AND company_id = (SELECT private.current_company_id()));

CREATE POLICY "employees update own attendance" ON public.attendance FOR UPDATE TO authenticated
USING (
  (SELECT private.is_super_admin())
  OR (company_id = (SELECT private.current_company_id())
      AND ((SELECT private.is_company_admin()) OR employee_id = (SELECT auth.uid())))
)
WITH CHECK (
  (SELECT private.is_super_admin())
  OR (company_id = (SELECT private.current_company_id())
      AND ((SELECT private.is_company_admin()) OR employee_id = (SELECT auth.uid())))
);

CREATE OR REPLACE FUNCTION private.touch_attendance_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = private, public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.touch_attendance_updated_at() FROM PUBLIC, anon;

CREATE TRIGGER trg_attendance_updated_at BEFORE UPDATE ON public.attendance
FOR EACH ROW EXECUTE FUNCTION private.touch_attendance_updated_at();
