
-- 1. Link slitting entries to the stock issue they consumed from
ALTER TABLE public.slitting_entries
  ADD COLUMN IF NOT EXISTS stock_issue_id uuid REFERENCES public.stock_issues(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_slitting_entries_stock_issue ON public.slitting_entries(stock_issue_id);

-- 2. Reusable / Wastage classification + Location on slitting_returns
ALTER TABLE public.slitting_returns
  ADD COLUMN IF NOT EXISTS return_type text NOT NULL DEFAULT 'reusable',
  ADD COLUMN IF NOT EXISTS location text;

-- Backfill existing rows
UPDATE public.slitting_returns SET return_type = 'reusable' WHERE return_type IS NULL;

-- Add check constraint after backfill (drop+create to be idempotent)
ALTER TABLE public.slitting_returns DROP CONSTRAINT IF EXISTS slitting_returns_return_type_chk;
ALTER TABLE public.slitting_returns
  ADD CONSTRAINT slitting_returns_return_type_chk CHECK (return_type IN ('reusable','wastage'));

-- 3. RPC: open issued materials for the calling slitting manager
CREATE OR REPLACE FUNCTION public.list_slitting_issued_materials()
RETURNS TABLE (
  issue_id uuid,
  issue_date date,
  product_code_id uuid,
  product_code text,
  thickness_mm numeric,
  unit text,
  notes text,
  issued_quantity numeric,
  consumed_quantity numeric,
  remaining_quantity numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH my_issues AS (
    SELECT si.id, si.date, si.product_code_id, si.thickness_mm, si.unit, si.notes, si.quantity
    FROM public.stock_issues si
    WHERE si.recipient_type = 'production_manager'
      AND si.recipient_user_id = auth.uid()
  ),
  consumed AS (
    SELECT se.stock_issue_id, COALESCE(SUM(se.source_quantity), 0) AS used
    FROM public.slitting_entries se
    WHERE se.stock_issue_id IS NOT NULL
    GROUP BY se.stock_issue_id
  )
  SELECT
    mi.id AS issue_id,
    mi.date AS issue_date,
    mi.product_code_id,
    pc.code AS product_code,
    mi.thickness_mm,
    mi.unit,
    mi.notes,
    mi.quantity AS issued_quantity,
    COALESCE(c.used, 0) AS consumed_quantity,
    (mi.quantity - COALESCE(c.used, 0)) AS remaining_quantity
  FROM my_issues mi
  LEFT JOIN public.product_codes pc ON pc.id = mi.product_code_id
  LEFT JOIN consumed c ON c.stock_issue_id = mi.id
  WHERE (mi.quantity - COALESCE(c.used, 0)) > 0
  ORDER BY mi.date DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_slitting_issued_materials() TO authenticated;

-- 4. RPC: total wastage grouped by product category (admin reporting)
CREATE OR REPLACE FUNCTION public.list_wastage_by_category(_from date DEFAULT NULL, _to date DEFAULT NULL)
RETURNS TABLE (
  category_id uuid,
  category_name text,
  total_wastage numeric,
  unit text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cat.id AS category_id,
    COALESCE(cat.name, 'Uncategorised') AS category_name,
    COALESCE(SUM(sr.returned_quantity), 0) AS total_wastage,
    MAX(sr.unit) AS unit
  FROM public.slitting_returns sr
  JOIN public.slitting_entries se ON se.id = sr.slitting_entry_id
  LEFT JOIN public.product_codes pc ON pc.id = se.product_code_id
  LEFT JOIN public.product_categories cat ON cat.id = pc.category_id
  WHERE sr.return_type = 'wastage'
    AND (_from IS NULL OR sr.date >= _from)
    AND (_to IS NULL OR sr.date <= _to)
  GROUP BY cat.id, cat.name
  ORDER BY total_wastage DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_wastage_by_category(date, date) TO authenticated;
