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