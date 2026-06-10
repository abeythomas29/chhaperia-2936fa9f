
-- More aggressive backfill: group sibling slitting rows by (manager, product, date) within the same minute
WITH groups AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY slitting_manager_id, product_code_id, date, date_trunc('minute', created_at)
      ORDER BY source_quantity DESC, created_at, id
    ) AS anchor_id
  FROM public.slitting_entries
)
UPDATE public.slitting_entries s
SET batch_id = g.anchor_id
FROM groups g
WHERE s.id = g.id
  AND (s.batch_id IS NULL OR s.batch_id <> g.anchor_id);
