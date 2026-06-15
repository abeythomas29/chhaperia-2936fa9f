## Goal
Bring back the lab report icon in Production Logs, re-add the 36P icon there too, make the RM / 36P / LR status circles correctly turn **green when data exists and red when not**, and confirm the Slitting Logs export is present and visible.

## Changes

### 1. Production Logs — restore Lab Report (LR) icon
- Add `reportEntry` state and a `LR` status button next to RM in the Actions column.
- Green when `hasReport` is true (any of: gsm, thickness_mm, tensile_strength, elongation, swelling_height, swelling_speed, surface_resistance from columns OR parsed from notes), red otherwise.
- Clicking opens a dialog listing each lab field with its value (skipping empty ones), styled like the existing RM dialog.

### 2. Production Logs — restore 36P icon
- Re-add the 36P status button next to RM/LR using existing `head36ByProduct` state.
- Clicking opens the existing 36-Head Production dialog.

### 3. Fix "green when data exists" for RM and 36P
Investigate why circles stay red despite data:

- **RM**: confirm `raw_material_usage(quantity_used, raw_materials(name, unit))` join returns rows. If the join silently fails (RLS on `raw_materials` / `raw_material_usage` blocking reads for admins), green never triggers. Plan: verify RLS allows admins to SELECT both tables; if not, add admin SELECT policies. Also treat `raw_material_included = true` as green even without usage rows.
- **36P**: current logic groups `head36_entries` by `slitting_entries.product_code_id`, so a production entry only goes green if some slitting entry for the **same product code** has 36P data. This is the source of confusion — production and 36P aren't actually linked that way. Fix: scope the green state to production entries whose product code has at least one 36P run, and update the button title to read "36-head production exists for this product code".

### 4. Slitting Logs — export
- The Export CSV button already exists in the header (top-right of the card). Verify it's rendered and clickable; if anything is hiding it, fix the layout so it sits next to the title like in Production Logs.
- No new export format unless requested.

## Out of scope
- Changing how 36P entries are linked to production at the DB level.
- Adding lab fields to the Edit dialog (only the read-only LR view dialog is added).

## Technical notes
- Files: `src/pages/admin/ProductionLogs.tsx`, `src/pages/admin/SlittingLogs.tsx`.
- Possible migration: SELECT policy for `admin` / `super_admin` on `raw_materials` and `raw_material_usage` if missing — only added if a quick `supabase--read_query` confirms the join returns empty for known entries.
- Icon: reuse `FileText` (or text "LR") to match the RM/36P circle pattern (`h-7 w-7 rounded-full`, emerald-500 / red-500).
