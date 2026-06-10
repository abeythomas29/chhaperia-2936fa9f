
## Problem

When one slitting submission produces multiple rows (different cut widths), only the **first row** stores the full `source_quantity` and the other rows store 0. In Material Return, this shows up as 4 separate entries — one with the real source quantity and three with "0 source / negative wastage". The user wants these merged back into one source on the return screen.

## Approach

Tag every row created together with a shared `batch_id`, then group by batch in Material Return.

### 1. Database

Add to `slitting_entries`:
- `batch_id uuid` (nullable, indexed) — shared by all rows saved in the same submission.

Backfill existing data: for each `slitting_manager_id + date + product_code_id + (source_quantity>0 anchor)` group, assign a single `batch_id` to all sibling rows that were inserted together (rows with `source_quantity > 0` start a new batch; following sibling rows with `source_quantity = 0` within the same insert window share that batch).

### 2. Slitting Entry Form

When saving multi-row submissions, generate one `crypto.randomUUID()` and attach it to every inserted row as `batch_id`.

### 3. Material Return — selection dropdown

Fetch slitting rows, then group client-side by `batch_id` (rows without a batch fall back to their own id). For each batch build a synthetic option:

```
dd/mm/yy — PRODUCT CODE — total source qty unit  (4 widths)
```

`source_quantity` for the batch = sum across rows (only the anchor row carries it, so the sum is the true issued amount).

### 4. Material Return — summary panel

After selecting a batch, show:

- **Issued (sqm)** = anchor row source converted to sqm (already in sqm today)
- **Produced (sqm)** = sum of `(cut_width_mm/1000) × cut_quantity_produced` across all rows in the batch
- **Already Returned** = sum of existing `slitting_returns.returned_quantity` for **any** row in the batch
- **Thickness Breakdown** list, one line per distinct `(cut_width_mm, thickness_mm)`:
  - `12 mm · 0.10 mm — 960 sqm produced`
  - `15 mm · 0.10 mm — 225 sqm produced`
  - `15 mm · 0.10 mm — 960 sqm produced` (separate entries kept if widths repeat with same thickness, merged if identical)
- **Wastage** = Issued − Produced − Already Returned

### 5. Saving the return

Store the return against the **anchor row** (the one with `source_quantity > 0`) of the batch, so existing `slitting_returns.slitting_entry_id` schema stays unchanged. Because History/Logs aggregate returns by `slitting_entry_id`, also propagate the "R" marker to siblings by, in History/Logs queries, joining returns through `batch_id`:

- In `SlittingHistory.tsx` and `SlittingLogs.tsx`, when building `returnsMap`, group returns by `batch_id` (look up via the row's batch) so every sibling row in the same batch shows the **R** badge and shares the return list.

### 6. Out of scope

- No change to 36 Head, Production, Sales, or Stock screens.
- No change to how slitting rows are created at the row level (still one DB row per cut width).
- Existing return entries continue to work because they already point to the anchor row.

## Files to change

- `supabase/migrations/...` — add `batch_id` column + index + backfill.
- `src/pages/slitting/SlittingEntryForm.tsx` — generate and insert shared `batch_id`.
- `src/pages/slitting/MaterialReturn.tsx` — group by batch, merged summary with thickness breakdown, save against anchor.
- `src/pages/slitting/SlittingHistory.tsx` — share returns/R badge across batch siblings.
- `src/pages/admin/SlittingLogs.tsx` — same R-badge propagation (if it shows the marker).

