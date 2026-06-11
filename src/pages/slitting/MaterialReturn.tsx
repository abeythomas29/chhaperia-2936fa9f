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

const MATERIAL_RETURN_ROWS_CACHE_KEY = "material-return-source-rows-v2";
const SOURCE_NOTE_PATTERN = /(?:^|\|)\s*(Source:\s*.*?)(?=\s*\||$)/i;

interface SlittingRow {
  id: string;
  date: string;
  source_quantity: number;
  cut_quantity_produced: number;
  cut_width_mm: number;
  thickness_mm: number | null;
  gsm: number | null;
  notes: string | null;
  slitting_manager_id: string;
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
  gsm: number | null;
  sourceQuantity: number;
  producedQuantity: number;
  producedSqm: number;
  unit: string;
  widthCount: number;
  breakdown: { width: number; thickness: number | null; sqm: number }[];
}

const readCachedRows = () => {
  if (typeof window === "undefined") return [] as SlittingRow[];
  try {
    const raw = window.localStorage.getItem(MATERIAL_RETURN_ROWS_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as SlittingRow[]) : [];
  } catch {
    return [] as SlittingRow[];
  }
};

const writeCachedRows = (rows: SlittingRow[]) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MATERIAL_RETURN_ROWS_CACHE_KEY, JSON.stringify(rows));
  } catch {
    // ignore cache write errors
  }
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

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const cachedRows = readCachedRows();
    if (cachedRows.length) setRows(cachedRows);

    const selectFields = "id, date, source_quantity, cut_quantity_produced, cut_width_mm, thickness_mm, gsm, notes, slitting_manager_id, unit, product_codes(code)";
    const { data } = await supabase
      .from("slitting_entries")
      .select(selectFields)
      .order("date", { ascending: false })
      .limit(500);

    const nextRows = ((data as unknown) as SlittingRow[]) ?? [];
    setRows(nextRows);
    writeCachedRows(nextRows);

    const { data: retData } = await supabase
      .from("slitting_returns")
      .select("slitting_entry_id, returned_quantity")
      .limit(5000);
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
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const batches = useMemo<Batch[]>(() => {
    const groups = new Map<string, SlittingRow[]>();

    rows.forEach((row) => {
      const sourceNote = extractSourceNote(row.notes);
      const key = [
        row.date,
        row.product_codes?.code ?? "—",
        row.slitting_manager_id,
        row.unit,
        row.thickness_mm ?? "—",
        row.gsm ?? "—",
        sourceNote || row.id,
      ].join("||");

      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    });

    return Array.from(groups.entries())
      .map(([key, group]) => {
        const firstRow = group[0];
        const breakdown = group.map((row) => ({
          width: row.cut_width_mm,
          thickness: row.thickness_mm,
          sqm: (row.cut_width_mm / 1000) * Number(row.cut_quantity_produced || 0),
        }));
        const mergedBreakdown: { width: number; thickness: number | null; sqm: number }[] = [];

        breakdown.forEach((item) => {
          const existing = mergedBreakdown.find((entry) => entry.width === item.width && entry.thickness === item.thickness);
          if (existing) existing.sqm += item.sqm;
          else mergedBreakdown.push({ ...item });
        });

        return {
          key,
          anchorId: firstRow.id,
          rowIds: group.map((row) => row.id),
          date: firstRow.date,
          productCode: firstRow.product_codes?.code ?? "—",
          thicknessMm: firstRow.thickness_mm,
          gsm: firstRow.gsm,
          sourceQuantity: group.reduce((sum, row) => sum + Number(row.source_quantity || 0), 0),
          producedQuantity: group.reduce((sum, row) => sum + Number(row.cut_quantity_produced || 0), 0),
          producedSqm: mergedBreakdown.reduce((sum, row) => sum + row.sqm, 0),
          unit: firstRow.unit,
          widthCount: new Set(group.map((row) => row.cut_width_mm)).size,
          breakdown: mergedBreakdown,
        };
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1));
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
                <SelectTrigger><SelectValue placeholder="Choose a slitting source" /></SelectTrigger>
                <SelectContent>
                  {batches.map((batch) => (
                    <SelectItem key={batch.key} value={batch.key}>
                      {format(new Date(batch.date), "dd/MM/yy")} — {batch.productCode} — {batch.thicknessMm ?? "—"} mm — {formatNumber(batch.sourceQuantity)} sqm{batch.widthCount > 1 ? ` (${batch.widthCount} widths)` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                <div><span className="text-muted-foreground">Source Qty (sqm): </span><b>{formatNumber(selected.sourceQuantity)}</b></div>
                <div><span className="text-muted-foreground">Produced Qty: </span><b>{formatNumber(selected.producedQuantity)}</b></div>
                <div><span className="text-muted-foreground">Already Returned (sqm): </span><b>{formatNumber(alreadyReturned)}</b></div>
                <div><span className="text-muted-foreground">New Return (sqm): </span><b>{formatNumber(newReturn)}</b></div>
                <div><span className="text-muted-foreground">Thickness: </span><b>{selected.thicknessMm ?? "—"} mm</b></div>
                <div><span className="text-muted-foreground">GSM: </span><b>{selected.gsm ?? "—"}</b></div>
              </div>
              <div className="border-t pt-2">
                <div className="mb-1 text-xs text-muted-foreground">Grouped breakdown</div>
                <ul className="space-y-0.5 text-xs">
                  {selected.breakdown.map((item, index) => (
                    <li key={index}>
                      <span className="font-mono">{item.width} mm</span> · <span className="font-mono">{item.thickness ?? "—"} mm</span> — <b>{formatNumber(item.sqm)} sqm</b>
                    </li>
                  ))}
                </ul>
              </div>
              <div className={`rounded-md p-2 text-center font-semibold ${matched ? "bg-green-500/10 text-green-700" : "bg-destructive/10 text-destructive"}`}>
                {matched
                  ? "✓ Matched — No wastage (Source = Produced sqm + Returned)"
                  : `Wastage = ${formatNumber(wastage)} sqm`}
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
