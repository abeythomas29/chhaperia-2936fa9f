import { useEffect, useState } from "react";
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
  unit: string;
  product_codes: { code: string } | null;
}

export default function MaterialReturn() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [entries, setEntries] = useState<SlittingRow[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [returns, setReturns] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ slitting_entry_id: "", client_id: "", entry_date: new Date().toISOString().slice(0, 10), returned_quantity: "", unit: "meters", notes: "" });


  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data: entryData } = await supabase
      .from("slitting_entries")
      .select("id, date, source_quantity, cut_quantity_produced, unit, product_codes(code)")
      .order("date", { ascending: false })
      .limit(100);
    setEntries((entryData as unknown as SlittingRow[]) ?? []);

    const { data: retData } = await supabase
      .from("slitting_returns" as any)
      .select("slitting_entry_id, returned_quantity")
      .limit(2000);
    const sums: Record<string, number> = {};
    ((retData as any[]) ?? []).forEach((r) => {
      sums[r.slitting_entry_id] = (sums[r.slitting_entry_id] ?? 0) + Number(r.returned_quantity ?? 0);
    });
    setReturns(sums);
    const { data: clData } = await supabase.from("company_clients").select("id, name").eq("status", "active").order("name");
    setClients((clData as any[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user]);

  const selected = entries.find((e) => e.id === form.slitting_entry_id);
  const alreadyReturned = selected ? (returns[selected.id] ?? 0) : 0;
  const newReturn = parseFloat(form.returned_quantity) || 0;
  const totalReturned = alreadyReturned + newReturn;
  const issued = selected ? Number(selected.source_quantity) : 0;
  const produced = selected ? Number(selected.cut_quantity_produced) : 0;
  const wastage = selected ? issued - produced - totalReturned : 0;
  const matched = selected && Math.abs(wastage) < 0.01;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !form.slitting_entry_id || !newReturn) {
      toast({ title: "Missing fields", description: "Select an entry and enter returned quantity.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const isoDate = form.entry_date || new Date().toISOString().slice(0, 10);
    const payload: any = {
      slitting_entry_id: form.slitting_entry_id,
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
      const isMissingTable = (error as any).code === "PGRST205" || /slitting_returns/i.test(error.message ?? "") && /schema cache|not find/i.test(error.message ?? "");
      const description = isMissingTable
        ? "Material Return table is not available in the backend schema cache yet. Please try again now that the cache has been refreshed."
        : error.message;
      toast({ title: "Error", description, variant: "destructive" });
    } else {
      toast({ title: "Return recorded" });
      setForm({ slitting_entry_id: "", client_id: "", entry_date: new Date().toISOString().slice(0, 10), returned_quantity: "", unit: "meters", notes: "" });

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
              <Select value={form.slitting_entry_id} onValueChange={(v) => setForm({ ...form, slitting_entry_id: v })}>
                <SelectTrigger><SelectValue placeholder="Choose a slitting source" /></SelectTrigger>
                <SelectContent>
                  {entries.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {format(new Date(e.date), "dd/MM/yy")} — {e.product_codes?.code ?? "—"} — {e.source_quantity} {e.unit}
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
                <div><span className="text-muted-foreground">Issued (before production): </span><b>{issued.toLocaleString()} {selected.unit}</b></div>
                <div><span className="text-muted-foreground">Produced: </span><b>{produced.toLocaleString()}</b></div>
                <div><span className="text-muted-foreground">Already Returned: </span><b>{alreadyReturned.toLocaleString()}</b></div>
                <div><span className="text-muted-foreground">New Return: </span><b>{newReturn.toLocaleString()}</b></div>
              </div>
              <div className={`rounded-md p-2 text-center font-semibold ${matched ? "bg-green-500/10 text-green-700" : "bg-destructive/10 text-destructive"}`}>
                {matched
                  ? "✓ Matched — No wastage (Issued = Produced + Returned)"
                  : `Wastage = ${wastage.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${selected.unit} (Issued − Produced − Returned)`}
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
