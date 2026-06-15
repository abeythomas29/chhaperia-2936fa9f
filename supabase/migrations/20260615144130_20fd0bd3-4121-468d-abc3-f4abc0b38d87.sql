
ALTER TYPE public.signup_department ADD VALUE IF NOT EXISTS 'sales_manager';

-- Drop old inventory_manager sales policies
DROP POLICY IF EXISTS "Inventory managers and admins can insert sales" ON public.sales;
DROP POLICY IF EXISTS "Inventory managers and admins can view sales" ON public.sales;
DROP POLICY IF EXISTS "Inventory managers can delete own sales" ON public.sales;
DROP POLICY IF EXISTS "Inventory managers can update own sales" ON public.sales;

-- Recreate for sales_manager + admins
CREATE POLICY "Sales managers and admins can view sales"
  ON public.sales FOR SELECT
  USING (public.has_role(auth.uid(), 'sales_manager') OR public.is_admin(auth.uid()));

CREATE POLICY "Sales managers and admins can insert sales"
  ON public.sales FOR INSERT
  WITH CHECK ((public.has_role(auth.uid(), 'sales_manager') OR public.is_admin(auth.uid())) AND auth.uid() = sold_by);

CREATE POLICY "Sales managers can update own sales"
  ON public.sales FOR UPDATE
  USING (public.has_role(auth.uid(), 'sales_manager') AND auth.uid() = sold_by)
  WITH CHECK (public.has_role(auth.uid(), 'sales_manager') AND auth.uid() = sold_by);

CREATE POLICY "Sales managers can delete own sales"
  ON public.sales FOR DELETE
  USING (public.has_role(auth.uid(), 'sales_manager') AND auth.uid() = sold_by);

-- Update handle_new_user to map sales_manager
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  requested_dept public.signup_department;
BEGIN
  requested_dept := CASE
    WHEN NEW.raw_user_meta_data->>'requested_department' = 'inventory_manager' THEN 'inventory_manager'::public.signup_department
    WHEN NEW.raw_user_meta_data->>'requested_department' = 'slitting_manager' THEN 'slitting_manager'::public.signup_department
    WHEN NEW.raw_user_meta_data->>'requested_department' = 'sales_manager' THEN 'sales_manager'::public.signup_department
    WHEN NEW.raw_user_meta_data->>'requested_department' = 'admin' THEN 'admin'::public.signup_department
    ELSE 'worker'::public.signup_department
  END;

  INSERT INTO public.profiles (user_id, name, employee_id, username, requested_department)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(BTRIM(NEW.raw_user_meta_data->>'name'), ''), 'New User'),
    COALESCE(NULLIF(BTRIM(NEW.raw_user_meta_data->>'employee_id'), ''), 'TBD'),
    COALESCE(NEW.email, ''),
    requested_dept
  );

  RETURN NEW;
END;
$function$;
