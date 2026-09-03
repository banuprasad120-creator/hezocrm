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