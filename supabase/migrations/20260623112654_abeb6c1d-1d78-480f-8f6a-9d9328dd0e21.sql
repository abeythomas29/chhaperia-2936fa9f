ALTER TABLE public.slitting_returns
  ADD COLUMN IF NOT EXISTS return_type text DEFAULT 'reusable',
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS wastage_quantity numeric;
NOTIFY pgrst, 'reload schema';