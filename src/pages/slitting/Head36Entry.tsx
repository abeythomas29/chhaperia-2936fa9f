import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Layers, Plus, Trash2 } from "lucide-react";
import { UNIT_OPTIONS } from "@/lib/units";
import { format } from "date-fns";

interface Head36Source {
  slitting_entry_id: string;
  stock_issue_id: string;
  date: string;
  product_code_id: string | null;
  product_code: string;
  client_id: string | null;
  lot_number: string;
  thickness_mm: number | null;
  gsm: number | null;
  cut_width_mm: number | null;
  unit: string;
  // Primary (the original stock issue)
  primary_issued: number;
  primary_consumed: number; // sum source_quantity across all slitting_entries for this issue
  primary_pending: number;
  primary_unit: string;
  // Secondary (this slitting entry's produced output vs head36 consumption) — tracked in SQM (area-conserved)
  secondary_produced_sqm: number;
  secondary_consumed_sqm: number;
  secondary_pending_sqm: number;
  // Meters — reference only, NOT used for over-consumption validation
  secondary_produced_mtr: number;
  secondary_consumed_mtr: number;
}

interface RollRow { width_mm: string; length_mtr: string; rolls: string; }


const extractLot = (notes: string | null | undefined): string => {
  if (!notes) return "—";
  const m = notes.match(/lot[\s:\-]*([A-Z0-9\-_/]+)/i);
  return m ? m[1] : "—";
};

