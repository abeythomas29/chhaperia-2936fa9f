GRANT SELECT, INSERT, UPDATE, DELETE ON public.slitting_returns TO authenticated;
GRANT ALL ON public.slitting_returns TO service_role;
NOTIFY pgrst, 'reload schema';