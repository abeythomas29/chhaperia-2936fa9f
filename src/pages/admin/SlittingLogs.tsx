import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, Scissors, Search, Trash2, Layers } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface SlittingRow {
  id: string;
  date: string;
  source_quantity: number;
  cut_quantity_produced: number;
  cut_width_mm: number;
  thickness_mm: number | null;
  gsm: number | null;
  unit: string;
  notes: string | null;
  slitting_manager_id: string;
  product_codes: { code: string } | null;
}

const parseNum = (notes: string | null, label: string): number => {
  if (!notes) return 0;
  const m = notes.match(new RegExp(`${label}\\s*[:\\-]*\\s*([\\d.]+)`, "i"));
  return m ? parseFloat(m[1]) : 0;
};

const computeTotals = (r: SlittingRow) => {
  const lengthMtr = r.cut_quantity_produced || 0;
  const sqm = (r.cut_width_mm / 1000) * lengthMtr;
  const gsm = r.gsm ?? parseNum(r.notes, "GSM");
  const kg = gsm > 0 ? (sqm * gsm) / 1000 : 0;
  const rollLength = parseNum(r.notes, "RollLength");
  const rolls = rollLength > 0 ? lengthMtr / rollLength : 0;
  return { lengthMtr, sqm, kg, rolls, rollLength };
};

interface Head36Row {
  id: string;
  date: string;
  slitting_entry_id: string | null;
  rolls_taken: number;
  rolls_produced: number;
  roll_width_mm: number | null;
  length_per_tape_mtr: number | null;
  thickness_mm: number | null;
  gsm: number | null;
  unit: string;
  notes: string | null;
  operator_id: string;
}

