CREATE OR REPLACE VIEW public.lead_folder_counts
WITH (security_invoker = on) AS
SELECT company_id, folder_date, count(*)::bigint AS lead_count
FROM public.leads
GROUP BY company_id, folder_date;

GRANT SELECT ON public.lead_folder_counts TO authenticated;
GRANT SELECT ON public.lead_folder_counts TO service_role;