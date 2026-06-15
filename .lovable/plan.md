## 1. Admin Production Logs (`src/pages/admin/ProductionLogs.tsx`)

- Remove the **Qty/Roll** and **Total** columns from the table header, body, and CSV export. Keep **Length (mtr)** and **Area (sqm)** columns as the source of truth.
- Update `colSpan` for the empty/loading rows from 16 → 14.
- No DB changes; underlying `quantity_per_roll`/`total_quantity` stay in the database and continue to drive the existing length/area derivation.
- Lab-report (FileText) icon stays on this panel — RM/36P circles are slitting-only (see §4).

## 2. Production Entry — Roll Width input + auto Weight

File: `src/pages/worker/ProductionEntry.tsx`

- Add a new optional input **"Roll Width (mm)"** alongside the existing roll/qty/GSM fields.
- On submit, persist the width into the entry's `notes` field using the existing `Width: <value>` marker the logs already parse (`parseNum("Width")` in ProductionLogs line 405). No schema change needed.
- Auto-compute and display **Weight (kg)** in the form using:

  ```text
  weight_kg = length_m × (width_mm / 1000) × gsm / 1000
  ```

  where `length_m = rolls × qty_per_roll` when unit is meters. Shown as a read-only preview next to the inputs.
- The Production Logs table already derives Area and Weight from width + GSM via the same formula, so existing rows with `Width:` in notes will start showing correct values automatically.

## 3. Admin Slitting Logs — CSV export

File: `src/pages/admin/SlittingLogs.tsx`

- Add an **Export CSV** button in the header (mirroring Production Logs): icon `Download`, variant outline, `sm` size.
- `exportCSV()` outputs the currently filtered rows with columns: Date, Source Product, Client, Operator, Source Qty, Unit, Thickness (mm), Cut Width (mm), Cut Length (mtr), Cut Qty Produced, Notes.
- Filename: `slitting_logs_<yyyy-MM-dd>.csv`.

## 4. Slitting Logs — replace lab-report icon with RM + 36P status circles

File: `src/pages/admin/SlittingLogs.tsx`

- Remove the existing FileText "Report" button and its `reportEntry` dialog block.
- Add two small circular badges in the Actions cell for each row:
  - **RM** — green when `slitting_returns` exist for this slitting entry, red otherwise.
  - **36P** — green when `head36_entries` exist for this slitting entry (already loaded into `head36ByEntry`), red otherwise.
- Each circle is a clickable `Button` (rounded-full, 28px, white text, `RM` / `36P` label). Clicking opens a popup dialog (same style as the prior Report dialog) listing the relevant records:
  - RM dialog: date, returned quantity, unit, notes from `slitting_returns`.
  - 36P dialog: date, operator, output qty, notes from `head36_entries`.
- "Returns exist" data: extend the existing slitting-entry fetch to also pull `slitting_returns` grouped by `slitting_entry_id` (mirrors the existing `head36ByEntry` map) so the green/red state and popup contents come from one query, no per-row fetches.

## Technical notes

- No database migrations.
- No changes to Material Return logic or its localStorage cache keys.
- Weight formula is identical to the one already used in `ProductionLogs.tsx` (`(width/1000) * length * gsm / 1000`), so values stay consistent across entry and logs.
- All visual additions reuse existing shadcn primitives (`Button`, `Dialog`, `Badge`-style rounded button) and the project's orange/dark-blue tokens — no hardcoded colors; green/red use `bg-emerald-500` / `bg-red-500` utility for the circle fill since they are status indicators, not theme surfaces.
