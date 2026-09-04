-- Migration to allow agents to insert their own assigned leads and assignments directly
DROP POLICY IF EXISTS "admins insert leads" ON public.leads;
DROP POLICY IF EXISTS "users insert leads" ON public.leads;

CREATE POLICY "users insert leads" ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT is_super_admin())
    OR (
      company_id = (SELECT current_company_id())
      AND (
        (SELECT is_company_admin())
        OR assigned_to = (SELECT auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "admins create assignments" ON public.lead_assignments;
DROP POLICY IF EXISTS "users create assignments" ON public.lead_assignments;

CREATE POLICY "users create assignments" ON public.lead_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT is_super_admin())
    OR (
      company_id = (SELECT current_company_id())
      AND (
        (SELECT is_company_admin())
        OR employee_id = (SELECT auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "agents create call history" ON public.call_history;
CREATE POLICY "agents create call history" ON public.call_history
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT is_super_admin())
    OR (
      company_id = (SELECT current_company_id())
      AND employee_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "agents create follow ups" ON public.follow_ups;
CREATE POLICY "agents create follow ups" ON public.follow_ups
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT is_super_admin())
    OR (
      company_id = (SELECT current_company_id())
      AND employee_id = (SELECT auth.uid())
    )
  );
