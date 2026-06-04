GRANT SELECT, INSERT, UPDATE, DELETE ON public.slitting_entries TO authenticated;
GRANT ALL ON public.slitting_entries TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.slitting_returns TO authenticated;
GRANT ALL ON public.slitting_returns TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.head36_entries TO authenticated;
GRANT ALL ON public.head36_entries TO service_role;

NOTIFY pgrst, 'reload schema';