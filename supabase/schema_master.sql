-- ==========================================
-- MIGRATION: 20260811021426_74682c1e-1fa0-4c4a-aeaa-776fcd74fa44.sql
-- ==========================================
-- ENUMS
CREATE TYPE public.app_role AS ENUM ('super_admin','company_admin','agent');
CREATE TYPE public.lead_status AS ENUM ('New','Assigned','Contacted','Interested','Follow-up','Documents Pending','Application Submitted','Processing','Approved','Disbursed','Not Interested','Not Eligible','Wrong Number','No Response','Closed');
CREATE TYPE public.call_result AS ENUM ('Connected','No Answer','Busy','Switched Off','Wrong Number');
CREATE TYPE public.customer_response AS ENUM ('Interested','Not Interested','Follow-up Required','Documents Required','Application Submitted','Other');

-- COMPANIES
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  plan text NOT NULL DEFAULT 'Starter',
  status text NOT NULL DEFAULT 'Active',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- PROFILES
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  full_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- USER ROLES
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER HELPERS
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_company_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'company_admin') OR public.has_role(auth.uid(), 'super_admin')
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'super_admin')
$$;

-- COMPANY POLICIES
CREATE POLICY "view own company" ON public.companies FOR SELECT TO authenticated
  USING (public.is_super_admin() OR id = public.current_company_id());
CREATE POLICY "admins update own company" ON public.companies FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR (public.is_company_admin() AND id = public.current_company_id()));

-- PROFILE POLICIES
CREATE POLICY "view own profile" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_super_admin() OR (public.is_company_admin() AND company_id = public.current_company_id()));
CREATE POLICY "insert own profile" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());
CREATE POLICY "update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_super_admin() OR (public.is_company_admin() AND company_id = public.current_company_id()));

-- USER ROLE POLICIES (read only from client)
CREATE POLICY "view roles in company" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin() OR (public.is_company_admin() AND company_id = public.current_company_id()));

-- LEADS
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_name text NOT NULL,
  mobile text NOT NULL,
  email text,
  loan_amount numeric NOT NULL DEFAULT 0,
  loan_type text NOT NULL DEFAULT 'Personal Loan',
  city text,
  source text DEFAULT 'Manual',
  folder_date date NOT NULL DEFAULT current_date,
  status public.lead_status NOT NULL DEFAULT 'New',
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at timestamptz,
  last_call_at timestamptz,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_leads_company ON public.leads(company_id);
CREATE INDEX idx_leads_assigned ON public.leads(assigned_to);
CREATE INDEX idx_leads_folder ON public.leads(folder_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leads visible to owner or admin" ON public.leads FOR SELECT TO authenticated
  USING (public.is_super_admin() OR (company_id = public.current_company_id() AND (public.is_company_admin() OR assigned_to = auth.uid())));
CREATE POLICY "admins insert leads" ON public.leads FOR INSERT TO authenticated
  WITH CHECK (public.is_company_admin() AND (public.is_super_admin() OR company_id = public.current_company_id()));
CREATE POLICY "admins update any lead, agents own leads" ON public.leads FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR (company_id = public.current_company_id() AND (public.is_company_admin() OR assigned_to = auth.uid())))
  WITH CHECK (public.is_super_admin() OR (company_id = public.current_company_id() AND (public.is_company_admin() OR assigned_to = auth.uid())));
CREATE POLICY "admins delete leads" ON public.leads FOR DELETE TO authenticated
  USING (public.is_super_admin() OR (public.is_company_admin() AND company_id = public.current_company_id()));

-- Agents may not change assignment
CREATE OR REPLACE FUNCTION public.guard_lead_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_company_admin() THEN
    IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to OR NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION 'Agents cannot reassign leads';
    END IF;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_guard_lead_assignment BEFORE UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.guard_lead_assignment();

