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

interface ProductCode { id: string; code: string; category_id: string; }
interface Client { id: string; name: string; }
interface RollRow { width_mm: string; times_cut: string; rolls_per_cut: string; }
interface SourceRow { width_mm: string; length_mtr: string; rolls: string; }
interface IssuedMaterial {
  issue_id: string;
  issue_date: string;
  product_code_id: string;
  product_code: string | null;
  thickness_mm: number | null;
  gsm: number | null;
  raw_material_id: string | null;
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

    // Read ALL issues to this user (finished + raw) directly from stock_issues.
    // Avoid the RPC because backend versions can throw
    // "column reference stock_issue_id is ambiguous".
    const { data: siRows, error: siErr } = await supabase
      .from("stock_issues")
      .select("*")
      .or(`recipient_user_id.eq.${user.id},issued_to_user_id.eq.${user.id}`)
      .order("date", { ascending: false });

    if (siErr) {
      toast({ title: "Could not load issued materials", description: siErr.message, variant: "destructive" });
      console.error("stock_issues fetch error", siErr);
      setIssuedMaterials([]);
      return;
    }

    const issues = ((siRows ?? []) as any[]).map((r) => ({
      ...r,
      _type: (r.issue_type ?? (r.raw_material_id ? "raw_material" : "finished_stock")) as
        | "raw_material"
        | "finished_stock",
    }));

