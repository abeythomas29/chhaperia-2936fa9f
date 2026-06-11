import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, PackageOpen } from "lucide-react";
import { format } from "date-fns";

const MATERIAL_RETURN_ROWS_CACHE_KEY = "material-return-source-rows-v3";
const LEGACY_CACHE_KEYS = [
  "cache_mr_slitting_entries",
  "cache_mr_slitting_entries_v2",
  "cache_mr_returns",
  "material-return-source-rows",
  "material-return-source-rows-v2",
];
const SOURCE_NOTE_PATTERN = /(?:^|\|)\s*(Source:\s*.*?)(?=\s*\||$)/i;

interface SlittingRow {
  id: string;
  date: string;
  source_quantity: number;
  cut_quantity_produced: number;
  cut_width_mm?: number | null;
  thickness_mm: number | null;
  notes: string | null;
  unit: string;
  product_codes: { code: string } | null;
}

type SlittingReturnInsert = Database["public"]["Tables"]["slitting_returns"]["Insert"];
type SlittingReturnRow = Database["public"]["Tables"]["slitting_returns"]["Row"];
type ClientRow = Database["public"]["Tables"]["company_clients"]["Row"];

interface Batch {
  key: string;
  anchorId: string;
  rowIds: string[];
  date: string;
  productCode: string;
  thicknessMm: number | null;
  sourceQuantity: number;
  producedQuantity: number;
  producedSqm: number;
  unit: string;
  cutCount: number;
  breakdown: { width: number | null; thickness: number | null; produced: number; sqm: number }[];
}

const readCachedRows = (): SlittingRow[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MATERIAL_RETURN_ROWS_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as SlittingRow[]) : [];
  } catch {
    return [];
  }
};

const writeCachedRows = (rows: SlittingRow[]) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MATERIAL_RETURN_ROWS_CACHE_KEY, JSON.stringify(rows));
  } catch {
    /* ignore */
  }
};

const clearLegacyCache = () => {
  if (typeof window === "undefined") return;
  LEGACY_CACHE_KEYS.forEach((k) => {
    try { window.localStorage.removeItem(k); } catch { /* ignore */ }
  });
};

const extractSourceNote = (notes: string | null) => notes?.match(SOURCE_NOTE_PATTERN)?.[1]?.trim() ?? "";