export default function Head36Entry() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [sources, setSources] = useState<Head36Source[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    slitting_entry_id: "",
    client_id: "",
    entry_date: new Date().toISOString().slice(0, 10),
    times_cut: "",
    rolls_per_cut: "",
    unit: "meters",
    notes: "",
  });
  const [rollRows, setRollRows] = useState<RollRow[]>([{ width_mm: "", length_mtr: "", rolls: "" }]);

  const reload = async () => {
    if (!user) return;
    // 1. Slitting entries by this user with a linked stock_issue_id (submitted/saved).
    const slitRes = await supabase
      .from("slitting_entries")
      .select(
        "id, date, product_code_id, client_id, stock_issue_id, source_quantity, cut_quantity_produced, cut_width_mm, thickness_mm, gsm, unit, notes, product_codes(code)",
      )
      .eq("slitting_manager_id", user.id)
      .not("stock_issue_id", "is", null)
      .order("date", { ascending: false })
      .limit(500);
    if (slitRes.error) {
      console.error("[Head36Entry] slitting_entries error", slitRes.error);
      toast({ title: "Could not load slitting entries", description: slitRes.error.message, variant: "destructive" });
      setSources([]);
      setLoading(false);
      return;
    }
    const slitRows = (slitRes.data ?? []) as any[];

    const issueIds = Array.from(new Set(slitRows.map((s) => s.stock_issue_id).filter(Boolean))) as string[];
    const slitIds = slitRows.map((s) => s.id);

    // 2. Stock issues for primary info.
    const issuesById = new Map<string, any>();
    if (issueIds.length) {
      const isRes = await supabase
        .from("stock_issues")
        .select("id, product_code_id, quantity, unit, notes, thickness_mm, date, product_codes(code)")
        .in("id", issueIds);
      for (const r of (isRes.data ?? []) as any[]) issuesById.set(String(r.id), r);
    }

    // 3. Sum primary consumed = sum source_quantity per stock_issue_id (across ALL slitting entries).
    const primaryConsumed = new Map<string, number>();
    if (issueIds.length) {
      const cRes = await supabase
        .from("slitting_entries")
        .select("stock_issue_id, source_quantity")
        .in("stock_issue_id", issueIds);
      for (const r of (cRes.data ?? []) as any[]) {
        const k = String(r.stock_issue_id);
        primaryConsumed.set(k, (primaryConsumed.get(k) ?? 0) + Number(r.source_quantity ?? 0));
      }
    }

    // 4. Sum secondary consumed per slitting_entry_id, tracking BOTH meters (reference) and SQM (validation).
    const secondaryConsumedMtr = new Map<string, number>();
    const secondaryConsumedSqm = new Map<string, number>();
    if (slitIds.length) {
      const hRes = await (supabase as any)
        .from("head36_entries")
        .select("slitting_entry_id, total_quantity, rolls_produced, length_per_tape_mtr, roll_width_mm, notes")
        .in("slitting_entry_id", slitIds);
      if (!hRes.error) {
        for (const r of (hRes.data ?? []) as any[]) {
          const k = String(r.slitting_entry_id);
          const rolls = Number(r.rolls_produced ?? 0);
          const lenM = Number(r.length_per_tape_mtr ?? 0);
          const widthMm = Number(r.roll_width_mm ?? 0);
          const mtr = Number(r.total_quantity ?? rolls * lenM);
          // Prefer explicit TotalSqm noted at save time, else derive width×length×rolls.
          let sqm = 0;
          if (typeof r.notes === "string") {
            const m = r.notes.match(/TotalSqm[:\s]+([\d.]+)/i);
            if (m) sqm = parseFloat(m[1]);
          }
          if (!sqm && widthMm > 0 && lenM > 0 && rolls > 0) sqm = (widthMm / 1000) * lenM * rolls;
          secondaryConsumedMtr.set(k, (secondaryConsumedMtr.get(k) ?? 0) + (Number.isFinite(mtr) ? mtr : 0));
          secondaryConsumedSqm.set(k, (secondaryConsumedSqm.get(k) ?? 0) + (Number.isFinite(sqm) ? sqm : 0));
        }
      }
    }

    const list: Head36Source[] = slitRows.map((s) => {
      const issue = issuesById.get(String(s.stock_issue_id));
      const primaryIssued = Number(issue?.quantity ?? 0);
      const pConsumed = primaryConsumed.get(String(s.stock_issue_id)) ?? 0;
      const primaryPending = Math.max(0, primaryIssued - pConsumed);
      const producedMtr = Number(s.cut_quantity_produced ?? 0);
      const cutWidthMm = s.cut_width_mm != null ? Number(s.cut_width_mm) : 0;
      // Area-conserved sqm from slitting produced meters × cut width.
      const producedSqm = cutWidthMm > 0 ? (cutWidthMm / 1000) * producedMtr : 0;
      const sConsumedMtr = secondaryConsumedMtr.get(String(s.id)) ?? 0;
      const sConsumedSqm = secondaryConsumedSqm.get(String(s.id)) ?? 0;
      const secondaryPendingSqm = Math.max(0, producedSqm - sConsumedSqm);
      let gsm = s.gsm != null ? Number(s.gsm) : null;
      if (gsm == null && typeof s.notes === "string") {
        const m = s.notes.match(/GSM\s*[:\-]\s*(\d+(?:\.\d+)?)/i);
        if (m) gsm = parseFloat(m[1]);
      }
      return {
        slitting_entry_id: s.id,
        stock_issue_id: s.stock_issue_id,
        date: s.date,
        product_code_id: s.product_code_id ?? null,
        product_code: s.product_codes?.code ?? issue?.product_codes?.code ?? "—",
        client_id: s.client_id ?? null,
        lot_number: extractLot(s.notes) !== "—" ? extractLot(s.notes) : extractLot(issue?.notes),
        thickness_mm: s.thickness_mm != null ? Number(s.thickness_mm) : (issue?.thickness_mm != null ? Number(issue.thickness_mm) : null),
        gsm,
        cut_width_mm: cutWidthMm || null,
        unit: String(s.unit ?? "meters"),
        primary_issued: primaryIssued,
        primary_consumed: pConsumed,
        primary_pending: primaryPending,
        primary_unit: String(issue?.unit ?? s.unit ?? ""),
        secondary_produced_sqm: producedSqm,
        secondary_consumed_sqm: sConsumedSqm,
        secondary_pending_sqm: secondaryPendingSqm,
        secondary_produced_mtr: producedMtr,
        secondary_consumed_mtr: sConsumedMtr,
      };
    });


    setSources(list);
    setLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    (async () => {
      const cl = await supabase.from("company_clients").select("id, name").eq("status", "active").order("name");
      setClients(((cl.data as any[]) ?? []));
      await reload();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const selected = sources.find((s) => s.slitting_entry_id === form.slitting_entry_id) ?? null;

  // Auto-fill client when slitting entry has one; if not, clear so user must choose.
  useEffect(() => {
    if (!selected) return;
    setForm((f) => ({ ...f, client_id: selected.client_id ?? "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.slitting_entry_id]);

  const validRollRows = rollRows.filter(
    (r) => parseFloat(r.width_mm) > 0 && parseFloat(r.length_mtr) > 0 && parseFloat(r.rolls) > 0,
  );
  const totalRolls = validRollRows.reduce((s, r) => s + parseFloat(r.rolls), 0);
  const totalLength = validRollRows.reduce(
    (s, r) => s + parseFloat(r.length_mtr) * parseFloat(r.rolls),
    0,
  );
  const totalSqm = validRollRows.reduce(
    (s, r) => s + (parseFloat(r.width_mm) / 1000) * parseFloat(r.length_mtr) * parseFloat(r.rolls),
    0,
  );

  // Validate via AREA (sqm) — area is conserved when slitting. Meters can differ
  // because narrower cuts produce many parallel tapes.
  const exceedsSecondary = useMemo(() => {
    if (!selected) return false;
    return totalSqm > selected.secondary_pending_sqm + 1e-6;
  }, [selected, totalSqm]);


  const clientRequired = !!selected && !selected.client_id;

  const updateRollRow = (i: number, patch: Partial<RollRow>) =>
    setRollRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRollRow = () => setRollRows((rows) => [...rows, { width_mm: "", length_mtr: "", rolls: "" }]);
  const removeRollRow = (i: number) => setRollRows((rows) => rows.filter((_, idx) => idx !== i));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!selected) {
      toast({ title: "Select source", description: "Choose a slitting entry as source.", variant: "destructive" });
      return;
    }
    if (validRollRows.length === 0) {
      toast({ title: "Add at least one roll", description: "Width, length and roll count are required.", variant: "destructive" });
      return;
    }
    if (clientRequired && !form.client_id) {
      toast({ title: "Client required", description: "Source slitting entry has no client. Please choose one.", variant: "destructive" });
      return;
    }
    if (exceedsSecondary) {
      toast({
        title: "Exceeds secondary pending",
        description: `Only ${selected.secondary_pending_sqm.toLocaleString(undefined, { maximumFractionDigits: 2 })} sqm pending on this slitting source.`,
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    const isoDate = form.entry_date || new Date().toISOString().slice(0, 10);

    // head36_entries currently has one row per entry. Aggregate the roll rows into rolls_produced + a representative width/length.
    // We sum total rolls; store average width and length-per-tape so total_quantity ≈ totalLength.
    const repWidth = validRollRows.reduce((s, r) => s + parseFloat(r.width_mm) * parseFloat(r.rolls), 0) / (totalRolls || 1);
    const repLength = totalRolls ? totalLength / totalRolls : 0;
    const timesCut = parseFloat(form.times_cut) || 0;
    const rollsPerCut = parseFloat(form.rolls_per_cut) || 0;

    const rollsBreakdown = validRollRows
      .map((r, i) => `R${i + 1} ${r.width_mm}mm × ${r.length_mtr}m × ${r.rolls}`)
      .join("; ");

    const basePayload: any = {
      slitting_entry_id: selected.slitting_entry_id,
      stock_issue_id: selected.stock_issue_id, // attempt to save; falls back if column missing
      client_id: form.client_id || null,
      date: isoDate,
      product_code_id: selected.product_code_id,
      rolls_taken: 0,
      rolls_produced: totalRolls,
      roll_width_mm: repWidth || null,
      length_per_tape_mtr: repLength || null,
      thickness_mm: selected.thickness_mm,
      gsm: selected.gsm,
      unit: form.unit,
      notes: [
        form.notes,
        `Rolls: ${rollsBreakdown}`,
        `TotalLength: ${totalLength.toFixed(2)}m`,
        `TotalSqm: ${totalSqm.toFixed(2)}`,
        timesCut && rollsPerCut ? `Cuts: ${timesCut} × ${rollsPerCut} rolls/cut` : "",
        `StockIssue: ${selected.stock_issue_id}`,
      ]
        .filter(Boolean)
        .join(" | "),
      operator_id: user.id,
      created_at: new Date(isoDate + "T12:00:00").toISOString(),
    };

    const tryInsert = async (p: any) => (supabase as any).from("head36_entries").insert(p);
    let { error } = await tryInsert(basePayload);

    // Progressive fallback for columns the live schema may not yet have.
    const stripAndRetry = async (key: string) => {
      const { [key]: _, ...rest } = basePayload;
      Object.assign(basePayload, { __stripped: true });
      const r = await tryInsert(rest);
      return r.error;
    };
    if (error?.code === "PGRST204" && /'stock_issue_id' column/.test(error.message)) {
      const { stock_issue_id, ...rest } = basePayload;
      ({ error } = await tryInsert(rest));
    }
    if (error?.code === "PGRST204" && /'client_id' column/.test(error.message)) {
      const { client_id, stock_issue_id, ...rest } = basePayload;
      ({ error } = await tryInsert(rest));
    }
    if (error?.code === "PGRST204" && /'gsm' column/.test(error.message)) {
      const { gsm, client_id, stock_issue_id, ...rest } = basePayload;
      ({ error } = await tryInsert(rest));
    }

    if (error) {
      const missingTable = (error as any).code === "PGRST205" || /head36_entries/i.test(error.message ?? "");
      const description = missingTable
        ? "36 Head table is not provisioned in the backend yet. Ask an admin to run the head36_entries setup SQL."
        : error.message;
      toast({ title: "Error", description, variant: "destructive" });
    } else {
      toast({ title: "36 Head entry saved" });
      setForm({
        ...form,
        slitting_entry_id: "",
        client_id: "",
        times_cut: "",
        rolls_per_cut: "",
        notes: "",
      });
      setRollRows([{ width_mm: "", length_mtr: "", rolls: "" }]);
      await reload();
    }
    setSubmitting(false);
    void stripAndRetry; // silence unused
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const sourceOptions = sources
    .filter((s) => s.secondary_pending_sqm > 0.0001)
    .map((s) => ({
      value: s.slitting_entry_id,
      label: `${s.product_code} | Lot ${s.lot_number} | ${s.thickness_mm ?? "—"}mm | GSM ${s.gsm ?? "—"} | Pending ${s.secondary_pending_sqm.toLocaleString(undefined, { maximumFractionDigits: 2 })} sqm`,
      keywords: `${s.product_code} ${s.lot_number} ${format(new Date(s.date), "dd/MM/yy")}`,
    }));


  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-5 w-5" /> 36 Head Production Entry
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-3">
            <div className="space-y-2">
              <Label>Source Slitting Entry *</Label>
              <SearchableSelect
                value={form.slitting_entry_id}
                onValueChange={(v) => setForm({ ...form, slitting_entry_id: v })}
                options={sourceOptions}
                placeholder={
                  sourceOptions.length === 0
                    ? "No submitted slitting entries with pending output"
                    : "Choose source slitting entry"
                }
                emptyText="No matching slitting entries"
                disabled={sourceOptions.length === 0}
              />
              {sources.length > 0 && sourceOptions.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  All slitting outputs for your issued stock are already fully consumed by 36 Head.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Date *</Label>
              <Input
                type="date"
                value={form.entry_date}
                onChange={(e) => setForm({ ...form, entry_date: e.target.value })}
              />
            </div>
          </div>

          {selected && (
            <div className="rounded-lg border bg-muted/40 p-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="space-y-1">
                <p className="font-semibold text-foreground">Primary Source (reference only)</p>
                <p>Issued: <span className="font-medium">{selected.primary_issued.toLocaleString(undefined, { maximumFractionDigits: 2 })} {selected.primary_unit}</span></p>
                <p>Consumed in Slitting: <span className="font-medium">{selected.primary_consumed.toLocaleString(undefined, { maximumFractionDigits: 2 })} {selected.primary_unit}</span></p>
                <p>Primary Pending: <span className="font-medium">{selected.primary_pending.toLocaleString(undefined, { maximumFractionDigits: 2 })} {selected.primary_unit}</span></p>
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-foreground">Secondary Source (from Slitting)</p>
                <p>Slitting Produced: <span className="font-medium">{selected.secondary_produced_sqm.toLocaleString(undefined, { maximumFractionDigits: 2 })} sqm</span> <span className="text-xs text-muted-foreground">({selected.secondary_produced_mtr.toLocaleString(undefined, { maximumFractionDigits: 2 })} m ref)</span></p>
                <p>Consumed in 36 Head: <span className="font-medium">{selected.secondary_consumed_sqm.toLocaleString(undefined, { maximumFractionDigits: 2 })} sqm</span> <span className="text-xs text-muted-foreground">({selected.secondary_consumed_mtr.toLocaleString(undefined, { maximumFractionDigits: 2 })} m ref)</span></p>
                <p>Secondary Pending: <span className="font-semibold text-primary">{selected.secondary_pending_sqm.toLocaleString(undefined, { maximumFractionDigits: 2 })} sqm</span></p>

              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Client {clientRequired ? "*" : "(auto-filled)"}</Label>
            <SearchableSelect
              value={form.client_id}
              onValueChange={(v) => setForm({ ...form, client_id: v })}
              placeholder={clientRequired ? "Select client (required)" : "Select client"}
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
            />
            {clientRequired && !form.client_id && (
              <p className="text-xs text-destructive">Source slitting entry has no client — please choose one.</p>
            )}
          </div>

          <div className="space-y-2 rounded-lg border-2 border-secondary/30 bg-secondary/5 p-3">
            <div className="flex items-center justify-between">
              <Label className="font-semibold">Rolls Produced</Label>
              <Button type="button" size="sm" variant="outline" onClick={addRollRow}>
                <Plus className="h-3 w-3 mr-1" /> Add Roll
              </Button>
            </div>
            <div className="space-y-2">
              {rollRows.map((row, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                  <div className="space-y-1">
                    <Label className="text-xs">Width (mm)</Label>
                    <Input
                      type="number"
                      step="any"
                      value={row.width_mm}
                      onChange={(e) => updateRollRow(i, { width_mm: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Length (m)</Label>
                    <Input
                      type="number"
                      step="any"
                      value={row.length_mtr}
                      onChange={(e) => updateRollRow(i, { length_mtr: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs"># Rolls</Label>
                    <Input
                      type="number"
                      step="any"
                      value={row.rolls}
                      onChange={(e) => updateRollRow(i, { rolls: e.target.value })}
                    />
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => removeRollRow(i)}
                    disabled={rollRows.length === 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Times Roll Cut (optional)</Label>
              <Input
                type="number"
                step="any"
                value={form.times_cut}
                onChange={(e) => setForm({ ...form, times_cut: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Rolls per Cutting (optional)</Label>
              <Input
                type="number"
                step="any"
                value={form.rolls_per_cut}
                onChange={(e) => setForm({ ...form, rolls_per_cut: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Unit</Label>
            <Select value={form.unit} onValueChange={(v) => setForm({ ...form, unit: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {UNIT_OPTIONS.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="bg-muted rounded-lg p-4 grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xs text-muted-foreground">Total Rolls</p>
              <p className="text-xl font-bold text-primary">{totalRolls.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Length</p>
              <p className="text-xl font-bold text-primary">
                {totalLength.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
                <span className="text-sm font-normal">mtr</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Production</p>
              <p className="text-xl font-bold text-primary">
                {totalSqm.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
                <span className="text-sm font-normal">sqm</span>
              </p>
            </div>
          </div>

          {exceedsSecondary && selected && (
            <p className="text-sm text-destructive">
              Total area ({totalSqm.toFixed(2)} sqm) exceeds Secondary Pending ({selected.secondary_pending_sqm.toFixed(2)} sqm).
            </p>
          )}

          <div className="space-y-2">
            <Label>Notes</Label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>

          <Button
            type="submit"
            className="w-full bg-secondary hover:bg-secondary/90 text-secondary-foreground"
            disabled={submitting || !selected || exceedsSecondary}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save 36 Head Entry
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
