CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  name text,
  employee_id text,
  username text,
  status text,
  requested_department text,
  roles text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can list users';
  END IF;

  RETURN QUERY
  WITH known_user_ids AS (
    SELECT u.id AS user_id FROM auth.users u
    UNION
    SELECT p.user_id FROM public.profiles p
    UNION
    SELECT ur.user_id FROM public.user_roles ur
    UNION
    SELECT pe.worker_id AS user_id
    FROM public.production_entries pe
    WHERE pe.worker_id IS NOT NULL
  ),
  role_rows AS (
    SELECT
      ur.user_id,
      array_agg(ur.role::text ORDER BY ur.role::text) AS roles
    FROM public.user_roles ur
    GROUP BY ur.user_id
  )
  SELECT
    COALESCE(p.id, k.user_id) AS id,
    k.user_id,
    COALESCE(
      NULLIF(p.name, ''),
      NULLIF(u.raw_user_meta_data ->> 'name', ''),
      split_part(COALESCE(u.email, p.username, k.user_id::text), '@', 1),
      'Unknown User'
    ) AS name,
    COALESCE(NULLIF(p.employee_id, ''), NULLIF(u.raw_user_meta_data ->> 'employee_id', ''), 'TBD') AS employee_id,
    COALESCE(NULLIF(p.username, ''), u.email, k.user_id::text) AS username,
    COALESCE(NULLIF(p.status, ''), 'active') AS status,
    COALESCE(NULLIF(p.requested_department::text, ''), NULLIF(u.raw_user_meta_data ->> 'requested_department', ''), '') AS requested_department,
    COALESCE(r.roles, ARRAY[]::text[]) AS roles
  FROM known_user_ids k
  LEFT JOIN auth.users u ON u.id = k.user_id
  LEFT JOIN public.profiles p ON p.user_id = k.user_id
  LEFT JOIN role_rows r ON r.user_id = k.user_id
  ORDER BY name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;