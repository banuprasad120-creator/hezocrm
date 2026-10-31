-- Migration: Strict Duplicate and Error Prevention
-- 1. Create unique index on leads(company_id, mobile) so duplicate phone numbers within a company can never exist.
CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_company_mobile ON public.leads (company_id, mobile);

-- 2. Fast duplicate check RPC to efficiently check arrays of candidate numbers against the index.
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
