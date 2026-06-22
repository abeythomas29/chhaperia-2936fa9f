## Overview

Six changes spanning inventory architecture, slitting workflow, and material return tracking. All stock is fully auto-derived from entries — no manual stock adjustments remain.

---

## 1. Fully automatic stock calculation

Stock is already derived in `src/lib/stock.ts` via `getFinishedProductAvailable` (production + slitting + head36 − issues − sales). Raw materials use DB triggers (`add_raw_material_stock`, `deduct_raw_material_stock`, sales triggers).

Changes:
- Remove the manual "Issue Stock" dialog's ability to act as an adjustment. Issue remains, but it only records an outbound movement — never edits stock directly.
- Add a small `useFinishedStock(productCodeId)` hook wrapping `getFinishedProductAvailable` for consistent live counts across pages.
- Dashboard/StockManagement read live values from the helper (no cached `current_stock` column on finished products).

---

## 2. Unified Inventory Management panel (replaces existing pages)

Replace separate **Stock Management** and **Raw Materials** nav items with a single **Inventory Management** route at `/admin/inventory` (and equivalent in Worker/Slitting layouts with reduced permissions).

Layout: one page, two columns side-by-side (stacks on mobile):

```text
+-------------------- Inventory Management --------------------+
|  FINISHED STOCK (auto)      |  RAW MATERIALS (auto)          |
|  product / thickness / qty  |  material / thickness / gsm    |
|  [Issue] [Edit]*            |  [Add Inward] [Edit]*          |
+--------------------------------------------------------------+
```

*Action buttons visible only per role (see #3).*

Routing changes:
- `/admin/stock` and `/admin/inventory` (raw materials) merge into `/admin/inventory`.
- `/worker/stock` and `/worker/inventory` → `/worker/inventory` (view-only).
- `/slitting` gets a new `/slitting/inventory` (view-only).
- Old route paths redirect to the new one to preserve bookmarks.

---

## 3. Role-based actions on inventory

| Role | Finished Stock | Raw Materials |
|---|---|---|
| Super Admin / Admin | Issue, Edit issue ledger | Add inward, Edit inward |
| Inventory Manager | Issue, Edit issue ledger | Add inward, Edit inward |
| Production Manager (worker) | View only | View only |
| Slitting Manager | View only | View only |

Implementation: gate buttons via `useAuth()` roles. RLS already enforces this server-side — confirm policies on `stock_issues` and `raw_material_stock_entries` allow `admin`, `super_admin`, `inventory_manager` for `INSERT/UPDATE/DELETE` and everyone authenticated for `SELECT`. Patch any missing policies in a migration.

---

## 4. Slitting sees only material issued to them

Source: existing `stock_issues` rows where `recipient_type = 'production_manager'` AND `recipient_user_id = auth.uid()` AND the recipient holds the `slitting_manager` role.

Schema addition (migration):
- `slitting_entries.stock_issue_id uuid NULL REFERENCES stock_issues(id)` — links a slitting run to the issue it consumed from.
- RPC `list_slitting_issued_materials()` (SECURITY DEFINER) returns, for the calling slitting manager, each open issue with: `issue_id`, `product_code_id`, product name/code, `thickness_mm`, `gsm` (joined from product_code if present, else from issue), `issued_quantity`, `consumed_quantity` (SUM of `slitting_entries.source_quantity` linked to that issue), `remaining_quantity`, `issue_date`, optional client/PO note. Only issues with `remaining > 0` are returned.

Slitting Entry form (`src/pages/slitting/SlittingEntryForm.tsx`):
- Replace product dropdown with an "Issued material" dropdown driven by the RPC.
- Selecting an item auto-fills product, thickness, GSM, and stores `stock_issue_id`.

---

## 5. Pending quantity shown live on slitting entry

After an issued material is selected in the Slitting Entry form, display below the qty input:

```text
Issued: 500 kg   Consumed: 320 kg   Pending: 180 kg
```

Validation: `source_quantity` must not exceed pending. After save, the same RPC re-fetches and updates the display. Pending also surfaces in the dropdown row as a subtitle.

---

## 6. Material Return — Reusable vs Wastage + Location

Schema migration on `slitting_returns`:
- `return_type text NOT NULL CHECK (return_type IN ('reusable','wastage'))` (default `'reusable'` for backfill).
- `location text NULL` (free-text now, will become FK to a future `storage_locations` table — keep column name stable).
- Backfill existing rows with `return_type='reusable'`.

UI changes in `src/pages/slitting/MaterialReturn.tsx`:
- Two radio/checkbox cards at the top: **Reusable** | **Wastage** (mutually exclusive).
- **Reusable** branch: existing fields (returned qty, notes) + new **Location** text input (placeholder: "Enter return location"). Comment in code marks the TODO for switching to a dropdown.
- **Wastage** branch: returned qty + notes only (no location). Saved with `return_type='wastage'`.

Reporting:
- New section on Inventory Management (admin/inventory manager only): **Total Wastage** grouped by product category (joined `slitting_returns → slitting_entries → product_codes → product_categories`) with date range filter.
- Reusable returns continue to flow back to available stock as today; wastage does NOT return to stock.

Stock impact rule (enforced in the helper / RPC):
- `reusable` return → adds to remaining of the source issue (already current behaviour via `remaining_returned`).
- `wastage` return → consumes from pending but is excluded from `remaining_returned`, so it never re-enters stock.

---

## Technical summary

**Migrations (one file, in order):**
1. `ALTER TABLE slitting_entries ADD COLUMN stock_issue_id uuid REFERENCES stock_issues(id);`
2. `ALTER TABLE slitting_returns ADD COLUMN return_type text NOT NULL DEFAULT 'reusable' CHECK (...)`, `ADD COLUMN location text`.
3. Backfill existing `slitting_returns`.
4. `CREATE OR REPLACE FUNCTION list_slitting_issued_materials()` (SECURITY DEFINER, returns open issues for `auth.uid()` slitting managers with consumed/pending).
5. Policy review on `stock_issues`, `raw_material_stock_entries`, `slitting_returns` to confirm role matrix in #3.

**Frontend files touched:**
- `src/App.tsx` — route changes + redirects.
- `src/layouts/{AdminLayout,WorkerLayout,SlittingManagerLayout,InventoryManagerLayout}.tsx` — nav items.
- New: `src/pages/inventory/InventoryManagement.tsx` (two-column unified page) — used by all roles, with conditional action buttons.
- Delete/redirect: `src/pages/admin/StockManagement.tsx`, `src/pages/admin/RawMaterials.tsx` (content moved into the unified page; keep helpers).
- `src/pages/slitting/SlittingEntryForm.tsx` — issued-material dropdown, pending display, validation.
- `src/pages/slitting/MaterialReturn.tsx` — reusable/wastage radio, location field.
- `src/lib/stock.ts` — extend helper for raw-material live counts and per-issue pending.

**Out of scope (for follow-up):**
- Location dropdown (waiting on location naming).
- PO entity (using existing `stock_issues` per your answer).