    // Lookups
    const rmIds = Array.from(new Set(issues.filter((r) => r._type === "raw_material").map((r) => r.raw_material_id).filter(Boolean)));
    const pcIds = Array.from(new Set(issues.filter((r) => r._type === "finished_stock").map((r) => r.product_code_id).filter(Boolean)));
    const [rmRes, pcRes] = await Promise.all([
      rmIds.length ? supabase.from("raw_materials").select("id, name").in("id", rmIds) : Promise.resolve({ data: [] as any[] }),
      pcIds.length ? supabase.from("product_codes").select("id, code").in("id", pcIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const rmMap = new Map<string, string>((rmRes.data ?? []).map((r: any) => [r.id, r.name]));
    const pcMap = new Map<string, string>((pcRes.data ?? []).map((r: any) => [r.id, r.code]));

    // Consumed quantity per stock_issue_id from slitting_entries (single-table query — no ambiguity).
    const issueIds = issues.map((r) => r.id as string);
    const consumedMap = new Map<string, number>();
    if (issueIds.length) {
      const { data: consumedRows, error: cErr } = await supabase
        .from("slitting_entries")
        .select("stock_issue_id, source_quantity")
        .in("stock_issue_id", issueIds);
      if (cErr) {
        console.error("slitting_entries consumed lookup error", cErr);
      }
      for (const c of (consumedRows ?? []) as any[]) {
        const k = c.stock_issue_id as string;
        if (!k) continue;
        consumedMap.set(k, (consumedMap.get(k) ?? 0) + Number(c.source_quantity ?? 0));
      }
    }

    const list: IssuedMaterial[] = issues.map((r) => {
      const unit = r.issue_unit ?? r.unit ?? (r._type === "raw_material" ? "kg" : "sqm");
      const issuedKg = r.issue_quantity_kg != null ? Number(r.issue_quantity_kg) : null;
      const issuedSqm = r.issue_quantity_sqm != null ? Number(r.issue_quantity_sqm) : null;
      const issuedRaw = Number(r.issue_quantity ?? r.quantity ?? 0);
      const issued = unit === "kg"
        ? (issuedKg ?? issuedRaw)
        : unit === "sqm"
          ? (issuedSqm ?? issuedRaw)
          : issuedRaw;
      const consumed = consumedMap.get(r.id) ?? 0;
      const label = r._type === "raw_material"
        ? (rmMap.get(r.raw_material_id) ?? "Raw Material")
        : (pcMap.get(r.product_code_id) ?? "—");
      return {
        issue_id: r.id,
        issue_date: r.date ?? r.created_at,
        product_code_id: r._type === "finished_stock" ? (r.product_code_id ?? "") : "",
        product_code: label,
        thickness_mm: r.thickness_mm != null ? Number(r.thickness_mm) : null,
        gsm: r.gsm != null ? Number(r.gsm) : null,
        raw_material_id: r.raw_material_id ?? null,
        unit,
        notes: r.notes,
        issued_quantity: issued,
        consumed_quantity: consumed,
        remaining_quantity: issued - consumed,
      };
    }).filter((x) => x.remaining_quantity > 0);

    setIssuedMaterials(list);
  };

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [pc, cl] = await Promise.all([
        supabase.from("product_codes").select("id, code, category_id").eq("status", "active").order("code"),
        supabase.from("company_clients").select("id, name").eq("status", "active").order("name"),
      ]);
      setProductCodes(pc.data ?? []);
      setClients((cl.data as Client[]) ?? []);
      await reloadIssued();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const selectedIssue = issuedMaterials.find((i) => i.issue_id === form.issue_id) ?? null;


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

  // Pending validation when a stock issue is selected
  const exceedsPending =
    selectedIssue != null && sourceQty > selectedIssue.remaining_quantity + 1e-6;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!form.product_code_id || !sourceQty) {
      toast({ title: "Missing fields", description: "Select product code and fill source product details.", variant: "destructive" });
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
    if (exceedsPending && selectedIssue) {
      toast({
        title: "Exceeds pending issued quantity",
        description: `Only ${selectedIssue.remaining_quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${selectedIssue.unit ?? ""} remaining on this issue.`,
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);

    const sourceNote = `Source: ${validSourceRows.map((s, i) => `[R${i + 1} ${s.width_mm}mm × ${s.length_mtr}m × ${s.rolls}]`).join(" ")} (${sourceQty.toFixed(2)} ${form.source_unit})`;
    const isoDate = form.entry_date || new Date().toISOString().slice(0, 10);
    const batchId = (globalThis.crypto && "randomUUID" in globalThis.crypto) ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const rowsToInsert = validRollRows.map((r, idx) => {
      const tc = parseFloat(r.times_cut) || 0;
      const rpc = parseFloat(r.rolls_per_cut) || 0;
      const rolls = tc * rpc;
      return {
        product_code_id: form.product_code_id,
        client_id: form.client_id || null,
        stock_issue_id: form.issue_id || null,
        date: isoDate,
        source_quantity: idx === 0 ? sourceSqm : 0,
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
      toast({ title: `Saved ${rowsToInsert.length} roll entries` });
      setForm({
        ...form,
        issue_id: "",
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
            <Label className="font-semibold">Issued Material (from Inventory Manager)</Label>
            <SearchableSelect
              value={form.issue_id}
              onValueChange={async (v) => {
                const iss = issuedMaterials.find((i) => i.issue_id === v);
                let gsmFromIssue: number | null = iss?.gsm ?? null;
                // Fallback: try to find a matching raw_material_stock_entries row
                if ((!gsmFromIssue || gsmFromIssue <= 0) && iss?.raw_material_id) {
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
                setForm({
                  ...form,
                  issue_id: v,
                  product_code_id: (iss?.product_code_id && iss.product_code_id.length > 0) ? iss.product_code_id : form.product_code_id,
                  source_thickness_mm: iss?.thickness_mm != null ? String(iss.thickness_mm) : form.source_thickness_mm,
                  source_gsm: gsmFromIssue != null && gsmFromIssue > 0 ? String(gsmFromIssue) : "",
                });
              }}
              placeholder={issuedMaterials.length ? "Select issued material to slit" : "No pending issued material"}
              options={issuedMaterials.map((i) => ({
                value: i.issue_id,
                label: `${i.product_code ?? "—"} · ${i.thickness_mm ?? "—"} mm · GSM ${i.gsm ?? "—"} · Pending ${Number(i.remaining_quantity).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${i.unit ?? ""}`,
              }))}
            />
            {selectedIssue && (
              <div className="grid grid-cols-3 gap-2 text-xs pt-1">
                <div>Issued: <b>{Number(selectedIssue.issued_quantity).toLocaleString(undefined, { maximumFractionDigits: 2 })} {selectedIssue.unit ?? ""}</b></div>
                <div>Consumed: <b>{Number(selectedIssue.consumed_quantity).toLocaleString(undefined, { maximumFractionDigits: 2 })} {selectedIssue.unit ?? ""}</b></div>
                <div>Pending: <b className={exceedsPending ? "text-destructive" : "text-secondary"}>{Number(selectedIssue.remaining_quantity).toLocaleString(undefined, { maximumFractionDigits: 2 })} {selectedIssue.unit ?? ""}</b></div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-3">
            <div className="space-y-2">
              <Label>Product Code *</Label>
              <SearchableSelect
                value={form.product_code_id}
                onValueChange={(v) => setForm({ ...form, product_code_id: v })}
                placeholder="Select product code"
                options={productCodes.map((pc) => ({ value: pc.id, label: pc.code }))}
              />
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
              <p className="text-xl font-bold text-primary">{totalKg.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-sm font-normal">kg</span></p>
            </div>
          </div>
          {srcGsm <= 0 && (
            <p className="text-xs text-muted-foreground -mt-2 text-center">Enter GSM in Source Product to calculate total kg.</p>
          )}

          {exceedsSource && (
            <p className="text-xs text-destructive text-center">
              Produced area ({totalSqm.toLocaleString(undefined, { maximumFractionDigits: 2 })} sqm) exceeds source area ({sourceSqm.toLocaleString(undefined, { maximumFractionDigits: 2 })} sqm). Total cut area cannot exceed source area.
            </p>
          )}

          <div className="space-y-2">
            <Label>Notes / Remarks</Label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>

          <Button type="submit" className="w-full bg-secondary hover:bg-secondary/90 text-secondary-foreground" disabled={submitting || exceedsSource || exceedsPending}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Slitting Entry
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
