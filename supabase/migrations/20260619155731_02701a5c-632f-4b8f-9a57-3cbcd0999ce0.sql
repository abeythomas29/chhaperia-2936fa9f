CREATE OR REPLACE FUNCTION public.list_production_manager_recipients()
RETURNS TABLE(user_id uuid, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, COALESCE(NULLIF(p.name, ''), 'Unknown') AS name
  FROM public.profiles p
  WHERE COALESCE(p.status, 'active') = 'active'
    AND p.user_id IS NOT NULL
  ORDER BY name;
$$;

GRANT EXECUTE ON FUNCTION public.list_production_manager_recipients() TO authenticated;