import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Layers } from "lucide-react";
import { UNIT_OPTIONS } from "@/lib/units";
import { format } from "date-fns";

interface SlittingRow {
  id: string;
  date: string;
  cut_quantity_produced: number;
  cut_width_mm: number;
  thickness_mm: number | null;
  gsm: number | null;
  unit: string;
  notes?: string | null;
  product_codes: { code: string; id?: string } | null;
}

export default function Head36Entry() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [slittingEntries, setSlittingEntries] = useState<SlittingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    slitting_entry_id: "",
    entry_date: new Date().toISOString().slice(0, 10),
    rolls_taken: "",
    times_cut: "",
    rolls_per_cut: "",
    roll_width_mm: "",
    length_per_tape_mtr: "",
    unit: "meters",
    notes: "",
  });

  useEffect(() => {
    if (!user) return;
    (async () => {
      const fullSelect = "id, date, cut_quantity_produced, cut_width_mm, thickness_mm, gsm, unit, notes, product_codes(code, id)";
      const basicSelect = "id, date, cut_quantity_produced, cut_width_mm, thickness_mm, unit, notes, product_codes(code, id)";
      let { data, error } = await supabase
        .from("slitting_entries")
        .select(fullSelect)
        .order("date", { ascending: false });
      if (error) {
        const fb = await supabase
          .from("slitting_entries")
          .select(basicSelect)
          .order("date", { ascending: false });
        data = fb.data as any;
      }
      const rows = ((data as unknown as any[]) ?? []).map((r) => {
        let gsm = r.gsm ?? null;
        if (gsm == null && typeof r.notes === "string") {
          const m = r.notes.match(/GSM\s*[:\-]\s*(\d+(?:\.\d+)?)/i);
          if (m) gsm = parseFloat(m[1]);
        }
        return { ...r, gsm } as SlittingRow;
      });
      setSlittingEntries(rows);
      setLoading(false);
    })();
  }, [user]);

  const source = slittingEntries.find((s) => s.id === form.slitting_entry_id);

  // Auto-fill width when source is selected
  useEffect(() => {
    if (source) {
      setForm((f) => ({
        ...f,
        roll_width_mm: f.roll_width_mm || (source.cut_width_mm ? String(source.cut_width_mm) : ""),
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.slitting_entry_id]);

  const width = parseFloat(form.roll_width_mm) || 0;
  const length = parseFloat(form.length_per_tape_mtr) || 0;
  const timesCut = parseFloat(form.times_cut) || 0;
  const rollsPerCut = parseFloat(form.rolls_per_cut) || 0;
  const rolls = timesCut * rollsPerCut;

  const totalLength = length * rolls;
  const totalSqm = width && length && rolls ? (width * length / 1000) * rolls : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!timesCut || !rollsPerCut) {
      toast({ title: "Missing fields", description: "Enter times roll cut and rolls per cutting.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("head36_entries" as any).insert({
      slitting_entry_id: form.slitting_entry_id || null,
      product_code_id: source?.product_codes?.id ?? null,
      rolls_taken: parseFloat(form.rolls_taken) || 0,
      rolls_produced: rolls,
      roll_width_mm: width || null,
      length_per_tape_mtr: length || null,
      thickness_mm: source?.thickness_mm ?? null,
      gsm: source?.gsm ?? null,
      unit: form.unit,
      notes: [form.notes, `Cuts: ${timesCut} × ${rollsPerCut} rolls/cut`].filter(Boolean).join(" | "),
      operator_id: user.id,
      created_at: form.entry_date ? new Date(form.entry_date + "T12:00:00").toISOString() : new Date().toISOString(),
    } as any);
    if (error) {
      const isMissingTable = (error as any).code === "PGRST205" || /head36_entries/i.test(error.message ?? "") && /schema cache|not find/i.test(error.message ?? "");
      const description = isMissingTable
        ? "36 Head table is not provisioned in the backend yet. Ask an admin to run the head36_entries setup SQL (see .lovable/plan.md)."
        : error.message;
      toast({ title: "Error", description, variant: "destructive" });
    } else {
      toast({ title: "36 Head entry saved" });
      setForm({ ...form, rolls_taken: "", times_cut: "", rolls_per_cut: "", roll_width_mm: "", length_per_tape_mtr: "", notes: "" });
    }
    setSubmitting(false);
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Layers className="h-5 w-5" /> 36 Head Production Entry</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-3">
            <div className="space-y-2">
              <Label>Source Slitting Entry *</Label>
              <Select value={form.slitting_entry_id} onValueChange={(v) => setForm({ ...form, slitting_entry_id: v })}>
                <SelectTrigger><SelectValue placeholder="Choose source rolls" /></SelectTrigger>
                <SelectContent>
                  {slittingEntries.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {format(new Date(e.date), "dd/MM/yy")} — {e.product_codes?.code ?? "—"} — {e.cut_width_mm}mm — {e.cut_quantity_produced} {e.unit}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {source && (
                <p className="text-xs text-muted-foreground">
                  Thickness: {source.thickness_mm ?? "—"} mm · GSM: {source.gsm ?? "—"} (from slitting entry)
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Date *</Label>
              <Input type="date" value={form.entry_date}
                onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Total Rolls Taken</Label>
              <Input type="number" step="any" value={form.rolls_taken}
                onChange={(e) => setForm({ ...form, rolls_taken: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Times Roll Cut *</Label>
              <Input type="number" step="any" value={form.times_cut}
                onChange={(e) => setForm({ ...form, times_cut: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>Rolls per Cutting *</Label>
              <Input type="number" step="any" value={form.rolls_per_cut}
                onChange={(e) => setForm({ ...form, rolls_per_cut: e.target.value })} required />
            </div>
          </div>
          {rolls > 0 && (
            <p className="text-xs text-muted-foreground -mt-2">Total rolls produced: <span className="font-semibold text-foreground">{rolls.toLocaleString()}</span> ({timesCut} × {rollsPerCut})</p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Width of Tape (mm)</Label>
              <Input type="number" step="any" value={form.roll_width_mm}
                onChange={(e) => setForm({ ...form, roll_width_mm: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Length per Tape (mtr)</Label>
              <Input type="number" step="any" value={form.length_per_tape_mtr}
                onChange={(e) => setForm({ ...form, length_per_tape_mtr: e.target.value })} />
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

          <div className="bg-muted rounded-lg p-4 grid grid-cols-2 gap-3 text-center">
            <div>
              <p className="text-xs text-muted-foreground">Total Length Produced</p>
              <p className="text-xl font-bold text-primary">{totalLength.toLocaleString()} <span className="text-sm font-normal">mtr</span></p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Production (sqm)</p>
              <p className="text-xl font-bold text-primary">{totalSqm.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-sm font-normal">sqm</span></p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>

          <Button type="submit" className="w-full bg-secondary hover:bg-secondary/90 text-secondary-foreground" disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save 36 Head Entry
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
