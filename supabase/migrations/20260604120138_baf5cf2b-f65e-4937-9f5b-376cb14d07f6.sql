DROP POLICY IF EXISTS "Users can update own slitting entries" ON public.slitting_entries;
CREATE POLICY "Users can update own slitting entries"
  ON public.slitting_entries FOR UPDATE TO authenticated
  USING (auth.uid() = slitting_manager_id);

DROP POLICY IF EXISTS "Slitting managers can update own head36 entries" ON public.head36_entries;
CREATE POLICY "Slitting managers can update own head36 entries"
  ON public.head36_entries FOR UPDATE TO authenticated
  USING (auth.uid() = operator_id AND public.has_role(auth.uid(), 'slitting_manager'));

DROP POLICY IF EXISTS "Slitting managers can update own returns" ON public.slitting_returns;
CREATE POLICY "Slitting managers can update own returns"
  ON public.slitting_returns FOR UPDATE TO authenticated
  USING (auth.uid() = returned_by AND public.has_role(auth.uid(), 'slitting_manager'));

DROP POLICY IF EXISTS "Workers can update own entries" ON public.production_entries;
CREATE POLICY "Workers can update own entries"
  ON public.production_entries FOR UPDATE TO authenticated
  USING (auth.uid() = worker_id);

DROP POLICY IF EXISTS "Admins can update entries" ON public.production_entries;
CREATE POLICY "Admins can update entries"
  ON public.production_entries FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()));

NOTIFY pgrst, 'reload schema';