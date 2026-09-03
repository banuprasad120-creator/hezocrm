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