-- LEAD ASSIGNMENTS
CREATE TABLE public.lead_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_assign_lead ON public.lead_assignments(lead_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_assignments TO authenticated;
GRANT ALL ON public.lead_assignments TO service_role;
ALTER TABLE public.lead_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assignments visible" ON public.lead_assignments FOR SELECT TO authenticated
  USING (public.is_super_admin() OR (company_id = public.current_company_id() AND (public.is_company_admin() OR employee_id = auth.uid())));
CREATE POLICY "admins create assignments" ON public.lead_assignments FOR INSERT TO authenticated
  WITH CHECK (public.is_company_admin() AND (public.is_super_admin() OR company_id = public.current_company_id()));

-- CALL HISTORY
CREATE TABLE public.call_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  call_result public.call_result NOT NULL,
  customer_response public.customer_response,
  status public.lead_status NOT NULL,
  notes text,
  called_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_call_lead ON public.call_history(lead_id);
GRANT SELECT, INSERT ON public.call_history TO authenticated;
GRANT ALL ON public.call_history TO service_role;
ALTER TABLE public.call_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "call history visible" ON public.call_history FOR SELECT TO authenticated
  USING (public.is_super_admin() OR (company_id = public.current_company_id() AND (public.is_company_admin() OR employee_id = auth.uid())));
CREATE POLICY "agents log own calls" ON public.call_history FOR INSERT TO authenticated
  WITH CHECK (employee_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.leads l WHERE l.id = lead_id AND l.company_id = company_id
      AND (l.assigned_to = auth.uid() OR public.is_company_admin())));

-- FOLLOW UPS
CREATE TABLE public.follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  follow_up_date date NOT NULL,
  follow_up_time time,
  note text,
  is_done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_followup_lead ON public.follow_ups(lead_id);
CREATE INDEX idx_followup_emp ON public.follow_ups(employee_id, follow_up_date);
GRANT SELECT, INSERT, UPDATE ON public.follow_ups TO authenticated;
GRANT ALL ON public.follow_ups TO service_role;
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "follow ups visible" ON public.follow_ups FOR SELECT TO authenticated
  USING (public.is_super_admin() OR (company_id = public.current_company_id() AND (public.is_company_admin() OR employee_id = auth.uid())));
CREATE POLICY "agents create own follow ups" ON public.follow_ups FOR INSERT TO authenticated
  WITH CHECK (employee_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.leads l WHERE l.id = lead_id AND l.company_id = company_id
      AND (l.assigned_to = auth.uid() OR public.is_company_admin())));
CREATE POLICY "agents update own follow ups" ON public.follow_ups FOR UPDATE TO authenticated
  USING (employee_id = auth.uid() OR public.is_company_admin())
  WITH CHECK (employee_id = auth.uid() OR public.is_company_admin());

-- LEAD STATUS HISTORY
CREATE TABLE public.lead_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  old_status public.lead_status,
  new_status public.lead_status NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_status_hist_lead ON public.lead_status_history(lead_id);
GRANT SELECT ON public.lead_status_history TO authenticated;
GRANT ALL ON public.lead_status_history TO service_role;
ALTER TABLE public.lead_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "status history visible" ON public.lead_status_history FOR SELECT TO authenticated
  USING (public.is_super_admin() OR (company_id = public.current_company_id() AND (public.is_company_admin() OR employee_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.leads l WHERE l.id = lead_id AND l.assigned_to = auth.uid()))));

