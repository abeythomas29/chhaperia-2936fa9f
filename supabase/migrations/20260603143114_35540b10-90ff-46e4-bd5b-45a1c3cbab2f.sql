CREATE OR REPLACE FUNCTION public.admin_list_users()
 RETURNS TABLE(id uuid, user_id uuid, name text, employee_id text, username text, status text, requested_department text, roles text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  current_user_id uuid := auth.uid();
  current_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF current_email = 'admin@chhaperia.com' THEN
    UPDATE public.profiles p
    SET status = 'active',
        username = COALESCE(NULLIF(p.username, ''), current_email)
    WHERE p.user_id = current_user_id
       OR lower(p.username) = current_email;

    INSERT INTO public.profiles (user_id, name, employee_id, username, requested_department, status)
    SELECT
      current_user_id,
      COALESCE(NULLIF((SELECT u.raw_user_meta_data ->> 'name' FROM auth.users u WHERE u.id = current_user_id), ''), 'Super Admin'),
      COALESCE(NULLIF((SELECT u.raw_user_meta_data ->> 'employee_id' FROM auth.users u WHERE u.id = current_user_id), ''), 'ADMIN'),
      current_email,
      'worker'::public.signup_department,
      'active'
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.profiles p2
      WHERE p2.user_id = current_user_id
         OR lower(p2.username) = current_email
    );

    INSERT INTO public.user_roles (user_id, role)
    SELECT current_user_id, 'super_admin'
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.user_roles ur2
      WHERE ur2.user_id = current_user_id
        AND ur2.role = 'super_admin'
    );
  END IF;

  IF NOT public.is_admin(current_user_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  WITH known_user_ids AS (
    SELECT u.id AS uid FROM auth.users u
    UNION
    SELECT p.user_id AS uid FROM public.profiles p
    UNION
    SELECT ur.user_id AS uid FROM public.user_roles ur
    UNION
    SELECT pe.worker_id AS uid
    FROM public.production_entries pe
    WHERE pe.worker_id IS NOT NULL
  ),
  role_rows AS (
    SELECT
      ur.user_id AS uid,
      array_agg(ur.role::text ORDER BY ur.role::text) AS roles
    FROM public.user_roles ur
    GROUP BY ur.user_id
  )
  SELECT
    COALESCE(p.id, k.uid) AS id,
    k.uid AS user_id,
    COALESCE(
      NULLIF(p.name, ''),
      NULLIF(u.raw_user_meta_data ->> 'name', ''),
      split_part(COALESCE(u.email, p.username, k.uid::text), '@', 1),
      'Unknown User'
    ) AS name,
    COALESCE(NULLIF(p.employee_id, ''), NULLIF(u.raw_user_meta_data ->> 'employee_id', ''), 'TBD') AS employee_id,
    COALESCE(NULLIF(p.username, ''), u.email, k.uid::text) AS username,
    COALESCE(NULLIF(p.status, ''), 'active') AS status,
    COALESCE(NULLIF(p.requested_department::text, ''), NULLIF(u.raw_user_meta_data ->> 'requested_department', ''), 'worker') AS requested_department,
    COALESCE(r.roles, ARRAY[]::text[]) AS roles
  FROM known_user_ids k
  LEFT JOIN auth.users u ON u.id = k.uid
  LEFT JOIN public.profiles p ON p.user_id = k.uid
  LEFT JOIN role_rows r ON r.uid = k.uid
  ORDER BY name;
END;
$function$;