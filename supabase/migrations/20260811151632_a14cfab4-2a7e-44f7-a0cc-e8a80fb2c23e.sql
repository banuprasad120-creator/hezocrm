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