-- auto-record status changes
CREATE OR REPLACE FUNCTION public.record_lead_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.lead_status_history (lead_id, company_id, employee_id, old_status, new_status)
    VALUES (NEW.id, NEW.company_id, auth.uid(), NULL, NEW.status);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.lead_status_history (lead_id, company_id, employee_id, old_status, new_status)
    VALUES (NEW.id, NEW.company_id, auth.uid(), OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_lead_status_history AFTER INSERT OR UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.record_lead_status_change();

-- ==========================================
-- MIGRATION: 20260811021450_414a53f9-9045-4c63-aae4-698ce81bc221.sql
-- ==========================================
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.current_company_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_company_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.guard_lead_assignment() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_lead_status_change() FROM anon, authenticated;

-- ==========================================
-- MIGRATION: 20260811030943_f6dbbdce-2bcb-49ad-88be-99098193c1ab.sql
-- ==========================================
DO $$
DECLARE cids uuid[]; uids uuid[];
BEGIN
  SELECT array_agg(id) INTO cids FROM public.companies WHERE name LIKE 'QA Co %' OR name LIKE 'Other Co %';
  IF cids IS NULL THEN RETURN; END IF;
  SELECT array_agg(id) INTO uids FROM public.profiles WHERE company_id = ANY(cids);
  DELETE FROM public.follow_ups WHERE company_id = ANY(cids);
  DELETE FROM public.call_history WHERE company_id = ANY(cids);
  DELETE FROM public.lead_status_history WHERE company_id = ANY(cids);
  DELETE FROM public.lead_assignments WHERE company_id = ANY(cids);
  DELETE FROM public.leads WHERE company_id = ANY(cids);
  DELETE FROM public.user_roles WHERE company_id = ANY(cids) OR user_id = ANY(uids);
  DELETE FROM public.profiles WHERE company_id = ANY(cids);
  DELETE FROM public.companies WHERE id = ANY(cids);
  DELETE FROM auth.users WHERE id = ANY(uids);
END $$;

-- ==========================================
-- MIGRATION: 20260811040111_d92f0e1e-4a93-490a-bc3d-17ff1d0d099b.sql
-- ==========================================
DO $$
DECLARE cid uuid; uids uuid[];
BEGIN
  SELECT id INTO cid FROM public.companies WHERE name = 'QA AgentWS Co';
  IF cid IS NULL THEN RETURN; END IF;
  SELECT array_agg(id) INTO uids FROM public.profiles WHERE company_id = cid;
  DELETE FROM public.call_history WHERE company_id = cid;
  DELETE FROM public.lead_status_history WHERE company_id = cid;
  DELETE FROM public.follow_ups WHERE company_id = cid;
  DELETE FROM public.lead_assignments WHERE company_id = cid;
  DELETE FROM public.leads WHERE company_id = cid;
  DELETE FROM public.user_roles WHERE company_id = cid OR user_id = ANY(uids);
  DELETE FROM public.profiles WHERE company_id = cid;
  DELETE FROM public.companies WHERE id = cid;
  DELETE FROM auth.users WHERE id = ANY(uids);
END $$;

-- ==========================================
-- MIGRATION: 20260811040611_d52cb7d2-ecd4-4a63-89ec-a8e9fc872311.sql
-- ==========================================
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS alternate_mobile text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS employment_type text,
  ADD COLUMN IF NOT EXISTS employer text,
  ADD COLUMN IF NOT EXISTS monthly_income numeric,
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS pan text,
  ADD COLUMN IF NOT EXISTS pincode text,
  ADD COLUMN IF NOT EXISTS location text;

CREATE TABLE IF NOT EXISTS public.lead_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  imported_by uuid REFERENCES auth.users(id),
  file_name text NOT NULL,
  folder_date date NOT NULL,
  total_rows integer NOT NULL DEFAULT 0,
  imported_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.lead_imports TO authenticated;
GRANT ALL ON public.lead_imports TO service_role;

ALTER TABLE public.lead_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "import history visible"
ON public.lead_imports FOR SELECT TO authenticated
USING (is_super_admin() OR (company_id = current_company_id() AND is_company_admin()));

CREATE POLICY "admins create import history"
ON public.lead_imports FOR INSERT TO authenticated
WITH CHECK (is_company_admin() AND (is_super_admin() OR company_id = current_company_id()) AND imported_by = auth.uid());

CREATE INDEX IF NOT EXISTS idx_lead_imports_company ON public.lead_imports (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_company_mobile ON public.leads (company_id, mobile);

-- ==========================================
-- MIGRATION: 20260811143834_c43521f6-7ec0-4a03-9652-ed990fb1b2c0.sql
-- ==========================================
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS import_id uuid,
  ADD COLUMN IF NOT EXISTS import_row integer;

CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_import_row
  ON public.leads (import_id, import_row) WHERE import_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_company_folder ON public.leads (company_id, folder_date);
CREATE INDEX IF NOT EXISTS idx_leads_company_status ON public.leads (company_id, status);

ALTER TABLE public.lead_imports
  ADD COLUMN IF NOT EXISTS started_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS processed_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_batch integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_batches integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'processing';

DROP POLICY IF EXISTS "admins update import history" ON public.lead_imports;
CREATE POLICY "admins update import history" ON public.lead_imports
  FOR UPDATE TO authenticated
  USING (is_super_admin() OR (is_company_admin() AND company_id = current_company_id()))
  WITH CHECK (is_super_admin() OR (is_company_admin() AND company_id = current_company_id()));

-- ==========================================
-- MIGRATION: 20260811144145_dba02870-5637-4bb2-a633-ac2c51e14bef.sql
-- ==========================================
CREATE OR REPLACE VIEW public.lead_folder_counts
WITH (security_invoker = on) AS
SELECT company_id, folder_date, count(*)::bigint AS lead_count
FROM public.leads
GROUP BY company_id, folder_date;

GRANT SELECT ON public.lead_folder_counts TO authenticated;
GRANT SELECT ON public.lead_folder_counts TO service_role;

-- ==========================================
-- MIGRATION: 20260811144937_6685e4a8-e070-41c4-8c01-530e1fc7e532.sql
-- ==========================================
DROP INDEX IF EXISTS public.uq_leads_import_row;
CREATE UNIQUE INDEX uq_leads_import_row ON public.leads (import_id, import_row);

-- ==========================================
-- MIGRATION: 20260811145247_944c94dd-4e7e-45a5-a621-2995249cce42.sql
-- ==========================================
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

-- ==========================================
-- MIGRATION: 20260811151539_5da3cd44-63cf-4959-a4fe-6136a2aaf1c7.sql
-- ==========================================
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

-- ==========================================
-- MIGRATION: 20260811151632_a14cfab4-2a7e-44f7-a0cc-e8a80fb2c23e.sql
-- ==========================================
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

ALTER FUNCTION public.has_role(uuid, public.app_role) SET SCHEMA private;
ALTER FUNCTION public.current_company_id() SET SCHEMA private;
ALTER FUNCTION public.is_company_admin() SET SCHEMA private;
ALTER FUNCTION public.is_super_admin() SET SCHEMA private;
ALTER FUNCTION public.guard_lead_assignment() SET SCHEMA private;
ALTER FUNCTION public.record_lead_status_change() SET SCHEMA private;

ALTER FUNCTION private.has_role(uuid, public.app_role) SET search_path = public, private;
ALTER FUNCTION private.current_company_id() SET search_path = public, private;
ALTER FUNCTION private.is_company_admin() SET search_path = public, private;
ALTER FUNCTION private.is_super_admin() SET search_path = public, private;
ALTER FUNCTION private.guard_lead_assignment() SET search_path = public, private;
ALTER FUNCTION private.record_lead_status_change() SET search_path = public, private;

REVOKE ALL ON FUNCTION private.guard_lead_assignment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.record_lead_status_change() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.current_company_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_company_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_super_admin() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION private.current_company_id() TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_company_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_super_admin() TO authenticated;

-- ==========================================
-- MIGRATION: 20260811153833_05b60357-44b3-43c6-b0f1-fb116e926380.sql
-- ==========================================
CREATE OR REPLACE FUNCTION private.is_company_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public', 'private'
AS $$ SELECT private.has_role(auth.uid(), 'company_admin') OR private.has_role(auth.uid(), 'super_admin') $$;

CREATE OR REPLACE FUNCTION private.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public', 'private'
AS $$ SELECT private.has_role(auth.uid(), 'super_admin') $$;

CREATE OR REPLACE FUNCTION private.guard_lead_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'private'
AS $$
BEGIN
  IF NOT private.is_company_admin() THEN
    IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to OR NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION 'Agents cannot reassign leads';
    END IF;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ==========================================
-- MIGRATION: 20260811165511_8375af7f-734a-4b36-99a9-7b261d051d39.sql
-- ==========================================

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


-- ==========================================
-- MIGRATION: 20260812024747_2cca18f7-959b-4833-ad72-0e109993d5b0.sql
-- ==========================================
GRANT SELECT, INSERT, UPDATE ON public.attendance TO authenticated;
GRANT ALL ON public.attendance TO service_role;

-- ==========================================
-- MIGRATION: 20260812071143_eaa0b957-26f5-469e-9fc0-c60e6b2011ec.sql
-- ==========================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_leads_customer_name_trgm ON public.leads USING gin (customer_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_leads_mobile_trgm ON public.leads USING gin (mobile gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_leads_city_trgm ON public.leads USING gin (city gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_full_name_trgm ON public.profiles USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_email_trgm ON public.profiles USING gin (email gin_trgm_ops);

-- ==========================================
-- MIGRATION: 20260812071213_80e0dc89-da52-4db0-90c4-e4107f8450b0.sql
-- ==========================================
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION pg_trgm SET SCHEMA extensions;

-- ==========================================
-- MIGRATION: 20260812183000_auto_confirm_users.sql
-- ==========================================
-- Auto-confirm existing unconfirmed users in auth.users
UPDATE auth.users
SET email_confirmed_at = NOW()
WHERE email_confirmed_at IS NULL;

-- Function to automatically mark new users as email confirmed upon creation
CREATE OR REPLACE FUNCTION public.auto_confirm_user()
RETURNS trigger AS $$
BEGIN
  IF NEW.email_confirmed_at IS NULL THEN
    NEW.email_confirmed_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users before insert
DROP TRIGGER IF EXISTS tr_auto_confirm_user ON auth.users;
CREATE TRIGGER tr_auto_confirm_user
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_confirm_user();

-- ==========================================
-- MIGRATION: 20261015000000_lead_batches_and_auto_assign.sql
-- ==========================================
ALTER TABLE public.companies 
  ADD COLUMN IF NOT EXISTS auto_assign_status text NOT NULL DEFAULT 'RUNNING',
  ADD COLUMN IF NOT EXISTS lead_batch_automation_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS agent_lead_batch_size integer NOT NULL DEFAULT 100;

CREATE TABLE IF NOT EXISTS public.lead_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  batch_number integer NOT NULL DEFAULT 1,
  batch_size integer NOT NULL DEFAULT 100,
  assigned_count integer NOT NULL DEFAULT 0,
  lead_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'IN_PROGRESS',
  assigned_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  assignment_source text NOT NULL DEFAULT 'AUTO_BATCH_REFILL',
  created_by text NOT NULL DEFAULT 'SYSTEM'
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_batches TO authenticated;
GRANT ALL ON public.lead_batches TO service_role;
ALTER TABLE public.lead_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Companies can access own lead_batches" ON public.lead_batches;
CREATE POLICY "Companies can access own lead_batches" ON public.lead_batches
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_lead_batches_emp_status ON public.lead_batches(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_lead_batches_company ON public.lead_batches(company_id, assigned_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_unassigned_pool ON public.leads(company_id, folder_date, created_at)
  WHERE assigned_to IS NULL AND status = 'New' AND last_call_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_agent_pending ON public.leads(company_id, assigned_to, status)
  WHERE status IN ('New', 'Assigned');
CREATE INDEX IF NOT EXISTS idx_attendance_company_date ON public.attendance(company_id, work_date);

-- Follow-Up Auto-Resolution Function & Trigger
CREATE OR REPLACE FUNCTION public.fn_auto_resolve_follow_ups()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status <> 'Follow-up' THEN
    UPDATE public.follow_ups
    SET is_done = true
    WHERE lead_id = NEW.id AND is_done = false;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auto_resolve_follow_ups ON public.leads;
CREATE TRIGGER trg_auto_resolve_follow_ups
AFTER UPDATE OF status ON public.leads
FOR EACH ROW
WHEN (NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'Follow-up')
EXECUTE FUNCTION public.fn_auto_resolve_follow_ups();

-- Canonical allocate_lead_batch Function
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
  v_auto_status text := 'RUNNING';
  v_auto_enabled boolean := true;
BEGIN
  -- Strict check: if auto assignment is STOPPED or PAUSED, block automatic batch refill or assignment
  SELECT COALESCE(auto_assign_status, 'RUNNING'), COALESCE(lead_batch_automation_enabled, true)
  INTO v_auto_status, v_auto_enabled
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
      'message', 'No unassigned leads available in company',
      'assigned_count', 0,
      'batch_number', v_batch_num
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
    'message', v_allocated_count || ' new leads assigned in Batch #' || v_batch_num
  );
END;
$$;

-- Auto-refill Triggers on leads & call_history
CREATE OR REPLACE FUNCTION public.check_and_refill_agent_batch_on_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pending_count integer := 0;
  v_auto_enabled boolean := true;
  v_auto_status text := 'RUNNING';
  v_batch_size integer := 100;
  v_emp_active boolean := true;
BEGIN
  IF OLD.assigned_to IS NOT NULL AND (
    NEW.last_call_at IS DISTINCT FROM OLD.last_call_at OR
    (OLD.status IN ('New', 'Assigned') AND NEW.status NOT IN ('New', 'Assigned'))
  ) THEN
    SELECT COALESCE(lead_batch_automation_enabled, true), COALESCE(agent_lead_batch_size, 100), COALESCE(auto_assign_status, 'RUNNING')
    INTO v_auto_enabled, v_batch_size, v_auto_status
    FROM public.companies
    WHERE id = NEW.company_id;

    IF NOT v_auto_enabled OR v_auto_status != 'RUNNING' THEN
      RETURN NEW;
    END IF;

    SELECT COALESCE(is_active, true) INTO v_emp_active
    FROM public.profiles
    WHERE id = NEW.assigned_to;

    IF NOT v_emp_active THEN
      RETURN NEW;
    END IF;

    SELECT COUNT(*) INTO v_pending_count
    FROM public.leads
    WHERE company_id = NEW.company_id
      AND assigned_to = NEW.assigned_to
      AND status IN ('New', 'Assigned')
      AND id != NEW.id;

    IF v_pending_count = 0 THEN
      PERFORM public.allocate_lead_batch(NEW.company_id, NEW.assigned_to, v_batch_size, 'AUTO_BATCH_REFILL', false, NULL);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_batch_refill_on_lead_update ON public.leads;
CREATE TRIGGER trg_auto_batch_refill_on_lead_update
AFTER UPDATE ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.check_and_refill_agent_batch_on_lead();

CREATE OR REPLACE FUNCTION public.check_and_refill_agent_batch_on_call()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pending_count integer := 0;
  v_auto_enabled boolean := true;
  v_auto_status text := 'RUNNING';
  v_batch_size integer := 100;
  v_emp_active boolean := true;
BEGIN
  SELECT COALESCE(lead_batch_automation_enabled, true), COALESCE(agent_lead_batch_size, 100), COALESCE(auto_assign_status, 'RUNNING')
  INTO v_auto_enabled, v_batch_size, v_auto_status
  FROM public.companies
  WHERE id = NEW.company_id;

  IF NOT v_auto_enabled OR v_auto_status != 'RUNNING' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(is_active, true) INTO v_emp_active
  FROM public.profiles
  WHERE id = NEW.employee_id;

  IF NOT v_emp_active THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_pending_count
  FROM public.leads
  WHERE company_id = NEW.company_id
    AND assigned_to = NEW.employee_id
    AND status IN ('New', 'Assigned');

  IF v_pending_count = 0 THEN
    PERFORM public.allocate_lead_batch(NEW.company_id, NEW.employee_id, v_batch_size, 'AUTO_BATCH_REFILL', false, NULL);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_batch_refill_on_call_insert ON public.call_history;
CREATE TRIGGER trg_auto_batch_refill_on_call_insert
AFTER INSERT ON public.call_history
FOR EACH ROW
EXECUTE FUNCTION public.check_and_refill_agent_batch_on_call();

-- Tri-State Controls RPCs
CREATE OR REPLACE FUNCTION public.start_auto_assignment(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch_size integer := 100;
  v_agent record;
  v_refilled_agents integer := 0;
  v_total_assigned integer := 0;
  v_alloc_res jsonb;
  v_pending integer;
BEGIN
  UPDATE public.companies
  SET auto_assign_status = 'RUNNING',
      lead_batch_automation_enabled = true
  WHERE id = p_company_id
  RETURNING COALESCE(agent_lead_batch_size, 100) INTO v_batch_size;

  FOR v_agent IN
    SELECT p.id, p.full_name, p.email
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE p.company_id = p_company_id
      AND p.is_active = true
      AND ur.role = 'agent'
  LOOP
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

CREATE OR REPLACE FUNCTION public.pause_auto_assignment(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

CREATE OR REPLACE FUNCTION public.stop_auto_assignment(p_company_id uuid, p_recall_uncontacted boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_recalled_count integer := 0;
BEGIN
  UPDATE public.companies
  SET auto_assign_status = 'STOPPED',
      lead_batch_automation_enabled = false
  WHERE id = p_company_id;

  IF COALESCE(p_recall_uncontacted, true) THEN
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

GRANT EXECUTE ON FUNCTION public.allocate_lead_batch(uuid, uuid, integer, text, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_auto_assignment(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pause_auto_assignment(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stop_auto_assignment(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.distribute_leads_equally(uuid, uuid[], integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_team_attendance_by_date(uuid, date) TO authenticated, service_role;

-- STRICT DUPLICATE PREVENTION & VALIDATION
CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_company_mobile ON public.leads (company_id, mobile);

CREATE OR REPLACE FUNCTION public.check_existing_mobiles(
  p_company_id uuid,
  p_mobiles text[]
)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(mobile), '{}'::text[])
  FROM public.leads
  WHERE company_id = p_company_id
    AND mobile = ANY(p_mobiles);
$$;

GRANT EXECUTE ON FUNCTION public.check_existing_mobiles(uuid, text[]) TO authenticated, service_role;

-- 5. LIVE PRIORITY QUEUE PROCESSOR
CREATE OR REPLACE FUNCTION public.process_live_priority_queue(
  p_company_id uuid,
  p_folder_date text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text := 'RUNNING';
  v_agent record;
  v_batch_size integer := 100;
  v_total_assigned integer := 0;
  v_allocated jsonb;
  v_high_waiting integer := 0;
  v_med_waiting integer := 0;
  v_low_waiting integer := 0;
  v_total_unassigned integer := 0;
  v_total_assigned_count integer := 0;
  v_agents_served integer := 0;
BEGIN
  -- 1. Check folder / company auto-assign state
  SELECT COALESCE(auto_assign_status, 'RUNNING'), COALESCE(agent_lead_batch_size, 100)
  INTO v_status, v_batch_size
  FROM public.companies
  WHERE id = p_company_id;

  -- 2. If PAUSED or STOPPED, do not assign! Save leads in queue.
  IF v_status != 'RUNNING' THEN
    SELECT
      COUNT(*) FILTER (WHERE priority = 'HIGH'),
      COUNT(*) FILTER (WHERE priority = 'MEDIUM'),
      COUNT(*) FILTER (WHERE priority = 'LOW'),
      COUNT(*)
    INTO v_high_waiting, v_med_waiting, v_low_waiting, v_total_unassigned
    FROM public.leads
    WHERE company_id = p_company_id
      AND assigned_to IS NULL
      AND status = 'New'
      AND last_call_at IS NULL
      AND (p_folder_date IS NULL OR folder_date::text = p_folder_date);

    RETURN jsonb_build_object(
      'success', true,
      'status', v_status,
      'assigned_count', 0,
      'high_priority_waiting', v_high_waiting,
      'medium_priority_waiting', v_med_waiting,
      'low_priority_waiting', v_low_waiting,
      'total_unassigned', v_total_unassigned,
      'message', 'Folder is ' || v_status || '. Leads safely queued by priority without auto-assignment.'
    );
  END IF;

  -- 3. If RUNNING: Assign leads prioritizing HIGH -> MEDIUM -> LOW
  FOR v_agent IN
    SELECT p.id, p.full_name
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'agent' AND ur.company_id = p_company_id
    WHERE p.company_id = p_company_id
      AND COALESCE(p.is_active, true) = true
    ORDER BY p.full_name ASC
  LOOP
    DECLARE
      v_agent_pending integer := 0;
    BEGIN
      SELECT COUNT(*) INTO v_agent_pending
      FROM public.leads
      WHERE company_id = p_company_id
        AND assigned_to = v_agent.id
        AND status IN ('New', 'Assigned');

      -- Only assign to available active agents who have room (do not interrupt ongoing calls)
      IF v_agent_pending = 0 THEN
        v_allocated := public.allocate_lead_batch(
          p_company_id, v_agent.id, v_batch_size, 'LIVE_PRIORITY_DISPATCH', true, p_folder_date
        );
        IF (v_allocated->>'assigned_count')::integer > 0 THEN
          v_total_assigned := v_total_assigned + (v_allocated->>'assigned_count')::integer;
          v_agents_served := v_agents_served + 1;
        END IF;
      END IF;
    END;
  END LOOP;

  -- 4. Calculate remaining queue counts
  SELECT
    COUNT(*) FILTER (WHERE priority = 'HIGH'),
    COUNT(*) FILTER (WHERE priority = 'MEDIUM'),
    COUNT(*) FILTER (WHERE priority = 'LOW'),
    COUNT(*)
  INTO v_high_waiting, v_med_waiting, v_low_waiting, v_total_unassigned
  FROM public.leads
  WHERE company_id = p_company_id
    AND assigned_to IS NULL
    AND status = 'New'
    AND last_call_at IS NULL
    AND (p_folder_date IS NULL OR folder_date::text = p_folder_date);

  SELECT COUNT(*)
  INTO v_total_assigned_count
  FROM public.leads
  WHERE company_id = p_company_id
    AND assigned_to IS NOT NULL
    AND (p_folder_date IS NULL OR folder_date::text = p_folder_date);

  RETURN jsonb_build_object(
    'success', true,
    'status', 'RUNNING',
    'assigned_count', v_total_assigned,
    'agents_served', v_agents_served,
    'high_priority_waiting', v_high_waiting,
    'medium_priority_waiting', v_med_waiting,
    'low_priority_waiting', v_low_waiting,
    'total_unassigned', v_total_unassigned,
    'total_assigned', v_total_assigned_count,
    'message', 'Live queue processed: ' || v_total_assigned || ' leads assigned across ' || v_agents_served || ' agents.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_live_priority_queue(uuid, text) TO authenticated, service_role;





