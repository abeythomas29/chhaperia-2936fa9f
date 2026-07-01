import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Scissors, Plus, Trash2, ChevronDown, Layers, Package } from "lucide-react";
import { UNIT_OPTIONS } from "@/lib/units";
import { listManagerIssuedMaterials } from "@/lib/issuedMaterials";

interface ProductCode { id: string; code: string; category_id: string; }
interface Client { id: string; name: string; }
interface RawMaterial { id: string; name: string; unit: string; }
interface RollRow { width_mm: string; times_cut: string; rolls_per_cut: string; }
interface SourceRow { width_mm: string; length_mtr: string; rolls: string; }
interface IssuedMaterial {
  issue_id: string;
  source_table: "stock_issues" | "raw_material_stock_entries";
  issue_type: "raw_material" | "finished_stock" | string;
  product_code_id: string | null;
  raw_material_id: string | null;
  display_name: string;
  product_code: string | null;
  raw_material_name: string | null;
  thickness_mm: number | null;
  gsm: number | null;
  lot_number: string | null;
  unit: string | null;
  notes: string | null;
  issued_quantity: number;
  consumed_quantity: number;
  remaining_quantity: number;
}

export default function SlittingEntryForm() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(true);
  const [rollsOpen, setRollsOpen] = useState(true);
  const [rollRows, setRollRows] = useState<RollRow[]>([{ width_mm: "", times_cut: "", rolls_per_cut: "" }]);
  const [sourceRows, setSourceRows] = useState<SourceRow[]>([{ width_mm: "", length_mtr: "", rolls: "" }]);

  const [issuedMaterials, setIssuedMaterials] = useState<IssuedMaterial[]>([]);

  const [form, setForm] = useState({
    issue_id: "",
    product_code_id: "",
    client_id: "",
    entry_date: new Date().toISOString().slice(0, 10),

    // Direct inventory source (used when no issued material is selected)
    direct_source_type: "product" as "product" | "raw",
    direct_source_id: "",

    // Source product (shared)
    source_gsm: "",
    source_thickness_mm: "",
    source_unit: "meters",
    // Output rolls
    roll_length_mtr: "",
    unit: "meters",
    notes: "",
  });

  const reloadIssued = async () => {
    if (!user) return;
    // Unified frontend helper — pulls both raw_material and finished_stock
    // issues for the calling user with consumed/returned/wastage/pending.
    const { data: rows, errors } = await listManagerIssuedMaterials(user.id);
    if (errors.length) {
      console.error("[SlittingEntryForm] issued materials errors", errors);
      toast({
        title: "Could not load some issued materials",
        description: errors.map((e) => `${e.source}: ${e.message}`).join(" · "),
        variant: "destructive",
      });
    }
    const list: IssuedMaterial[] = rows
      .filter((r) => r.pending_quantity > 0.0001)
      .map((r) => ({
        issue_id: r.issue_id,
        source_table: r.source_table,
        issue_type: r.issue_type,
        product_code_id: r.product_code_id,
        raw_material_id: r.raw_material_id,
        display_name: r.display_name,
        product_code: r.product_code,
        raw_material_name: r.raw_material_name,
        thickness_mm: r.thickness_mm,
        gsm: r.gsm,
        lot_number: r.lot_number,
        unit: r.unit,
        notes: r.notes,
        issued_quantity: r.issued_quantity,
        consumed_quantity: r.consumed_quantity,
        remaining_quantity: r.pending_quantity,
      }));
    if (list.length === 0) {
      console.info("[SlittingEntryForm] no pending issued materials for user", user.id);
    }
    setIssuedMaterials(list);
  };

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [pc, cl, rm] = await Promise.all([
        supabase.from("product_codes").select("id, code, category_id").eq("status", "active").order("code"),
        supabase.from("company_clients").select("id, name").eq("status", "active").order("name"),
        supabase.from("raw_materials").select("id, name, unit").order("name"),
      ]);
      setProductCodes(pc.data ?? []);
      setClients((cl.data as Client[]) ?? []);
      setRawMaterials((rm.data as RawMaterial[]) ?? []);
      await reloadIssued();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const selectedIssue = issuedMaterials.find((i) => i.issue_id === form.issue_id) ?? null;

  // ---- Raw-material → product code matching (frontend only) ----
  const normalizeCode = (v: string | null | undefined) =>
    (v ?? "").toUpperCase().replace(/[\s\-_:./]+/g, "");

  const matchProductCodesForRawMaterial = (
    rawName: string | null | undefined,
    codes: ProductCode[],
  ): ProductCode[] => {
    const rmCode = normalizeCode(rawName);
    if (!rmCode) return [];
    const exact = codes.filter((p) => normalizeCode(p.code) === rmCode);
    if (exact.length) return exact;
    const prefix = codes.filter((p) => normalizeCode(p.code).startsWith(rmCode));
    if (prefix.length) return prefix;
    return codes.filter((p) => normalizeCode(p.code).includes(rmCode));
  };

  const candidateProductCodes =
    selectedIssue && selectedIssue.issue_type === "raw_material"
      ? matchProductCodesForRawMaterial(
          selectedIssue.raw_material_name ?? selectedIssue.display_name,
          productCodes,
        )
      : [];

  const productCodeOptions =
    selectedIssue?.issue_type === "raw_material" && candidateProductCodes.length > 0
      ? candidateProductCodes
      : productCodes;




  // Source calculations (summed across all source rows)
  const srcGsm = parseFloat(form.source_gsm) || 0;
  const validSourceRows = sourceRows.filter(
    (s) => parseFloat(s.width_mm) > 0 && parseFloat(s.length_mtr) > 0 && parseFloat(s.rolls) > 0
  );
  const sourceSqm = validSourceRows.reduce(
    (sum, s) => sum + (parseFloat(s.width_mm) / 1000) * parseFloat(s.length_mtr) * parseFloat(s.rolls),
    0
  );
  const sourceMeters = validSourceRows.reduce(
    (sum, s) => sum + parseFloat(s.length_mtr) * parseFloat(s.rolls),
    0
  );
  const sourceKg = (sourceSqm * srcGsm) / 1000;
  const sourceQty = form.source_unit === "kg" ? sourceKg : (form.source_unit === "sqmtr" ? sourceSqm : sourceMeters);

  const updateSourceRow = (i: number, patch: Partial<SourceRow>) =>
    setSourceRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addSourceRow = () => setSourceRows((rows) => [...rows, { width_mm: "", length_mtr: "", rolls: "" }]);
  const removeSourceRow = (i: number) => setSourceRows((rows) => rows.filter((_, idx) => idx !== i));


  // Output rolls calculations
  const rollLength = parseFloat(form.roll_length_mtr) || 0;
  const rowRolls = (r: RollRow) => (parseFloat(r.times_cut) || 0) * (parseFloat(r.rolls_per_cut) || 0);
  const validRollRows = rollRows.filter((r) => parseFloat(r.width_mm) > 0 && rowRolls(r) > 0);
  const totalRolls = validRollRows.reduce((s, r) => s + rowRolls(r), 0);
  const totalLength = rollLength * totalRolls;
  const totalSqm = rollLength
    ? validRollRows.reduce((s, r) => s + (parseFloat(r.width_mm) * rollLength / 1000) * rowRolls(r), 0)
    : 0;
  const totalKg = srcGsm > 0 && totalSqm > 0 ? (totalSqm * srcGsm) / 1000 : 0;

  const updateRollRow = (i: number, patch: Partial<RollRow>) =>
    setRollRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRollRow = () => setRollRows((rows) => [...rows, { width_mm: "", times_cut: "", rolls_per_cut: "" }]);
  const removeRollRow = (i: number) => setRollRows((rows) => rows.filter((_, idx) => idx !== i));

  // Area (sqm) is conserved when slitting — total meters can be more than source
  // because narrower cuts produce multiple parallel tapes. So validate by area.
  const exceedsSource = sourceSqm > 0 && totalSqm > sourceSqm + 1e-6;

  // Live consumed value from the current form, based on the unit of the selected issue.
  const liveConsumed = (() => {
    if (!selectedIssue) return 0;
    const u = (selectedIssue.unit ?? "").toLowerCase();
    if (u === "kg" || u === "kilograms" || u === "kgs") return totalKg;
    if (u === "sqm" || u === "sqmtr" || u === "square meters" || u === "sq meters") return totalSqm;
    if (u === "meters" || u === "mtr" || u === "m") return sourceMeters;
    // Fallback: assume same unit family as source
    return sourceQty;
  })();

  const displayedConsumed = (selectedIssue?.consumed_quantity ?? 0) + liveConsumed;
  const displayedPending = (selectedIssue?.issued_quantity ?? 0) - displayedConsumed;

  // Pending validation when a stock issue is selected — based on live consumed vs remaining.
  const exceedsPending =
    selectedIssue != null && liveConsumed > selectedIssue.remaining_quantity + 1e-6;

  const isIssued = !!selectedIssue;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (isIssued) {
      if (!form.product_code_id) {
        toast({ title: "Missing product code", description: "Select a product code for the produced rolls.", variant: "destructive" });
        return;
      }
      if (validRollRows.length === 0) {
        toast({ title: "Missing rolls", description: "Add at least one roll (width + count) under Rolls.", variant: "destructive" });
        return;
      }
      if (exceedsPending && selectedIssue) {
        toast({
          title: "Exceeds pending issued quantity",
          description: `Only ${selectedIssue.remaining_quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${selectedIssue.unit ?? ""} remaining on this issue.`,
          variant: "destructive",
        });
        return;
      }
    } else {
      if (!form.product_code_id || !sourceQty) {
        toast({ title: "Missing fields", description: "Select product code and fill source product details.", variant: "destructive" });
        return;
      }
      if (!form.direct_source_id) {
        toast({
          title: "Direct Inventory Source required",
          description: "No issued material selected. Pick a source item from inventory so stock is deducted.",
          variant: "destructive",
        });
        return;
      }
      if (validRollRows.length === 0) {
        toast({ title: "Missing rolls", description: "Add at least one roll (width + count) under Rolls.", variant: "destructive" });
        return;
      }
      if (exceedsSource) {
        toast({
          title: "Produced area exceeds source",
          description: `Produced area (${totalSqm.toLocaleString(undefined, { maximumFractionDigits: 2 })} sqm) cannot exceed source area (${sourceSqm.toLocaleString(undefined, { maximumFractionDigits: 2 })} sqm).`,
          variant: "destructive",
        });
        return;
      }
    }

    setSubmitting(true);

    // Only stock_issues.id values are valid FKs for slitting_entries.stock_issue_id.
    // Raw-material issues that originate from raw_material_stock_entries do NOT
    // have a matching stock_issues row and must be saved with null.
    const selectedStockIssueId =
      selectedIssue && selectedIssue.source_table === "stock_issues"
        ? selectedIssue.issue_id
        : null;

    console.log("saving slitting entry stock issue", {
      selectedStockIssueId,
      selectedIssuedMaterial: selectedIssue,
      existsInStockIssues: issuedMaterials.some(
        (x) => x.issue_id === selectedStockIssueId && x.source_table === "stock_issues",
      ),
    });

    if (
      selectedIssue &&
      selectedIssue.source_table === "stock_issues" &&
      !issuedMaterials.some(
        (x) => x.issue_id === selectedStockIssueId && x.source_table === "stock_issues",
      )
    ) {
      toast({
        title: "Invalid issued material",
        description: "Selected issued material is invalid. Please refresh and select again.",
        variant: "destructive",
      });
      setSubmitting(false);
      return;
    }

    const sourceNote = isIssued && selectedIssue
      ? `Source: issued lot ${selectedIssue.lot_number ?? "—"} (${liveConsumed.toFixed(2)} ${selectedIssue.unit ?? ""} of ${selectedIssue.issued_quantity} pending ${selectedIssue.remaining_quantity})`
      : `Source: ${validSourceRows.map((s, i) => `[R${i + 1} ${s.width_mm}mm × ${s.length_mtr}m × ${s.rolls}]`).join(" ")} (${sourceQty.toFixed(2)} ${form.source_unit})`;
    const isoDate = form.entry_date || new Date().toISOString().slice(0, 10);
    const batchId = (globalThis.crypto && "randomUUID" in globalThis.crypto) ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const sourceQtyForInsert = isIssued ? (totalSqm || liveConsumed) : sourceSqm;
    const rowsToInsert = validRollRows.map((r, idx) => {
      const tc = parseFloat(r.times_cut) || 0;
      const rpc = parseFloat(r.rolls_per_cut) || 0;
      const rolls = tc * rpc;
      return {
        product_code_id: form.product_code_id,
        client_id: form.client_id || null,
        stock_issue_id: selectedStockIssueId,
        date: isoDate,
        source_quantity: idx === 0 ? sourceQtyForInsert : 0,
        cut_quantity_produced: rollLength ? rollLength * rolls : rolls,
        cut_width_mm: parseFloat(r.width_mm),
        remaining_returned: 0,
        thickness_mm: form.source_thickness_mm ? parseFloat(form.source_thickness_mm) : null,
        gsm: form.source_gsm ? parseFloat(form.source_gsm) : null,
        unit: form.unit,
        batch_id: batchId,
        notes: [form.notes, `Roll ${idx + 1} of ${validRollRows.length}`, sourceNote, `Cuts: ${tc} × ${rpc} rolls/cut`, rollLength ? `RollLength: ${rollLength}m` : "", form.source_gsm ? `GSM: ${form.source_gsm}` : ""].filter(Boolean).join(" | "),
        slitting_manager_id: user.id,
        created_at: new Date(isoDate + "T12:00:00").toISOString(),
      };
    });

    const tryInsert = async (rows: any[]) => supabase.from("slitting_entries").insert(rows as any);
    let { error } = await tryInsert(rowsToInsert);

    if (error?.code === "PGRST204" && /'client_id' column/.test(error.message)) {
      const fb = rowsToInsert.map(({ client_id, ...row }) => row);
      ({ error } = await tryInsert(fb));
    }
    if (error?.code === "PGRST204" && /'gsm' column/.test(error.message)) {
      const fb = rowsToInsert.map(({ gsm, client_id, ...row }) => row);
      ({ error } = await tryInsert(fb));
    }
    if (error?.code === "PGRST204" && /'batch_id' column/.test(error.message)) {
      const fb = rowsToInsert.map(({ batch_id, ...row }) => row);
      ({ error } = await tryInsert(fb));
    }
    if (error?.code === "PGRST204" && /'stock_issue_id' column/.test(error.message)) {
      const fb = rowsToInsert.map(({ stock_issue_id, ...row }) => row);
      ({ error } = await tryInsert(fb));
    }

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      // Direct-inventory mode: write a mirror deduction row so the selected
      // source item's stock actually reduces (no stock_issue_id path).
      if (!isIssued && form.direct_source_id) {
        const thk = form.source_thickness_mm ? parseFloat(form.source_thickness_mm) : null;
        const noteDir = `Direct slitting consumption${form.notes ? ` — ${form.notes}` : ""}`;
        if (form.direct_source_type === "product") {
          const { error: siErr } = await supabase.from("stock_issues").insert({
            product_code_id: form.direct_source_id,
            quantity: sourceSqm || sourceQty,
            unit: "sqmtr",
            thickness_mm: thk,
            date: isoDate,
            issued_by: user.id,
            recipient_type: "slitting_direct",
            recipient_user_id: user.id,
            notes: noteDir,
          } as any);
          if (siErr) {
            toast({
              title: "Stock not deducted",
              description: `Slitting saved, but source stock deduction failed: ${siErr.message}`,
              variant: "destructive",
            });
          }
        } else {
          const gsm = form.source_gsm ? parseFloat(form.source_gsm) : null;
          const qtyKg = sourceKg || sourceQty;
          const { error: rmErr } = await (supabase as any).from("raw_material_stock_entries").insert({
            raw_material_id: form.direct_source_id,
            quantity: qtyKg,
            entry_type: "issue",
            issue_quantity: sourceQty,
            issue_unit: form.source_unit,
            issue_quantity_kg: qtyKg,
            thickness_mm: thk,
            gsm,
            date: isoDate,
            added_by: user.id,
            issued_to_user_id: user.id,
            notes: noteDir,
          });
          if (rmErr) {
            toast({
              title: "Raw material stock not deducted",
              description: `Slitting saved, but raw material deduction failed (permission?): ${rmErr.message}`,
              variant: "destructive",
            });
          }
        }
      }

      toast({ title: `Saved ${rowsToInsert.length} roll entries` });
      setForm({
        ...form,
        issue_id: "",
        direct_source_id: "",
        source_gsm: "", source_thickness_mm: "",
        roll_length_mtr: "", notes: "",
      });
      setSourceRows([{ width_mm: "", length_mtr: "", rolls: "" }]);
      setRollRows([{ width_mm: "", times_cut: "", rolls_per_cut: "" }]);
      await reloadIssued();
    }
    setSubmitting(false);
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Scissors className="h-5 w-5" /> New Slitting Entry</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Issued Material — only materials issued to this slitting manager */}
          <div className="space-y-2 rounded-lg border-2 border-secondary/30 bg-secondary/5 p-3">
            <Label className="font-semibold">Issued Material (optional — from Inventory Manager)</Label>
            <SearchableSelect
              value={form.issue_id}
              onValueChange={async (v) => {
                const iss = issuedMaterials.find((i) => i.issue_id === v);
                if (!iss) {
                  setForm({ ...form, issue_id: v });
                  return;
                }
                if (iss.issue_type === "finished_stock" && !iss.product_code_id) {
                  toast({
                    title: "Cannot select this issue",
                    description: "Finished stock issue is missing its product code. Ask inventory to re-issue.",
                    variant: "destructive",
                  });
                  return;
                }
                let gsmFromIssue: number | null = iss.gsm;
                // Fallback only for raw_material: try matching raw_material_stock_entries
                if ((!gsmFromIssue || gsmFromIssue <= 0) && iss.raw_material_id) {
                  const { data: rmse } = await supabase
                    .from("raw_material_stock_entries")
                    .select("gsm")
                    .eq("raw_material_id", iss.raw_material_id)
                    .eq("entry_type", "in")
                    .not("gsm", "is", null)
                    .order("date", { ascending: false })
                    .limit(1);
                  if (rmse && rmse.length && rmse[0].gsm != null) {
                    gsmFromIssue = Number(rmse[0].gsm);
                  }
                }
                let nextProductCodeId = form.product_code_id;
                if (iss.product_code_id) {
                  // A. finished stock or raw issue with an explicit product code
                  nextProductCodeId = iss.product_code_id;
                } else if (iss.issue_type === "raw_material") {
                  // B. raw material — match by normalized code
                  const matches = matchProductCodesForRawMaterial(
                    iss.raw_material_name ?? iss.display_name,
                    productCodes,
                  );
                  console.log("issued raw material product mapping", {
                    rawMaterialId: iss.raw_material_id,
                    rawMaterialName: iss.raw_material_name ?? iss.display_name,
                    stockIssueProductCodeId: iss.product_code_id,
                    candidateProductCodes: matches.map((m) => m.code),
                    selectedProductCodeId: matches.length === 1 ? matches[0].id : null,
                  });
                  // C/D/E: only auto-select when exactly one match is found
                  nextProductCodeId = matches.length === 1 ? matches[0].id : "";
                }

                setForm({
                  ...form,
                  issue_id: v,
                  product_code_id: nextProductCodeId,

                  source_thickness_mm: iss.thickness_mm != null ? String(iss.thickness_mm) : form.source_thickness_mm,
                  source_gsm: gsmFromIssue != null && gsmFromIssue > 0 ? String(gsmFromIssue) : form.source_gsm,
                });
              }}
              placeholder={issuedMaterials.length ? "Select issued material to slit" : "No pending issued material"}
              options={issuedMaterials.map((i) => ({
                value: i.issue_id,
                label: `${i.display_name} | Lot ${i.lot_number ?? "—"} | ${i.thickness_mm ?? "—"} mm | GSM ${i.gsm ?? "—"} | Pending ${Number(i.remaining_quantity).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${i.unit ?? ""}`,
                keywords: `${i.display_name} ${i.product_code ?? ""} ${i.raw_material_name ?? ""} ${i.lot_number ?? ""}`,
              }))}
            />
            {selectedIssue && (
              <div className="grid grid-cols-3 gap-2 text-xs pt-1">
                <div>Issued: <b>{Number(selectedIssue.issued_quantity).toLocaleString(undefined, { maximumFractionDigits: 2 })} {selectedIssue.unit ?? ""}</b></div>
                <div>
                  Consumed: <b>{displayedConsumed.toLocaleString(undefined, { maximumFractionDigits: 2 })} {selectedIssue.unit ?? ""}</b>
                  {liveConsumed > 0 && (
                    <span className="text-muted-foreground"> ({Number(selectedIssue.consumed_quantity).toLocaleString(undefined, { maximumFractionDigits: 2 })} saved + {liveConsumed.toLocaleString(undefined, { maximumFractionDigits: 2 })} live)</span>
                  )}
                </div>
                <div>Pending: <b className={exceedsPending ? "text-destructive" : "text-secondary"}>{displayedPending.toLocaleString(undefined, { maximumFractionDigits: 2 })} {selectedIssue.unit ?? ""}</b></div>
              </div>
            )}
            {!loading && issuedMaterials.length === 0 && (
              <div className="text-xs text-muted-foreground">No pending issued material found for your account.</div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-3">
            <div className="space-y-2">
              <Label>Product Code *</Label>
              <SearchableSelect
                value={form.product_code_id}
                onValueChange={(v) => setForm({ ...form, product_code_id: v })}
                placeholder="Select product code"
                options={productCodeOptions.map((pc) => ({ value: pc.id, label: pc.code }))}
              />
              {selectedIssue?.issue_type === "raw_material" && (
                <>
                  {candidateProductCodes.length === 0 && (
                    <p className="text-xs text-destructive">
                      No product code mapped for issued raw material "{selectedIssue.raw_material_name ?? selectedIssue.display_name}". Pick one manually.
                    </p>
                  )}
                  {candidateProductCodes.length > 1 && (
                    <p className="text-xs text-muted-foreground">
                      Select matching product code for issued material {selectedIssue.raw_material_name ?? selectedIssue.display_name} ({candidateProductCodes.length} matches).
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="space-y-2">
              <Label>Date *</Label>
              <Input type="date" value={form.entry_date}
                onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Client (Optional)</Label>
            <SearchableSelect
              value={form.client_id}
              onValueChange={(v) => setForm({ ...form, client_id: v })}
              placeholder="Select client (optional)"
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>


          {/* Source Product */}
          <Collapsible open={sourceOpen} onOpenChange={setSourceOpen} className="border rounded-lg">
            <CollapsibleTrigger asChild>
              <button type="button" className="w-full flex items-center justify-between p-3 text-left">
                <span className="flex items-center gap-2 font-medium">
                  <Package className="h-4 w-4" /> Source Product *
                  {sourceQty > 0 && <span className="text-xs text-muted-foreground">— {sourceQty.toLocaleString(undefined, { maximumFractionDigits: 2 })} {form.source_unit}</span>}
                </span>
                <ChevronDown className={`h-4 w-4 transition-transform ${sourceOpen ? "rotate-180" : ""}`} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="px-3 pb-3 space-y-3">
              {isIssued && selectedIssue ? (
                <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
                  <div className="font-medium">Source from issued material</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                    <div>Material: <b>{selectedIssue.display_name}</b></div>
                    <div>Lot: <b>{selectedIssue.lot_number ?? "—"}</b></div>
                    <div>Thickness: <b>{selectedIssue.thickness_mm ?? "—"} mm</b></div>
                    <div>GSM: <b>{selectedIssue.gsm ?? "—"}</b></div>
                    <div>Unit: <b>{selectedIssue.unit ?? "—"}</b></div>
                    <div>Pending: <b>{Number(selectedIssue.remaining_quantity).toLocaleString(undefined, { maximumFractionDigits: 2 })} {selectedIssue.unit ?? ""}</b></div>
                  </div>
                  <p className="text-xs text-muted-foreground pt-1">
                    Source quantity is taken from this issued material — you do not need to enter source width/length/rolls.
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    Add one row per source roll. Use multiple rows if rolls have different dimensions.
                  </p>
                  {sourceRows.map((s, idx) => {
                    const w = parseFloat(s.width_mm) || 0;
                    const l = parseFloat(s.length_mtr) || 0;
                    const n = parseFloat(s.rolls) || 0;
                    const rowSqm = (w / 1000) * l * n;
                    return (
                      <div key={idx} className="space-y-2 border-l-2 pl-3">
                        <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                          <div className="space-y-1">
                            <Label className="text-xs">Source Width (mm) — Roll {idx + 1}</Label>
                            <Input type="number" step="any" value={s.width_mm}
                              onChange={(e) => updateSourceRow(idx, { width_mm: e.target.value })} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Source Length (mtr)</Label>
                            <Input type="number" step="any" value={s.length_mtr}
                              onChange={(e) => updateSourceRow(idx, { length_mtr: e.target.value })} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">No. of Rolls</Label>
                            <Input type="number" step="any" value={s.rolls}
                              onChange={(e) => updateSourceRow(idx, { rolls: e.target.value })} />
                          </div>
                          <Button type="button" variant="ghost" size="icon" onClick={() => removeSourceRow(idx)} disabled={sourceRows.length === 1}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        {rowSqm > 0 && (
                          <p className="text-xs text-muted-foreground">Area: <span className="font-semibold text-foreground">{rowSqm.toLocaleString(undefined, { maximumFractionDigits: 2 })} sqm</span></p>
                        )}
                      </div>
                    );
                  })}
                  <Button type="button" variant="outline" size="sm" onClick={addSourceRow}>
                    <Plus className="h-4 w-4 mr-1" /> Add Roll
                  </Button>
                </>
              )}

              <div className="grid grid-cols-3 gap-3 pt-2 border-t">
                <div className="space-y-1">
                  <Label className="text-xs">
                    {selectedIssue ? "GSM (from issued material)" : "GSM"}
                  </Label>
                  <Input
                    type="number"
                    step="any"
                    value={form.source_gsm}
                    readOnly={!!selectedIssue}
                    placeholder={selectedIssue && !form.source_gsm ? "GSM not available" : ""}
                    className={selectedIssue ? "bg-muted cursor-not-allowed" : ""}
                    onChange={(e) => setForm({ ...form, source_gsm: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    {selectedIssue ? "Thickness (mm) (from issued material)" : "Thickness (mm)"}
                  </Label>
                  <Input
                    type="number"
                    step="any"
                    value={form.source_thickness_mm}
                    readOnly={!!selectedIssue}
                    className={selectedIssue ? "bg-muted cursor-not-allowed" : ""}
                    onChange={(e) => setForm({ ...form, source_thickness_mm: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Unit</Label>
                  <Select value={form.source_unit} onValueChange={(v) => setForm({ ...form, source_unit: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {UNIT_OPTIONS.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CollapsibleContent>

          </Collapsible>

          {/* Output Rolls */}
          <Collapsible open={rollsOpen} onOpenChange={setRollsOpen} className="border rounded-lg">
            <CollapsibleTrigger asChild>
              <button type="button" className="w-full flex items-center justify-between p-3 text-left">
                <span className="flex items-center gap-2 font-medium">
                  <Layers className="h-4 w-4" /> Rolls *{validRollRows.length > 0 && <span className="text-xs text-muted-foreground">— {validRollRows.length} added</span>}
                </span>
                <ChevronDown className={`h-4 w-4 transition-transform ${rollsOpen ? "rotate-180" : ""}`} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="px-3 pb-3 space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Produced Roll Length (mtr)</Label>
                <Input type="number" step="any" value={form.roll_length_mtr}
                  onChange={(e) => setForm({ ...form, roll_length_mtr: e.target.value })} />
              </div>

              <p className="text-xs text-muted-foreground">
                Add one row per roll width. Use multiple rows if some rolls came narrower than required.
              </p>
              {rollRows.map((r, idx) => {
                const tc = parseFloat(r.times_cut) || 0;
                const rpc = parseFloat(r.rolls_per_cut) || 0;
                const rolls = tc * rpc;
                return (
                  <div key={idx} className="space-y-2 border-l-2 pl-3">
                    <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                      <div className="space-y-1">
                        <Label className="text-xs">Roll {idx + 1} Width (mm)</Label>
                        <Input type="number" step="any" value={r.width_mm}
                          onChange={(e) => updateRollRow(idx, { width_mm: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Times Cut</Label>
                        <Input type="number" step="any" value={r.times_cut}
                          onChange={(e) => updateRollRow(idx, { times_cut: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Rolls per Cutting</Label>
                        <Input type="number" step="any" value={r.rolls_per_cut}
                          onChange={(e) => updateRollRow(idx, { rolls_per_cut: e.target.value })} />
                      </div>
                      <Button type="button" variant="ghost" size="icon" onClick={() => removeRollRow(idx)} disabled={rollRows.length === 1}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    {rolls > 0 && (
                      <p className="text-xs text-muted-foreground">Total rolls: <span className="font-semibold text-foreground">{rolls.toLocaleString()}</span> ({tc} × {rpc})</p>
                    )}
                  </div>
                );
              })}
              <Button type="button" variant="outline" size="sm" onClick={addRollRow}>
                <Plus className="h-4 w-4 mr-1" /> Add Roll
              </Button>
            </CollapsibleContent>
          </Collapsible>

          {/* Auto-calculated totals shown in all units below */}
          <div className="bg-muted rounded-lg p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-center">

            <div>
              <p className="text-xs text-muted-foreground">Total Rolls</p>
              <p className="text-xl font-bold text-primary">{totalRolls.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Length</p>
              <p className="text-xl font-bold text-primary">{totalLength.toLocaleString()} <span className="text-sm font-normal">mtr</span></p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total (sqm)</p>
              <p className="text-xl font-bold text-primary">{totalSqm.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-sm font-normal">sqm</span></p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total (kg)</p>
              <p className="text-xl font-bold text-primary">{srcGsm > 0 ? totalKg.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "-"} <span className="text-sm font-normal">kg</span></p>
            </div>
          </div>
          {srcGsm <= 0 && (
            <p className="text-xs text-muted-foreground -mt-2 text-center">Enter GSM in Source Product to calculate total kg.</p>
          )}

          {!isIssued && exceedsSource && (
            <p className="text-xs text-destructive text-center">
              Produced area ({totalSqm.toLocaleString(undefined, { maximumFractionDigits: 2 })} sqm) exceeds source area ({sourceSqm.toLocaleString(undefined, { maximumFractionDigits: 2 })} sqm). Total cut area cannot exceed source area.
            </p>
          )}

          <div className="space-y-2">
            <Label>Notes / Remarks</Label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>

          <Button type="submit" className="w-full bg-secondary hover:bg-secondary/90 text-secondary-foreground" disabled={submitting || (!isIssued && exceedsSource) || exceedsPending}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Slitting Entry
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
