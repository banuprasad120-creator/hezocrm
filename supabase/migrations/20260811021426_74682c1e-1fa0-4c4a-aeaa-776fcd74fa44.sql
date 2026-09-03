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