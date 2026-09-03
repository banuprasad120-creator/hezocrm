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


