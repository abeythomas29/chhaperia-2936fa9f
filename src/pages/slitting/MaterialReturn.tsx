import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, PackageOpen } from "lucide-react";
import { UNIT_OPTIONS } from "@/lib/units";
import { format } from "date-fns";

interface SlittingRow {
  id: string;
  date: string;
  source_quantity: number;
  cut_quantity_produced: number;
  cut_width_mm: number;
  thickness_mm: number | null;
  unit: string;
  batch_id: string | null;
  product_code_id: string | null;
  product_codes: { code: string } | null;
}

interface Batch {
  key: string;            // batch_id or row id
  anchorId: string;       // row to attach return to
  rowIds: string[];
  date: string;
  productCode: string;
  issuedSqm: number;
  producedSqm: number;
  unit: string;
  widthCount: number;
  breakdown: { width: number; thickness: number | null; sqm: number }[];
}

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
    unit: "meters",
    notes: "",
  });

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const fullSelect = "id, date, source_quantity, cut_quantity_produced, cut_width_mm, thickness_mm, unit, batch_id, product_code_id, product_codes(code)";
    const basicSelect = "id, date, source_quantity, cut_quantity_produced, cut_width_mm, thickness_mm, unit, product_code_id, product_codes(code)";
    let { data, error } = await supabase
      .from("slitting_entries")
      .select(fullSelect)
      .order("date", { ascending: false })
      .limit(500);
    if (error) {
      const fb = await supabase.from("slitting_entries").select(basicSelect).order("date", { ascending: false }).limit(500);
      data = fb.data as any;
    }
    setRows(((data as unknown) as SlittingRow[]) ?? []);

    const { data: retData } = await supabase
      .from("slitting_returns" as any)
      .select("slitting_entry_id, returned_quantity")
      .limit(5000);
    const sums: Record<string, number> = {};
    ((retData as any[]) ?? []).forEach((r) => {
      sums[r.slitting_entry_id] = (sums[r.slitting_entry_id] ?? 0) + Number(r.returned_quantity ?? 0);
    });
    setReturnsByRow(sums);

    const { data: clData } = await supabase.from("company_clients").select("id, name").eq("status", "active").order("name");
    setClients((clData as any[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user]);

  // Group slitting rows into batches
  const batches = useMemo<Batch[]>(() => {
    const map = new Map<string, SlittingRow[]>();
    rows.forEach((r) => {
      const key = r.batch_id ?? r.id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    });
    const out: Batch[] = [];
    map.forEach((group, key) => {
      const anchor = group.find((g) => Number(g.source_quantity) > 0) ?? group[0];
      const issuedSqm = group.reduce((s, g) => s + Number(g.source_quantity || 0), 0);
      const breakdown = group.map((g) => ({
        width: g.cut_width_mm,
        thickness: g.thickness_mm,
        sqm: (g.cut_width_mm / 1000) * Number(g.cut_quantity_produced || 0),
      }));
      const producedSqm = breakdown.reduce((s, b) => s + b.sqm, 0);
      // merge identical (width, thickness)
      const merged: { width: number; thickness: number | null; sqm: number }[] = [];
      breakdown.forEach((b) => {
        const found = merged.find((m) => m.width === b.width && m.thickness === b.thickness);
        if (found) found.sqm += b.sqm; else merged.push({ ...b });
      });
      out.push({
        key,
        anchorId: anchor.id,
        rowIds: group.map((g) => g.id),
        date: anchor.date,
        productCode: anchor.product_codes?.code ?? "—",
        issuedSqm,
        producedSqm,
        unit: anchor.unit,
        widthCount: new Set(group.map((g) => g.cut_width_mm)).size,
        breakdown: merged,
      });
    });
    return out.sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [rows]);

  const selected = batches.find((b) => b.key === form.batch_key);
  const alreadyReturned = selected ? selected.rowIds.reduce((s, id) => s + (returnsByRow[id] ?? 0), 0) : 0;
  const newReturn = parseFloat(form.returned_quantity) || 0;
  const wastage = selected ? selected.issuedSqm - selected.producedSqm - alreadyReturned - newReturn : 0;
  const matched = selected && Math.abs(wastage) < 0.01;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selected || !newReturn) {
      toast({ title: "Missing fields", description: "Select an entry and enter returned quantity.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const isoDate = form.entry_date || new Date().toISOString().slice(0, 10);
    const payload: any = {
      slitting_entry_id: selected.anchorId,
      client_id: form.client_id || null,
      date: isoDate,
      returned_quantity: newReturn,
      unit: form.unit,
      notes: form.notes || null,
      returned_by: user.id,
      created_at: new Date(isoDate + "T12:00:00").toISOString(),
    };
    let { error } = await supabase.from("slitting_returns" as any).insert(payload);
    if (error?.code === "PGRST204" && /'client_id' column/.test(error.message)) {
      const { client_id, ...fb } = payload;
      ({ error } = await supabase.from("slitting_returns" as any).insert(fb));
    }
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Return recorded" });
      setForm({ batch_key: "", client_id: "", entry_date: new Date().toISOString().slice(0, 10), returned_quantity: "", unit: "meters", notes: "" });
      await load();
    }
    setSubmitting(false);
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><PackageOpen className="h-5 w-5" /> Material Return Entry</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-3">
            <div className="space-y-2">
              <Label>Select Slitting Entry *</Label>
              <Select value={form.batch_key} onValueChange={(v) => setForm({ ...form, batch_key: v })}>
                <SelectTrigger><SelectValue placeholder="Choose a slitting source" /></SelectTrigger>
                <SelectContent>
                  {batches.map((b) => (
                    <SelectItem key={b.key} value={b.key}>
                      {format(new Date(b.date), "dd/MM/yy")} — {b.productCode} — {b.issuedSqm.toLocaleString(undefined, { maximumFractionDigits: 2 })} sqm{b.widthCount > 1 ? ` (${b.widthCount} widths)` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Date *</Label>
              <Input type="date" value={form.entry_date}
                onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Client (Optional)</Label>
            <Select value={form.client_id} onValueChange={(v) => setForm({ ...form, client_id: v })}>
              <SelectTrigger><SelectValue placeholder="Select client (optional)" /></SelectTrigger>
              <SelectContent>
                {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {selected && (
            <div className="rounded-lg border p-3 space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">Issued (sqm): </span><b>{selected.issuedSqm.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b></div>
                <div><span className="text-muted-foreground">Produced (sqm): </span><b>{selected.producedSqm.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b></div>
                <div><span className="text-muted-foreground">Already Returned: </span><b>{alreadyReturned.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b></div>
                <div><span className="text-muted-foreground">New Return: </span><b>{newReturn.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b></div>
              </div>
              <div className="border-t pt-2">
                <div className="text-xs text-muted-foreground mb-1">Thickness Breakdown</div>
                <ul className="text-xs space-y-0.5">
                  {selected.breakdown.map((b, i) => (
                    <li key={i}>
                      <span className="font-mono">{b.width} mm</span> · <span className="font-mono">{b.thickness ?? "—"} mm</span> — <b>{b.sqm.toLocaleString(undefined, { maximumFractionDigits: 2 })} sqm</b>
                    </li>
                  ))}
                </ul>
              </div>
              <div className={`rounded-md p-2 text-center font-semibold ${matched ? "bg-green-500/10 text-green-700" : "bg-destructive/10 text-destructive"}`}>
                {matched
                  ? "✓ Matched — No wastage (Issued = Produced + Returned)"
                  : `Wastage = ${wastage.toLocaleString(undefined, { maximumFractionDigits: 2 })} sqm (Issued − Produced − Returned)`}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Returned Quantity *</Label>
              <Input type="number" step="any" value={form.returned_quantity}
                onChange={(e) => setForm({ ...form, returned_quantity: e.target.value })} required />
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
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>

          <Button type="submit" className="w-full bg-secondary hover:bg-secondary/90 text-secondary-foreground" disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Return
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
