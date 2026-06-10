
ALTER TABLE public.slitting_entries ADD COLUMN IF NOT EXISTS batch_id uuid;
CREATE INDEX IF NOT EXISTS slitting_entries_batch_id_idx ON public.slitting_entries(batch_id);

-- Backfill: group sibling rows by (slitting_manager_id, date, product_code_id, created_at minute)
-- Rows saved together share the same created_at timestamp (insert in one query).
WITH groups AS (
  SELECT
    id,
    COALESCE(
      first_value(id) OVER (
        PARTITION BY slitting_manager_id, product_code_id, date, date_trunc('second', created_at)
        ORDER BY source_quantity DESC, id
      ),
      id
    ) AS anchor_id
  FROM public.slitting_entries
  WHERE batch_id IS NULL
)
UPDATE public.slitting_entries s
SET batch_id = g.anchor_id
FROM groups g
WHERE s.id = g.id AND s.batch_id IS NULL;
