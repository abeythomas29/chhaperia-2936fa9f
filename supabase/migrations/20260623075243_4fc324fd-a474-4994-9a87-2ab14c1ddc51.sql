
-- Add columns to support raw material issues (out) with unit conversion
ALTER TABLE public.raw_material_stock_entries
  ADD COLUMN IF NOT EXISTS entry_type text NOT NULL DEFAULT 'in',
  ADD COLUMN IF NOT EXISTS issue_unit text,
  ADD COLUMN IF NOT EXISTS issue_quantity numeric,
  ADD COLUMN IF NOT EXISTS issue_quantity_kg numeric,
  ADD COLUMN IF NOT EXISTS issued_to_user_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'raw_material_stock_entries' AND constraint_name = 'raw_material_stock_entries_entry_type_check'
  ) THEN
    ALTER TABLE public.raw_material_stock_entries
      ADD CONSTRAINT raw_material_stock_entries_entry_type_check CHECK (entry_type IN ('in','out'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rmse_entry_type ON public.raw_material_stock_entries(entry_type);
CREATE INDEX IF NOT EXISTS idx_rmse_issued_to ON public.raw_material_stock_entries(issued_to_user_id);

-- Update triggers to honour entry_type: 'in' adds, 'out' subtracts
CREATE OR REPLACE FUNCTION public.add_raw_material_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  sign numeric := CASE WHEN NEW.entry_type = 'out' THEN -1 ELSE 1 END;
BEGIN
  UPDATE public.raw_materials
  SET current_stock = current_stock + (sign * NEW.quantity),
      updated_at = now()
  WHERE id = NEW.raw_material_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.adjust_raw_material_stock_on_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  old_sign numeric := CASE WHEN OLD.entry_type = 'out' THEN -1 ELSE 1 END;
  new_sign numeric := CASE WHEN NEW.entry_type = 'out' THEN -1 ELSE 1 END;
BEGIN
  IF OLD.raw_material_id = NEW.raw_material_id THEN
    UPDATE public.raw_materials
    SET current_stock = current_stock + (new_sign * NEW.quantity) - (old_sign * OLD.quantity),
        updated_at = now()
    WHERE id = NEW.raw_material_id;
  ELSE
    UPDATE public.raw_materials
    SET current_stock = current_stock - (old_sign * OLD.quantity), updated_at = now()
    WHERE id = OLD.raw_material_id;
    UPDATE public.raw_materials
    SET current_stock = current_stock + (new_sign * NEW.quantity), updated_at = now()
    WHERE id = NEW.raw_material_id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reverse_raw_material_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  old_sign numeric := CASE WHEN OLD.entry_type = 'out' THEN -1 ELSE 1 END;
BEGIN
  UPDATE public.raw_materials
  SET current_stock = current_stock - (old_sign * OLD.quantity),
      updated_at = now()
  WHERE id = OLD.raw_material_id;
  RETURN OLD;
END;
$function$;
