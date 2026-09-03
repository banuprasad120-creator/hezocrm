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