const formatNumber = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function MaterialReturn() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<SlittingRow[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [returnsByRow, setReturnsByRow] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    batch_key: "",
    client_id: "",
    entry_date: new Date().toISOString().slice(0, 10),
    returned_quantity: "",
    unit: "sqmtr",
    notes: "",
  });

  useEffect(() => { clearLegacyCache(); }, []);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const cachedRows = readCachedRows();
    if (cachedRows.length) setRows(cachedRows);

    // Minimal safe field set - only columns guaranteed to exist
    const selectFields = "id, date, source_quantity, cut_quantity_produced, cut_width_mm, unit, notes, thickness_mm, product_codes(code)";
    const { data, error } = await supabase
      .from("slitting_entries")
      .select(selectFields)
      .order("date", { ascending: false })
      .limit(500);

    if (error) {
      console.error("[MaterialReturn] slitting_entries query error:", error);
      toast({
        title: "Failed to load slitting entries",
        description: error.message,
        variant: "destructive",
      });
      // Keep cached rows visible if any, otherwise empty
      if (!cachedRows.length) setRows([]);
    } else {
      const nextRows = ((data as unknown) as SlittingRow[]) ?? [];
      setRows(nextRows);
      writeCachedRows(nextRows);
    }

    const { data: retData, error: retError } = await supabase
      .from("slitting_returns")
      .select("slitting_entry_id, returned_quantity")
      .limit(5000);
    if (retError) {
      console.error("[MaterialReturn] slitting_returns query error:", retError);
    }
    const sums: Record<string, number> = {};
    ((retData as SlittingReturnRow[] | null) ?? []).forEach((row) => {
      sums[row.slitting_entry_id] = (sums[row.slitting_entry_id] ?? 0) + Number(row.returned_quantity ?? 0);
    });
    setReturnsByRow(sums);

    const { data: clData } = await supabase
      .from("company_clients")
      .select("id, name")
      .eq("status", "active")
      .order("name");
    setClients((clData as ClientRow[] | null) ?? []);
    setLoading(false);
  }, [user, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const batches = useMemo<Batch[]>(() => {
    // Pass 1: group by stable key (date + product + unit + thickness + source-note when present)
    const groups = new Map<string, SlittingRow[]>();
    const ungrouped: SlittingRow[] = [];

    rows.forEach((row) => {
      const sourceNote = extractSourceNote(row.notes);
      const productCode = row.product_codes?.code ?? null;
      // Need at minimum: date + productCode to be groupable
      if (!row.date || !productCode) {
        ungrouped.push(row);
        return;
      }
      const key = [
        row.date,
        productCode,
        row.unit ?? "—",
        row.thickness_mm ?? "—",
        sourceNote || "__NO_SOURCE__",
      ].join("||");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    });

    // Pass 2: for groups whose source-note marker was "__NO_SOURCE__",
    // try to merge zero-source rows into a sibling group (same date/product/thickness) that has source>0.
    const noSourceGroups: string[] = [];
    const withSourceByTriple = new Map<string, string>(); // triple -> key
    groups.forEach((rows, key) => {
      const triple = key.split("||").slice(0, 4).join("||"); // date|product|unit|thickness
      const hasSource = rows.some((r) => Number(r.source_quantity || 0) > 0);
      if (key.endsWith("||__NO_SOURCE__")) {
        noSourceGroups.push(key);
      } else if (hasSource) {
        withSourceByTriple.set(triple, key);
      }
    });

    noSourceGroups.forEach((key) => {
      const triple = key.split("||").slice(0, 4).join("||");
      const target = withSourceByTriple.get(triple);
      const rowsInGroup = groups.get(key)!;
      if (target && target !== key) {
        groups.get(target)!.push(...rowsInGroup);
        groups.delete(key);
      } else {
        // Otherwise keep as its own group (still shows in dropdown)
        const allHaveZero = rowsInGroup.every((r) => Number(r.source_quantity || 0) === 0);
        if (allHaveZero) {
          // Fallback: nearest same-date+product+thickness row with source>0 across all groups (even differing unit)
          const looseTriple = [rowsInGroup[0].date, rowsInGroup[0].product_codes?.code ?? "—", rowsInGroup[0].thickness_mm ?? "—"].join("||");
          let merged = false;
          for (const [otherKey, otherRows] of groups.entries()) {
            if (otherKey === key) continue;
            const first = otherRows[0];
            const otherLoose = [first.date, first.product_codes?.code ?? "—", first.thickness_mm ?? "—"].join("||");
            if (otherLoose === looseTriple && otherRows.some((r) => Number(r.source_quantity || 0) > 0)) {
              groups.get(otherKey)!.push(...rowsInGroup);
              groups.delete(key);
              merged = true;
              break;
            }
          }
          if (!merged) {
            // leave as-is (its own dropdown option)
          }
        }
      }
    });

    const result: Batch[] = [];

    groups.forEach((group, key) => {
      const firstRow = group[0];
      const breakdown: Batch["breakdown"] = [];
      group.forEach((row) => {
        const width = row.cut_width_mm ?? null;
        const thickness = row.thickness_mm;
        const produced = Number(row.cut_quantity_produced || 0);
        const sqm = width != null ? (Number(width) / 1000) * produced : 0;
        const existing = breakdown.find((e) => e.width === width && e.thickness === thickness);
        if (existing) { existing.produced += produced; existing.sqm += sqm; }
        else breakdown.push({ width, thickness, produced, sqm });
      });

      result.push({
        key,
        anchorId: firstRow.id,
        rowIds: group.map((r) => r.id),
        date: firstRow.date,
        productCode: firstRow.product_codes?.code ?? "—",
        thicknessMm: firstRow.thickness_mm,
        sourceQuantity: group.reduce((s, r) => s + Number(r.source_quantity || 0), 0),
        producedQuantity: group.reduce((s, r) => s + Number(r.cut_quantity_produced || 0), 0),
        producedSqm: breakdown.reduce((s, b) => s + b.sqm, 0),
        unit: firstRow.unit,
        cutCount: group.length,
        breakdown,
      });
    });

    // Add ungroupable rows as standalone batches (never drop them)
    ungrouped.forEach((row) => {
      const width = row.cut_width_mm ?? null;
      const produced = Number(row.cut_quantity_produced || 0);
      const sqm = width != null ? (Number(width) / 1000) * produced : 0;
      result.push({
        key: `__SOLO__||${row.id}`,
        anchorId: row.id,
        rowIds: [row.id],
        date: row.date,
        productCode: row.product_codes?.code ?? "—",
        thicknessMm: row.thickness_mm,
        sourceQuantity: Number(row.source_quantity || 0),
        producedQuantity: produced,
        producedSqm: sqm,
        unit: row.unit,
        cutCount: 1,
        breakdown: [{ width, thickness: row.thickness_mm, produced, sqm }],
      });
    });

    return result.sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [rows]);

  const selected = batches.find((batch) => batch.key === form.batch_key);
  const alreadyReturned = selected ? selected.rowIds.reduce((sum, id) => sum + (returnsByRow[id] ?? 0), 0) : 0;
  const newReturn = parseFloat(form.returned_quantity) || 0;
  const wastage = selected ? selected.sourceQuantity - selected.producedSqm - alreadyReturned - newReturn : 0;
  const matched = selected && Math.abs(wastage) < 0.01;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selected || !newReturn) {
      toast({ title: "Missing fields", description: "Select an entry and enter returned quantity.", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    const isoDate = form.entry_date || new Date().toISOString().slice(0, 10);
    const payload: SlittingReturnInsert = {
      slitting_entry_id: selected.anchorId,
      client_id: form.client_id || null,
      date: isoDate,
      returned_quantity: newReturn,
      unit: form.unit,
      notes: form.notes || null,
      returned_by: user.id,
      created_at: new Date(isoDate + "T12:00:00").toISOString(),
    };

    let { error } = await supabase.from("slitting_returns").insert(payload);
    if (error?.code === "PGRST204" && /'client_id' column/.test(error.message)) {
      const { client_id, ...fallbackPayload } = payload;
      ({ error } = await supabase.from("slitting_returns").insert(fallbackPayload));
    }

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Return recorded" });
      setForm({
        batch_key: "",
        client_id: "",
        entry_date: new Date().toISOString().slice(0, 10),
        returned_quantity: "",
        unit: "sqmtr",
        notes: "",
      });
      await load();
    }
    setSubmitting(false);
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><PackageOpen className="h-5 w-5" /> Material Return Entry</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_1fr]">
            <div className="space-y-2">
              <Label>Select Slitting Entry *</Label>
              <Select value={form.batch_key} onValueChange={(value) => setForm({ ...form, batch_key: value })}>
                <SelectTrigger>
                  <SelectValue placeholder={batches.length ? "Choose a slitting source" : "No slitting entries available"} />
                </SelectTrigger>
                <SelectContent>
                  {batches.map((batch) => (
                    <SelectItem key={batch.key} value={batch.key}>
                      {format(new Date(batch.date), "dd/MM/yy")} — {batch.productCode} — {batch.thicknessMm ?? "—"} mm — {formatNumber(batch.sourceQuantity)} {batch.unit}{batch.cutCount > 1 ? ` — ${batch.cutCount} cuts merged` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!batches.length && (
                <p className="text-xs text-muted-foreground">No slitting entries found. Create one in Slitting Entry first.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Date *</Label>
              <Input type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Client (Optional)</Label>
            <Select value={form.client_id} onValueChange={(value) => setForm({ ...form, client_id: value })}>
              <SelectTrigger><SelectValue placeholder="Select client (optional)" /></SelectTrigger>
              <SelectContent>
                {clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {selected && (
            <div className="space-y-2 rounded-lg border p-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">Source Qty: </span><b>{formatNumber(selected.sourceQuantity)} {selected.unit}</b></div>
                <div><span className="text-muted-foreground">Produced Qty: </span><b>{formatNumber(selected.producedQuantity)}</b></div>
                <div><span className="text-muted-foreground">Already Returned: </span><b>{formatNumber(alreadyReturned)}</b></div>
                <div><span className="text-muted-foreground">New Return: </span><b>{formatNumber(newReturn)}</b></div>
                <div><span className="text-muted-foreground">Thickness: </span><b>{selected.thicknessMm ?? "—"} mm</b></div>
                <div><span className="text-muted-foreground">Cuts merged: </span><b>{selected.cutCount}</b></div>
              </div>
              <div className="border-t pt-2">
                <div className="mb-1 text-xs text-muted-foreground">Grouped breakdown</div>
                <ul className="space-y-0.5 text-xs">
                  {selected.breakdown.map((item, index) => (
                    <li key={index}>
                      <span className="font-mono">{item.width ?? "—"} mm</span> · <span className="font-mono">{item.thickness ?? "—"} mm</span> — <b>{formatNumber(item.sqm)} sqm</b>
                    </li>
                  ))}
                </ul>
              </div>
              <div className={`rounded-md p-2 text-center font-semibold ${matched ? "bg-green-500/10 text-green-700" : "bg-destructive/10 text-destructive"}`}>
                {matched
                  ? "✓ Matched — No wastage"
                  : `Wastage = ${formatNumber(wastage)}`}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Returned Quantity (sqm) *</Label>
              <Input
                type="number"
                step="any"
                value={form.returned_quantity}
                onChange={(e) => setForm({ ...form, returned_quantity: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Unit</Label>
              <Input value="Square Meters (sqmtr)" disabled />
              <p className="text-xs text-muted-foreground">Returns are tracked in sqm to match grouped source totals.</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>

          <Button type="submit" className="w-full bg-secondary text-secondary-foreground hover:bg-secondary/90" disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Return
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
