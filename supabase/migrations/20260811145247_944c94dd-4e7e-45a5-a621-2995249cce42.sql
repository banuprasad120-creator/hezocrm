-- Wrap the role/company helpers in scalar subqueries so Postgres evaluates them
-- once per query (InitPlan) instead of once per row. Semantics are identical.

DROP POLICY IF EXISTS "leads visible to owner or admin" ON public.leads;
CREATE POLICY "leads visible to owner or admin" ON public.leads
  FOR SELECT TO authenticated
  USING ((SELECT is_super_admin()) OR (company_id = (SELECT current_company_id())
    AND ((SELECT is_company_admin()) OR assigned_to = (SELECT auth.uid()))));

DROP POLICY IF EXISTS "admins update any lead, agents own leads" ON public.leads;
CREATE POLICY "admins update any lead, agents own leads" ON public.leads
  FOR UPDATE TO authenticated
  USING ((SELECT is_super_admin()) OR (company_id = (SELECT current_company_id())
    AND ((SELECT is_company_admin()) OR assigned_to = (SELECT auth.uid()))))
  WITH CHECK ((SELECT is_super_admin()) OR (company_id = (SELECT current_company_id())
    AND ((SELECT is_company_admin()) OR assigned_to = (SELECT auth.uid()))));

DROP POLICY IF EXISTS "admins insert leads" ON public.leads;
CREATE POLICY "admins insert leads" ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT is_company_admin())
    AND ((SELECT is_super_admin()) OR company_id = (SELECT current_company_id())));

DROP POLICY IF EXISTS "admins delete leads" ON public.leads;
CREATE POLICY "admins delete leads" ON public.leads
  FOR DELETE TO authenticated
  USING ((SELECT is_super_admin()) OR ((SELECT is_company_admin()) AND company_id = (SELECT current_company_id())));

DROP POLICY IF EXISTS "assignments visible" ON public.lead_assignments;
CREATE POLICY "assignments visible" ON public.lead_assignments
  FOR SELECT TO authenticated
  USING ((SELECT is_super_admin()) OR (company_id = (SELECT current_company_id())
    AND ((SELECT is_company_admin()) OR employee_id = (SELECT auth.uid()))));

DROP POLICY IF EXISTS "admins create assignments" ON public.lead_assignments;
CREATE POLICY "admins create assignments" ON public.lead_assignments
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT is_company_admin())
    AND ((SELECT is_super_admin()) OR company_id = (SELECT current_company_id())));

DROP POLICY IF EXISTS "call history visible" ON public.call_history;
CREATE POLICY "call history visible" ON public.call_history
  FOR SELECT TO authenticated
  USING ((SELECT is_super_admin()) OR (company_id = (SELECT current_company_id())
    AND ((SELECT is_company_admin()) OR employee_id = (SELECT auth.uid()))));

DROP POLICY IF EXISTS "follow ups visible" ON public.follow_ups;
CREATE POLICY "follow ups visible" ON public.follow_ups
  FOR SELECT TO authenticated
  USING ((SELECT is_super_admin()) OR (company_id = (SELECT current_company_id())
    AND ((SELECT is_company_admin()) OR employee_id = (SELECT auth.uid()))));

DROP POLICY IF EXISTS "status history visible" ON public.lead_status_history;
CREATE POLICY "status history visible" ON public.lead_status_history
  FOR SELECT TO authenticated
  USING ((SELECT is_super_admin()) OR (company_id = (SELECT current_company_id())
    AND ((SELECT is_company_admin()) OR employee_id = (SELECT auth.uid())
      OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_status_history.lead_id AND l.assigned_to = (SELECT auth.uid())))));

DROP POLICY IF EXISTS "import history visible" ON public.lead_imports;
CREATE POLICY "import history visible" ON public.lead_imports
  FOR SELECT TO authenticated
  USING ((SELECT is_super_admin()) OR (company_id = (SELECT current_company_id()) AND (SELECT is_company_admin())));

DROP POLICY IF EXISTS "admins create import history" ON public.lead_imports;
CREATE POLICY "admins create import history" ON public.lead_imports
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT is_company_admin())
    AND ((SELECT is_super_admin()) OR company_id = (SELECT current_company_id()))
    AND imported_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS "admins update import history" ON public.lead_imports;
CREATE POLICY "admins update import history" ON public.lead_imports
  FOR UPDATE TO authenticated
  USING ((SELECT is_super_admin()) OR ((SELECT is_company_admin()) AND company_id = (SELECT current_company_id())))
  WITH CHECK ((SELECT is_super_admin()) OR ((SELECT is_company_admin()) AND company_id = (SELECT current_company_id())));

ANALYZE public.leads;