export default function SlittingLogs() {
  const [entries, setEntries] = useState<SlittingRow[]>([]);
  const [managers, setManagers] = useState<Record<string, string>>({});
  const [head36ByEntry, setHead36ByEntry] = useState<Record<string, Head36Row[]>>({});
  const [head36Operators, setHead36Operators] = useState<Record<string, string>>({});
  const [head36Open, setHead36Open] = useState<SlittingRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [productFilter, setProductFilter] = useState<string>("all");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();

  const handleDelete = async (id: string) => {
    setDeleting(true);
    const { error } = await supabase.from("slitting_entries").delete().eq("id", id);
    setDeleting(false);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    setEntries((prev) => prev.filter((e) => e.id !== id));
    setDeleteId(null);
    toast({ title: "Entry deleted" });
  };

  useEffect(() => {
    (async () => {
      const fullSelect = "id, date, source_quantity, cut_quantity_produced, cut_width_mm, thickness_mm, gsm, unit, notes, slitting_manager_id, product_codes(code)";
      const basicSelect = "id, date, source_quantity, cut_quantity_produced, cut_width_mm, thickness_mm, unit, notes, slitting_manager_id, product_codes(code)";

      let { data, error } = await supabase
        .from("slitting_entries")
        .select(fullSelect)
        .order("date", { ascending: false });

      if (error) {
        const fallback = await supabase
          .from("slitting_entries")
          .select(basicSelect)
          .order("date", { ascending: false });
        data = fallback.data as any;
        error = fallback.error;
      }

      if (error) {
        setEntries([]);
        setLoading(false);
        return;
      }

      const rows = (data as unknown as SlittingRow[]) ?? [];
      setEntries(rows);

      const ids = Array.from(new Set(rows.map((r) => r.slitting_manager_id).filter(Boolean)));
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, name")
          .in("user_id", ids);
        const map: Record<string, string> = {};
        (profs ?? []).forEach((p: any) => { map[p.user_id] = p.name; });
        setManagers(map);
      }

      // Fetch head36 entries linked to these slitting entries
      const slittingIds = rows.map((r) => r.id);
      if (slittingIds.length) {
        const { data: h36 } = await supabase
          .from("head36_entries" as any)
          .select("id, date, slitting_entry_id, rolls_taken, rolls_produced, roll_width_mm, length_per_tape_mtr, thickness_mm, gsm, unit, notes, operator_id")
          .in("slitting_entry_id", slittingIds);
        const grouped: Record<string, Head36Row[]> = {};
        ((h36 as unknown as Head36Row[]) ?? []).forEach((r) => {
          if (!r.slitting_entry_id) return;
          (grouped[r.slitting_entry_id] ||= []).push(r);
        });
        setHead36ByEntry(grouped);

        const opIds = Array.from(new Set(((h36 as unknown as Head36Row[]) ?? []).map((r) => r.operator_id).filter(Boolean)));
        if (opIds.length) {
          const { data: ops } = await supabase.from("profiles").select("user_id, name").in("user_id", opIds);
          const opMap: Record<string, string> = {};
          (ops ?? []).forEach((p: any) => { opMap[p.user_id] = p.name; });
          setHead36Operators(opMap);
        }
      }
      setLoading(false);
    })();
  }, []);

  const products = Array.from(new Set(entries.map((e) => e.product_codes?.code).filter(Boolean))) as string[];

  const filtered = entries.filter((e) => {
    if (productFilter !== "all" && e.product_codes?.code !== productFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (e.product_codes?.code ?? "").toLowerCase().includes(q) ||
      (managers[e.slitting_manager_id] ?? "").toLowerCase().includes(q) ||
      (e.notes ?? "").toLowerCase().includes(q)
    );
  });

  const totals = filtered.reduce(
    (acc, e) => {
      const t = computeTotals(e);
      acc.rolls += t.rolls;
      acc.length += t.lengthMtr;
      acc.sqm += t.sqm;
      acc.kg += t.kg;
      return acc;
    },
    { rolls: 0, length: 0, sqm: 0, kg: 0 }
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Scissors className="h-5 w-5" /> Slitting Logs
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by product, manager, notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={productFilter} onValueChange={setProductFilter}>
            <SelectTrigger className="sm:w-64"><SelectValue placeholder="All products" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All products</SelectItem>
              {products.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="bg-muted rounded-lg p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-center mb-4">
          <div>
            <p className="text-xs text-muted-foreground">Total Rolls</p>
            <p className="text-xl font-bold text-primary">{totals.rolls.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Length</p>
            <p className="text-xl font-bold text-primary">{totals.length.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-sm font-normal">mtr</span></p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Area</p>
            <p className="text-xl font-bold text-primary">{totals.sqm.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-sm font-normal">sqm</span></p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Weight</p>
            <p className="text-xl font-bold text-primary">{totals.kg.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-sm font-normal">kg</span></p>
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="text-muted-foreground text-center py-6">No slitting entries.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Manager</TableHead>
                  <TableHead>Cut Width</TableHead>
                  <TableHead className="text-right">Rolls</TableHead>
                  <TableHead className="text-right">Length (mtr)</TableHead>
                  <TableHead className="text-right">Area (sqm)</TableHead>
                  <TableHead className="text-right">Weight (kg)</TableHead>
                  <TableHead className="text-right">GSM</TableHead>
                  <TableHead className="text-right">Thickness (mm)</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((e) => {
                  const t = computeTotals(e);
                  const gsm = e.gsm ?? parseNum(e.notes, "GSM");
                  return (
                    <TableRow key={e.id}>
                      <TableCell>{format(new Date(e.date), "dd/MM/yy")}</TableCell>
                      <TableCell className="font-medium">{e.product_codes?.code ?? "—"}</TableCell>
                      <TableCell>{managers[e.slitting_manager_id] ?? "—"}</TableCell>
                      <TableCell>{e.cut_width_mm} mm</TableCell>
                      <TableCell className="text-right font-mono">{t.rolls > 0 ? t.rolls.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}</TableCell>
                      <TableCell className="text-right font-mono">{t.lengthMtr.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right font-mono">{t.sqm.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right font-mono">{t.kg > 0 ? t.kg.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</TableCell>
                      <TableCell className="text-right font-mono">{gsm > 0 ? gsm : "—"}</TableCell>
                      <TableCell className="text-right font-mono">{e.thickness_mm ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => setDeleteId(e.id)} title="Delete" className="text-destructive hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}


        <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && !deleting && setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete slitting entry?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes the entry. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleting}
                onClick={(ev) => { ev.preventDefault(); if (deleteId) void handleDelete(deleteId); }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
