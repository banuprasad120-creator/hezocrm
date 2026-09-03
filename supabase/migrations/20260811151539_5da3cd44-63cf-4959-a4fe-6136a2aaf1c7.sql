-- 1. Lock down SECURITY DEFINER functions
REVOKE ALL ON FUNCTION public.guard_lead_assignment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_lead_status_change() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_company_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_company_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_company_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_company_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

-- 2. call_history: explicitly immutable
REVOKE UPDATE, DELETE ON public.call_history FROM authenticated, anon;
CREATE POLICY "call history is immutable (no updates)"
  ON public.call_history FOR UPDATE TO authenticated, anon USING (false) WITH CHECK (false);
CREATE POLICY "call history is immutable (no deletes)"
  ON public.call_history FOR DELETE TO authenticated, anon USING (false);

-- 3. lead_status_history: system-written only
REVOKE INSERT, UPDATE, DELETE ON public.lead_status_history FROM authenticated, anon;
CREATE POLICY "status history written only by system triggers"
  ON public.lead_status_history FOR INSERT TO authenticated, anon WITH CHECK (false);
CREATE POLICY "status history is immutable (no updates)"
  ON public.lead_status_history FOR UPDATE TO authenticated, anon USING (false) WITH CHECK (false);
CREATE POLICY "status history is immutable (no deletes)"
  ON public.lead_status_history FOR DELETE TO authenticated, anon USING (false);

-- 4. companies: super admin only create/delete
CREATE POLICY "super admins create companies"
  ON public.companies FOR INSERT TO authenticated WITH CHECK (public.is_super_admin());
CREATE POLICY "super admins delete companies"
  ON public.companies FOR DELETE TO authenticated USING (public.is_super_admin());

-- 5. user_roles: controlled role management
GRANT INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;

CREATE POLICY "manage role grants"
  ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (
      public.is_company_admin()
      AND role = 'agent'::public.app_role
      AND company_id IS NOT NULL
      AND company_id = public.current_company_id()
    )
  );

CREATE POLICY "super admins update role grants"
  ON public.user_roles FOR UPDATE TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

CREATE POLICY "manage role revocations"
  ON public.user_roles FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.is_company_admin()
      AND role = 'agent'::public.app_role
      AND company_id IS NOT NULL
      AND company_id = public.current_company_id()
    )
  );