import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Scissors, Plus, Trash2, ChevronDown, Layers } from "lucide-react";
import { UNIT_OPTIONS } from "@/lib/units";

interface ProductCode { id: string; code: string; category_id: string; }
interface RollRow { width_mm: string; rolls_count: string; }

export default function SlittingEntryForm() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [rollsOpen, setRollsOpen] = useState(true);
  const [rollRows, setRollRows] = useState<RollRow[]>([{ width_mm: "", rolls_count: "" }]);

  const [form, setForm] = useState({
    product_code_id: "",
    qty_per_source: "",
    source_count: "",
    source_unit: "meters",
    roll_length_mtr: "",
    thickness_mm: "",
    gsm: "",
    unit: "meters",
    notes: "",
  });

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("product_codes")
        .select("id, code, category_id")
        .eq("status", "active")
        .order("code");
      setProductCodes(data ?? []);
      setLoading(false);
    })();
  }, []);

  const rollLength = parseFloat(form.roll_length_mtr) || 0;
  const gsm = parseFloat(form.gsm) || 0;
  const qtyPerSource = parseFloat(form.qty_per_source) || 0;
  const sourceCount = parseFloat(form.source_count) || 0;
  const sourceQty = qtyPerSource * sourceCount;

  const validRollRows = rollRows.filter((r) => parseFloat(r.width_mm) > 0 && parseFloat(r.rolls_count) > 0);

  const totalRolls = validRollRows.reduce((s, r) => s + (parseFloat(r.rolls_count) || 0), 0);
  const totalSqm = rollLength
    ? validRollRows.reduce((s, r) => s + (parseFloat(r.width_mm) * rollLength / 1000) * parseFloat(r.rolls_count), 0)
    : 0;

  const sqmFromGsm = !totalSqm && gsm > 0 && sourceQty > 0 && form.source_unit === "kg"
    ? (1000 / gsm) * sourceQty
    : 0;
  const totalProduction = totalSqm || sqmFromGsm;
  const totalLength = rollLength * totalRolls;

  const updateRollRow = (i: number, patch: Partial<RollRow>) =>
    setRollRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRollRow = () => setRollRows((rows) => [...rows, { width_mm: "", rolls_count: "" }]);
  const removeRollRow = (i: number) => setRollRows((rows) => rows.filter((_, idx) => idx !== i));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!form.product_code_id || !sourceQty) {
      toast({ title: "Missing fields", description: "Select product code and enter source quantity (per source × count).", variant: "destructive" });
      return;
    }
    if (validRollRows.length === 0) {
      toast({ title: "Missing rolls", description: "Add at least one roll (width + count) under Rolls.", variant: "destructive" });
      return;
    }

    setSubmitting(true);

    const sourceNote = `Source: ${qtyPerSource} × ${sourceCount} ${form.source_unit}`;
    const rowsToInsert = validRollRows.map((r, idx) => ({
      product_code_id: form.product_code_id,
      source_quantity: idx === 0 ? sourceQty : 0,
      cut_quantity_produced: rollLength ? rollLength * parseFloat(r.rolls_count) : parseFloat(r.rolls_count),
      cut_width_mm: parseFloat(r.width_mm),
      remaining_returned: 0,
      thickness_mm: form.thickness_mm ? parseFloat(form.thickness_mm) : null,
      unit: form.unit,
      notes: [form.notes, `Roll ${idx + 1} of ${validRollRows.length}`, sourceNote, form.gsm ? `GSM: ${form.gsm}` : ""].filter(Boolean).join(" | "),
      slitting_manager_id: user.id,
    }));

    const { error } = await supabase.from("slitting_entries").insert(rowsToInsert as any);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Saved ${rowsToInsert.length} roll entries` });
      setForm({ ...form, qty_per_source: "", source_count: "", roll_length_mtr: "", thickness_mm: "", gsm: "", notes: "" });
      setRollRows([{ width_mm: "", rolls_count: "" }]);
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
          <div className="space-y-2">
            <Label>Product Code *</Label>
            <Select value={form.product_code_id} onValueChange={(v) => setForm({ ...form, product_code_id: v })}>
              <SelectTrigger><SelectValue placeholder="Select product code" /></SelectTrigger>
              <SelectContent>
                {productCodes.map((pc) => <SelectItem key={pc.id} value={pc.id}>{pc.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Rolls breakdown (per-roll width when widths vary) */}
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
              <p className="text-xs text-muted-foreground">
                Add one row per roll width. Use multiple rows if some rolls came narrower than required.
              </p>
              {rollRows.map((r, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                  <div className="space-y-1">
                    <Label className="text-xs">Roll {idx + 1} Width (mm)</Label>
                    <Input type="number" step="any" value={r.width_mm}
                      onChange={(e) => updateRollRow(idx, { width_mm: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">No. of Rolls</Label>
                    <Input type="number" step="any" value={r.rolls_count}
                      onChange={(e) => updateRollRow(idx, { rolls_count: e.target.value })} />
                  </div>
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeRollRow(idx)} disabled={rollRows.length === 1}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addRollRow}>
                <Plus className="h-4 w-4 mr-1" /> Add Roll
              </Button>
            </CollapsibleContent>
          </Collapsible>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Qty per Source *</Label>
              <Input type="number" step="any" value={form.qty_per_source}
                onChange={(e) => setForm({ ...form, qty_per_source: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>No. of Sources *</Label>
              <Input type="number" step="any" value={form.source_count}
                onChange={(e) => setForm({ ...form, source_count: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>Source Unit</Label>
              <Select value={form.source_unit} onValueChange={(v) => setForm({ ...form, source_unit: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {UNIT_OPTIONS.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {sourceQty > 0 && (
            <p className="text-xs text-muted-foreground -mt-2">Total source: <span className="font-semibold text-foreground">{sourceQty.toLocaleString()} {form.source_unit}</span></p>
          )}

          <div className="space-y-2">
            <Label>Produced Roll Length (mtr)</Label>
            <Input type="number" step="any" value={form.roll_length_mtr}
              onChange={(e) => setForm({ ...form, roll_length_mtr: e.target.value })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Thickness (mm)</Label>
              <Input type="number" step="any" value={form.thickness_mm}
                onChange={(e) => setForm({ ...form, thickness_mm: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>GSM</Label>
              <Input type="number" step="any" value={form.gsm}
                onChange={(e) => setForm({ ...form, gsm: e.target.value })} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Output Unit</Label>
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
              <p className="text-xl font-bold text-primary">{totalLength.toLocaleString()} <span className="text-sm font-normal">mtr</span></p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total (sqm)</p>
              <p className="text-xl font-bold text-primary">{totalProduction.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-sm font-normal">sqm</span></p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes / Remarks</Label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>

          <Button type="submit" className="w-full bg-secondary hover:bg-secondary/90 text-secondary-foreground" disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Slitting Entry
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
