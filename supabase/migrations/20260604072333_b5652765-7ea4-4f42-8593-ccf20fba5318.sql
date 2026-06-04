ALTER TABLE public.slitting_entries ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.company_clients(id) ON DELETE SET NULL;
ALTER TABLE public.head36_entries ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.company_clients(id) ON DELETE SET NULL;
ALTER TABLE public.slitting_returns ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.company_clients(id) ON DELETE SET NULL;