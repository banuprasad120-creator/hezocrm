CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_leads_customer_name_trgm ON public.leads USING gin (customer_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_leads_mobile_trgm ON public.leads USING gin (mobile gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_leads_city_trgm ON public.leads USING gin (city gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_full_name_trgm ON public.profiles USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_email_trgm ON public.profiles USING gin (email gin_trgm_ops);