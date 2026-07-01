
# Unit Logic & Consumption Fix Plan (Frontend Only)

Core rule enforced everywhere:
- **Meters** = roll length / reference only.
- **SQM or KG** = the balance/consumption/validation unit.
- Consume via `stock_issue_id` when an issued material is chosen; otherwise consume from direct inventory source. Never both, never skip.

No database migrations. All changes are React/TS.

---

## A. Finished Stock — per-entry GSM conversion
File: `src/pages/admin/StockManagement.tsx`

- Replace the single "product default GSM" lookup with a per-row resolver:
  1. `stock_issues.gsm` for issue rows
  2. `slitting_entries.gsm` for slitting-produced rows
  3. `production_entries.gsm` for production rows
  4. `head36_entries.gsm` for 36 head rows
  5. Fallback to product default GSM only if row GSM is null/0
- KG formula: `kg = sqm * gsm / 1000`
- Show `Missing GSM` badge instead of a wrong number when both row GSM and product GSM are missing.
- Acceptance: CP25GE 0.15 mm, 2,000 sqm, GSM 230 → **460 kg**.

## B. Slitting / Production direct-inventory mode
File: `src/pages/slitting/SlittingEntryForm.tsx`

- Keep both modes (Issued Material vs Direct Inventory / No Order).
- Issued mode → save `stock_issue_id`, leave source columns null.
- Direct mode → require source product/raw material + qty + unit + thickness + GSM; save `source_product_code_id` **or** `source_raw_material_id` with `source_quantity`, `source_unit`, `source_thickness_mm`, `source_gsm`.
- After submit, invalidate the inventory queries so available balances refresh.
- Guard: cannot submit without either an issued material or a direct source.

## C. 36 Head validation — area/mass, not linear meters
File: `src/pages/slitting/Head36Entry.tsx`

- Already migrated to sqm in prior turn; harden it:
  - When source is kg-based, compare `totalKg` vs `secondary_pending_kg` using per-entry GSM.
  - When source is sqm-based, compare `totalSqm` vs `secondary_pending_sqm` (current behavior).
  - Never gate on `totalLength` meters.
- Show summary card in the same unit as the source (sqm or kg), meters displayed only as `m ref`.
- Acceptance: 12,800 sqm submits when pending sqm ≥ 12,800 regardless of tape meters.

## D. 36 Head form UX
Same file.

- Source dropdown restricted to slitting entries in the same issued stock chain (already using `list_36_head_source_slitting_entries`; keep).
- Auto-carry `client_id` from the selected slitting entry; if none, mark client required.
- Multi-row Add Roll UI (already present); persist `slitting_entry_id` and `stock_issue_id` on submit.

## E. Material Return
File: `src/pages/slitting/MaterialReturn.tsx`

- List pending under the same issue chain: `primary_pending + secondary_pending` per issued log.
- Two disposition options per return row: **Reusable** vs **Wastage**.
- Client-side guard: `return_qty <= pending_qty` in the row's unit; block submit and show inline error otherwise.
- Refresh pending list after submit.

## F. Error handling & build
- Show the raw RPC error message via toast when GSM/pending fields are missing.
- Run `tsgo` and fix any type errors introduced.

---

## Technical notes

- Per-entry GSM resolution runs client-side in `StockManagement.tsx`; no new RPCs.
- Direct-inventory columns on `slitting_entries` (`source_product_code_id`, `source_raw_material_id`, `source_quantity`, `source_unit`, `source_thickness_mm`, `source_gsm`) are assumed to exist. If any column is missing at runtime, the insert falls back to stashing the source metadata in `notes` (same pattern used for 36 Head) and surfaces a toast.
- `stock.ts` `getFinishedProductAvailable` is left as-is — it already nets issues and sales.

Confirm and I'll implement.
