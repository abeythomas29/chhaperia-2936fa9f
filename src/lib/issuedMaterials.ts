// Frontend helper that mimics what a `list_manager_issued_materials()` RPC
// would return: every issue assigned to the calling user (whether finished
// stock from `stock_issues` or raw material from `raw_material_stock_entries`),
// enriched with consumed / returned / wastage / pending totals.
//
// Why a frontend helper? The backend RPC list is intentionally narrow
// (`list_slitting_issued_materials` only returns finished_stock and does not
// expose lot / display name / raw_material info). This helper unifies both
// sources without requiring a migration.
import { supabase } from "@/integrations/supabase/client";

export type IssueType = "finished_stock" | "raw_material";

export interface ManagerIssuedMaterial {
  /** Stable key, prefixed by source to avoid id collisions across tables. */
  key: string;
  /** Raw id stored on `slitting_entries.stock_issue_id` for consumption joins. */
  issue_id: string;
  issue_type: IssueType;
  source_table: "stock_issues" | "raw_material_stock_entries";
  product_code_id: string | null;
  raw_material_id: string | null;
  display_name: string;
  product_code: string | null;
  raw_material_name: string | null;
  thickness_mm: number | null;
  gsm: number | null;
  lot_number: string | null;
  unit: string;
  issued_quantity: number;
  consumed_quantity: number;
  returned_reusable: number;
  wastage: number;
  /** issued - consumed - returned_reusable - wastage (clamped at 0) */
  pending_quantity: number;
  date: string | null;
  notes: string | null;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export async function listManagerIssuedMaterials(userId: string): Promise<{
  data: ManagerIssuedMaterial[];
  errors: { source: string; message: string }[];
}> {
  const errors: { source: string; message: string }[] = [];

  // --- 1. Finished-stock issues assigned to me -----------------------------
  const fsRes = await supabase
    .from("stock_issues")
    .select("id, product_code_id, quantity, unit, notes, thickness_mm, date, created_at, recipient_user_id, recipient_type, product_codes(code)")
    .eq("recipient_type", "production_manager")
    .eq("recipient_user_id", userId)
    .order("date", { ascending: false })
    .limit(500);
  if (fsRes.error) {
    console.error("[issuedMaterials] stock_issues error", fsRes.error);
    errors.push({ source: "stock_issues", message: fsRes.error.message });
  }
  const fsRows = (fsRes.data ?? []) as Array<Record<string, unknown> & { product_codes?: { code: string } | null }>;

  // --- 2. Raw-material issues assigned to me -------------------------------
  // Live schema uses entry_type='issue' for outbound issuance.
  const rmRes = await (supabase as any)
    .from("raw_material_stock_entries")
    .select("id, raw_material_id, quantity, issue_quantity, issue_unit, issue_quantity_kg, thickness_mm, gsm, lot_number, date, created_at, notes, entry_type, issued_to_user_id, raw_materials(name, unit)")
    .eq("entry_type", "issue")
    .eq("issued_to_user_id", userId)
    .order("date", { ascending: false })
    .limit(500);
  if (rmRes.error) {
    console.error("[issuedMaterials] raw_material_stock_entries error", rmRes.error);
    errors.push({ source: "raw_material_stock_entries", message: rmRes.error.message });
  }
  const rmRows = (rmRes.data ?? []) as Array<Record<string, unknown> & { raw_materials?: { name: string; unit: string } | null }>;

  // --- 3. Aggregates: consumed (slitting) & returned/wastage per issue_id --
  const issueIds = [
    ...fsRows.map((r) => String(r.id)),
    ...rmRows.map((r) => String(r.id)),
  ];

  const consumedByIssue = new Map<string, number>();
  const returnedReusableByIssue = new Map<string, number>();
  const wastageByIssue = new Map<string, number>();

  if (issueIds.length) {
    const slitRes = await supabase
      .from("slitting_entries")
      .select("id, stock_issue_id, source_quantity")
      .in("stock_issue_id", issueIds);
    if (slitRes.error) {
      console.error("[issuedMaterials] slitting_entries error", slitRes.error);
      errors.push({ source: "slitting_entries", message: slitRes.error.message });
    }
    const slitRows = (slitRes.data ?? []) as Array<{ id: string; stock_issue_id: string | null; source_quantity: number | null }>;
    const entryToIssue = new Map<string, string>();
    for (const s of slitRows) {
      if (!s.stock_issue_id) continue;
      consumedByIssue.set(s.stock_issue_id, (consumedByIssue.get(s.stock_issue_id) ?? 0) + num(s.source_quantity));
      entryToIssue.set(s.id, s.stock_issue_id);
    }

    if (entryToIssue.size) {
      const retRes = await (supabase as any)
        .from("slitting_returns")
        .select("slitting_entry_id, returned_quantity, wastage_quantity, return_type")
        .in("slitting_entry_id", Array.from(entryToIssue.keys()));
      if (retRes.error) {
        console.error("[issuedMaterials] slitting_returns error", retRes.error);
        errors.push({ source: "slitting_returns", message: retRes.error.message });
      }
      const retRows = (retRes.data ?? []) as Array<{ slitting_entry_id: string; returned_quantity: number | null; wastage_quantity: number | null; return_type: string | null }>;
      for (const r of retRows) {
        const issueId = entryToIssue.get(r.slitting_entry_id);
        if (!issueId) continue;
        const type = (r.return_type ?? "reusable").toLowerCase();
        if (type === "wastage") {
          wastageByIssue.set(issueId, (wastageByIssue.get(issueId) ?? 0) + num(r.wastage_quantity ?? r.returned_quantity));
        } else {
          returnedReusableByIssue.set(issueId, (returnedReusableByIssue.get(issueId) ?? 0) + num(r.returned_quantity));
        }
      }
    }
  }

  // --- 4. Build unified list ----------------------------------------------
  const build = (
    issueId: string,
    base: Omit<ManagerIssuedMaterial,
      "consumed_quantity" | "returned_reusable" | "wastage" | "pending_quantity" | "key" | "issue_id"
    >,
  ): ManagerIssuedMaterial => {
    const consumed = consumedByIssue.get(issueId) ?? 0;
    const returned = returnedReusableByIssue.get(issueId) ?? 0;
    const waste = wastageByIssue.get(issueId) ?? 0;
    const pending = Math.max(0, base.issued_quantity - consumed - returned - waste);
    return {
      key: `${base.source_table === "stock_issues" ? "si" : "rmse"}:${issueId}`,
      issue_id: issueId,
      ...base,
      consumed_quantity: consumed,
      returned_reusable: returned,
      wastage: waste,
      pending_quantity: pending,
    };
  };

  const finished: ManagerIssuedMaterial[] = fsRows.map((r) =>
    build(String(r.id), {
      issue_type: "finished_stock",
      source_table: "stock_issues",
      product_code_id: (r.product_code_id as string | null) ?? null,
      raw_material_id: null,
      display_name: r.product_codes?.code ?? "Finished product",
      product_code: r.product_codes?.code ?? null,
      raw_material_name: null,
      thickness_mm: r.thickness_mm != null ? num(r.thickness_mm) : null,
      gsm: null,
      lot_number: null,
      unit: String(r.unit ?? "sqmtr"),
      issued_quantity: num(r.quantity),
      date: (r.date as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
    }),
  );

  const raw: ManagerIssuedMaterial[] = rmRows.map((r) => {
    const issueQty = r.issue_quantity != null ? num(r.issue_quantity) : num(r.quantity);
    const unit = String(r.issue_unit ?? r.raw_materials?.unit ?? "kg");
    return build(String(r.id), {
      issue_type: "raw_material",
      source_table: "raw_material_stock_entries",
      product_code_id: null,
      raw_material_id: (r.raw_material_id as string | null) ?? null,
      display_name: r.raw_materials?.name ?? "Raw material",
      product_code: null,
      raw_material_name: r.raw_materials?.name ?? null,
      thickness_mm: r.thickness_mm != null ? num(r.thickness_mm) : null,
      gsm: r.gsm != null ? num(r.gsm) : null,
      lot_number: (r.lot_number as string | null) ?? null,
      unit,
      issued_quantity: issueQty,
      date: (r.date as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
    });
  });

  const all = [...finished, ...raw].sort((a, b) =>
    (b.date ?? "").localeCompare(a.date ?? ""),
  );

  return { data: all, errors };
}
