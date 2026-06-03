
-- 1) Recreate {public}-scoped policies as {authenticated}

-- company_clients
DROP POLICY IF EXISTS "Admins can manage clients" ON public.company_clients;
CREATE POLICY "Admins can manage clients" ON public.company_clients
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- head36_entries
DROP POLICY IF EXISTS "Admins can manage head36 entries" ON public.head36_entries;
CREATE POLICY "Admins can manage head36 entries" ON public.head36_entries
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- product_categories
DROP POLICY IF EXISTS "Admins can manage categories" ON public.product_categories;
CREATE POLICY "Admins can manage categories" ON public.product_categories
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- product_codes
DROP POLICY IF EXISTS "Admins can manage product codes" ON public.product_codes;
CREATE POLICY "Admins can manage product codes" ON public.product_codes
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- product_recipes
DROP POLICY IF EXISTS "Admins can manage recipes" ON public.product_recipes;
CREATE POLICY "Admins can manage recipes" ON public.product_recipes
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- production_entries
DROP POLICY IF EXISTS "Admins can delete entries" ON public.production_entries;
CREATE POLICY "Admins can delete entries" ON public.production_entries
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can insert entries" ON public.production_entries;
CREATE POLICY "Admins can insert entries" ON public.production_entries
  FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can update entries" ON public.production_entries;
CREATE POLICY "Admins can update entries" ON public.production_entries
  FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can view all entries" ON public.production_entries;
CREATE POLICY "Admins can view all entries" ON public.production_entries
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Workers can delete own entries" ON public.production_entries;
CREATE POLICY "Workers can delete own entries" ON public.production_entries
  FOR DELETE TO authenticated USING (auth.uid() = worker_id);

DROP POLICY IF EXISTS "Workers can insert own entries" ON public.production_entries;
CREATE POLICY "Workers can insert own entries" ON public.production_entries
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = worker_id);

DROP POLICY IF EXISTS "Workers can update own entries" ON public.production_entries;
CREATE POLICY "Workers can update own entries" ON public.production_entries
  FOR UPDATE TO authenticated
  USING (auth.uid() = worker_id)
  WITH CHECK (auth.uid() = worker_id);

DROP POLICY IF EXISTS "Workers can view own entries" ON public.production_entries;
CREATE POLICY "Workers can view own entries" ON public.production_entries
  FOR SELECT TO authenticated USING (auth.uid() = worker_id);

-- profiles
DROP POLICY IF EXISTS "Admins can insert profiles" ON public.profiles;
CREATE POLICY "Admins can insert profiles" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- raw_material_stock_entries
DROP POLICY IF EXISTS "Admins can manage stock entries" ON public.raw_material_stock_entries;
CREATE POLICY "Admins can manage stock entries" ON public.raw_material_stock_entries
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- raw_material_usage
DROP POLICY IF EXISTS "Admins can manage usage" ON public.raw_material_usage;
CREATE POLICY "Admins can manage usage" ON public.raw_material_usage
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- raw_materials
DROP POLICY IF EXISTS "Admins can manage raw materials" ON public.raw_materials;
CREATE POLICY "Admins can manage raw materials" ON public.raw_materials
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- slitting_entries
DROP POLICY IF EXISTS "Admins can manage slitting entries" ON public.slitting_entries;
CREATE POLICY "Admins can manage slitting entries" ON public.slitting_entries
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- slitting_returns
DROP POLICY IF EXISTS "Admins can manage slitting returns" ON public.slitting_returns;
CREATE POLICY "Admins can manage slitting returns" ON public.slitting_returns
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- stock_issues
DROP POLICY IF EXISTS "Admins can manage stock issues" ON public.stock_issues;
CREATE POLICY "Admins can manage stock issues" ON public.stock_issues
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- user_roles: scope to authenticated and ensure WITH CHECK on super_admin policy
DROP POLICY IF EXISTS "Users can view own role" ON public.user_roles;
CREATE POLICY "Users can view own role" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Super admins can manage roles" ON public.user_roles;
CREATE POLICY "Super admins can manage roles" ON public.user_roles
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- 2) Lock down SECURITY DEFINER function execution
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_user_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_bootstrap_super_admin_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_bootstrap_super_admin_email(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.repair_admin_lockout() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.repair_admin_lockout() TO authenticated, service_role;
