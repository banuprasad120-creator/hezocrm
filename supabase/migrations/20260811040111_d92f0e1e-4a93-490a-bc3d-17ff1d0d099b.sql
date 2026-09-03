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