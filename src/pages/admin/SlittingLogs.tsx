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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Loader2, Scissors, Search, Trash2, Layers, CalendarIcon, Pencil, Download } from "lucide-react";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

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
  client_id?: string | null;
  product_codes: { code: string; category_id?: string | null } | null;
  company_clients?: { name: string } | null;
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

interface ReturnRow {
  id: string;
  date: string;
  slitting_entry_id: string;
  returned_quantity: number;
  unit: string;
  notes: string | null;
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
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [reportEntry, setReportEntry] = useState<SlittingRow | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editEntry, setEditEntry] = useState<SlittingRow | null>(null);
  const [editForm, setEditForm] = useState({ date: "", cut_width_mm: "", cut_quantity_produced: "", thickness_mm: "", gsm: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [editH36, setEditH36] = useState<Head36Row | null>(null);
  const [editH36Form, setEditH36Form] = useState({ date: "", rolls_taken: "", rolls_produced: "", roll_width_mm: "", length_per_tape_mtr: "", thickness_mm: "", gsm: "", notes: "" });
  const [savingH36, setSavingH36] = useState(false);
  const [returnsByEntry, setReturnsByEntry] = useState<Record<string, ReturnRow[]>>({});
  const [rmOpen, setRmOpen] = useState<SlittingRow | null>(null);
  const { toast } = useToast();

  const openEdit = (e: SlittingRow) => {
    setEditEntry(e);
    setEditForm({
      date: e.date,
      cut_width_mm: String(e.cut_width_mm ?? ""),
      cut_quantity_produced: String(e.cut_quantity_produced ?? ""),
      thickness_mm: e.thickness_mm != null ? String(e.thickness_mm) : "",
      gsm: e.gsm != null ? String(e.gsm) : "",
      notes: e.notes ?? "",
    });
  };

  const handleSaveEdit = async () => {
    if (!editEntry) return;
    setSaving(true);
    const payload: any = {
      date: editForm.date,
      cut_width_mm: Number(editForm.cut_width_mm),
      cut_quantity_produced: Number(editForm.cut_quantity_produced),
      thickness_mm: editForm.thickness_mm ? Number(editForm.thickness_mm) : null,
      notes: editForm.notes || null,
    };
    if (editForm.gsm) payload.gsm = Number(editForm.gsm);
    const { data, error } = await supabase.from("slitting_entries").update(payload).eq("id", editEntry.id).select("id");
    setSaving(false);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    } else if (!data || data.length === 0) {
      toast({ title: "Not updated", description: "No rows changed. You may not have permission (admin role required).", variant: "destructive" });
    } else {
      setEntries((prev) => prev.map((r) => r.id === editEntry.id ? { ...r, ...payload } as SlittingRow : r));
      setEditEntry(null);
      toast({ title: "Entry updated" });
    }
  };

  const openEditH36 = (h: Head36Row) => {
    setEditH36(h);
    setEditH36Form({
      date: h.date,
      rolls_taken: String(h.rolls_taken ?? ""),
      rolls_produced: String(h.rolls_produced ?? ""),
      roll_width_mm: h.roll_width_mm != null ? String(h.roll_width_mm) : "",
      length_per_tape_mtr: h.length_per_tape_mtr != null ? String(h.length_per_tape_mtr) : "",
      thickness_mm: h.thickness_mm != null ? String(h.thickness_mm) : "",
      gsm: h.gsm != null ? String(h.gsm) : "",
      notes: h.notes ?? "",
    });
  };

  const handleSaveH36 = async () => {
    if (!editH36) return;
    setSavingH36(true);
    const payload: any = {
      date: editH36Form.date,
      rolls_taken: Number(editH36Form.rolls_taken),
      rolls_produced: Number(editH36Form.rolls_produced),
      roll_width_mm: editH36Form.roll_width_mm ? Number(editH36Form.roll_width_mm) : null,
      length_per_tape_mtr: editH36Form.length_per_tape_mtr ? Number(editH36Form.length_per_tape_mtr) : null,
      thickness_mm: editH36Form.thickness_mm ? Number(editH36Form.thickness_mm) : null,
      gsm: editH36Form.gsm ? Number(editH36Form.gsm) : null,
      notes: editH36Form.notes || null,
    };
    const { data, error } = await supabase.from("head36_entries" as any).update(payload).eq("id", editH36.id).select("id");
    setSavingH36(false);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    } else if (!data || (data as any[]).length === 0) {
      toast({ title: "Not updated", description: "No rows changed. You may not have permission (admin role required).", variant: "destructive" });
    } else {
      setHead36ByEntry((prev) => {
        const next: Record<string, Head36Row[]> = {};
        Object.entries(prev).forEach(([k, list]) => {
          next[k] = list.map((r) => r.id === editH36.id ? { ...r, ...payload } as Head36Row : r);
        });
        return next;
      });
      setEditH36(null);
      toast({ title: "36 Head entry updated" });
    }
  };

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
      const fullSelect = "id, date, source_quantity, cut_quantity_produced, cut_width_mm, thickness_mm, gsm, unit, notes, slitting_manager_id, client_id, product_codes(code, category_id), company_clients:client_id(name)";
      const basicSelect = "id, date, source_quantity, cut_quantity_produced, cut_width_mm, thickness_mm, unit, notes, slitting_manager_id, client_id, product_codes(code, category_id), company_clients:client_id(name)";

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

        // Fetch slitting returns linked to these slitting entries
        const { data: rets } = await supabase
          .from("slitting_returns")
          .select("id, date, slitting_entry_id, returned_quantity, unit, notes")
          .in("slitting_entry_id", slittingIds);
        const retGrouped: Record<string, ReturnRow[]> = {};
        ((rets as unknown as ReturnRow[]) ?? []).forEach((r) => {
          (retGrouped[r.slitting_entry_id] ||= []).push(r);
        });
        setReturnsByEntry(retGrouped);
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("product_categories").select("id, name").eq("status", "active").order("name");
      setCategories(data ?? []);
    })();
  }, []);

  const products = Array.from(new Set(entries.map((e) => e.product_codes?.code).filter(Boolean))) as string[];

  const filtered = entries.filter((e) => {
    if (productFilter !== "all" && e.product_codes?.code !== productFilter) return false;
    if (categoryFilter !== "all" && e.product_codes?.category_id !== categoryFilter) return false;
    const d = new Date(e.date);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (e.product_codes?.code ?? "").toLowerCase().includes(q) ||
      (managers[e.slitting_manager_id] ?? "").toLowerCase().includes(q) ||
      (e.company_clients?.name ?? "").toLowerCase().includes(q) ||
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
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by product, manager, notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="All categories" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={productFilter} onValueChange={setProductFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="All products" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All products</SelectItem>
              {products.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn("justify-start text-left font-normal", !dateFrom && "text-muted-foreground")}>
                <CalendarIcon className="h-4 w-4 mr-2" />
                {dateFrom ? format(dateFrom, "dd/MM/yyyy") : "From date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} initialFocus className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn("justify-start text-left font-normal", !dateTo && "text-muted-foreground")}>
                <CalendarIcon className="h-4 w-4 mr-2" />
                {dateTo ? format(dateTo, "dd/MM/yyyy") : "To date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateTo} onSelect={setDateTo} initialFocus className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
          {(dateFrom || dateTo) && (
            <Button variant="ghost" size="sm" onClick={() => { setDateFrom(undefined); setDateTo(undefined); }}>Clear dates</Button>
          )}
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
                  <TableHead>Client</TableHead>
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
                  const h36s = head36ByEntry[e.id] ?? [];
                  const has36 = h36s.length > 0;
                  return (
                    <TableRow key={e.id}>
                      <TableCell>{format(new Date(e.date), "dd/MM/yy")}</TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <span>{e.product_codes?.code ?? "—"}</span>
                          {has36 && (
                            <Badge
                              onClick={() => setHead36Open(e)}
                              className="cursor-pointer bg-secondary text-secondary-foreground hover:bg-secondary/80"
                              title="View 36 Head production details"
                            >
                              <Layers className="h-3 w-3 mr-1" /> 36
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{e.company_clients?.name ?? "—"}</TableCell>
                      <TableCell>{managers[e.slitting_manager_id] ?? "—"}</TableCell>
                      <TableCell>{e.cut_width_mm} mm</TableCell>
                      <TableCell className="text-right font-mono">{t.rolls > 0 ? t.rolls.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}</TableCell>
                      <TableCell className="text-right font-mono">{t.lengthMtr.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right font-mono">{t.sqm.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right font-mono">{t.kg > 0 ? t.kg.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</TableCell>
                      <TableCell className="text-right font-mono">{gsm > 0 ? gsm : "—"}</TableCell>
                      <TableCell className="text-right font-mono">{e.thickness_mm ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => setReportEntry(e)} title="Report" className="text-primary hover:text-primary">
                            <FileText className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => openEdit(e)} title="Edit">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteId(e.id)} title="Delete" className="text-destructive hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
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

        <Dialog open={!!head36Open} onOpenChange={(open) => !open && setHead36Open(null)}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Layers className="h-5 w-5" /> 36 Head Production —{" "}
                {head36Open?.product_codes?.code ?? "—"}
              </DialogTitle>
              <DialogDescription>
                Slitting entry dated {head36Open ? format(new Date(head36Open.date), "dd/MM/yy") : ""} ·
                Cut width {head36Open?.cut_width_mm} mm
              </DialogDescription>
            </DialogHeader>
            {head36Open && (() => {
              const list = head36ByEntry[head36Open.id] ?? [];
              if (!list.length) return <p className="text-muted-foreground text-sm">No 36 head production recorded for this slitting entry.</p>;
              return (
                <div className="space-y-3">
                  {list.map((h) => {
                    const totalLen = (h.length_per_tape_mtr ?? 0) * (h.rolls_produced ?? 0);
                    const totalSqm = h.roll_width_mm && h.length_per_tape_mtr && h.rolls_produced
                      ? (h.roll_width_mm * h.length_per_tape_mtr / 1000) * h.rolls_produced
                      : 0;
                    return (
                      <div key={h.id} className="border rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{format(new Date(h.date), "dd/MM/yy")}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">{head36Operators[h.operator_id] ?? "—"}</span>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEditH36(h)} title="Edit">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                          <div><span className="text-muted-foreground">Rolls Taken:</span> <span className="font-mono">{h.rolls_taken}</span></div>
                          <div><span className="text-muted-foreground">Rolls Produced:</span> <span className="font-mono">{h.rolls_produced}</span></div>
                          <div><span className="text-muted-foreground">Tape Width:</span> <span className="font-mono">{h.roll_width_mm ?? "—"} mm</span></div>
                          <div><span className="text-muted-foreground">Length/Tape:</span> <span className="font-mono">{h.length_per_tape_mtr ?? "—"} mtr</span></div>
                          <div><span className="text-muted-foreground">Thickness:</span> <span className="font-mono">{h.thickness_mm ?? "—"} mm</span></div>
                          <div><span className="text-muted-foreground">GSM:</span> <span className="font-mono">{h.gsm ?? "—"}</span></div>
                        </div>
                        <div className="bg-muted rounded p-2 grid grid-cols-2 gap-2 text-center">
                          <div>
                            <p className="text-xs text-muted-foreground">Total Length</p>
                            <p className="font-bold text-primary">{totalLen.toLocaleString(undefined, { maximumFractionDigits: 2 })} mtr</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Total Production</p>
                            <p className="font-bold text-primary">{totalSqm.toLocaleString(undefined, { maximumFractionDigits: 2 })} sqm</p>
                          </div>
                        </div>
                        {h.notes && <p className="text-xs text-muted-foreground">Notes: {h.notes}</p>}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            <DialogFooter>
              <Button variant="outline" onClick={() => setHead36Open(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!reportEntry} onOpenChange={(open) => !open && setReportEntry(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" /> Lab Report
              </DialogTitle>
              <DialogDescription>
                {reportEntry?.product_codes?.code ?? "—"} · {reportEntry ? format(new Date(reportEntry.date), "dd/MM/yyyy") : ""}
              </DialogDescription>
            </DialogHeader>
            {reportEntry && (() => {
              const note = (label: string) => {
                if (!reportEntry.notes) return null;
                const m = reportEntry.notes.match(new RegExp(`${label}\\s*[:\\-]*\\s*([\\d.]+)`, "i"));
                return m ? m[1] : null;
              };
              const pairs: [string, string | null][] = [
                ["GSM", reportEntry.gsm != null ? String(reportEntry.gsm) : note("GSM")],
                ["Thickness (mm)", reportEntry.thickness_mm != null ? String(reportEntry.thickness_mm) : note("Thickness")],
                ["Tensile Strength", note("Tensile")],
                ["Elongation", note("Elongation")],
                ["Swelling Height", note("Swelling Height")],
                ["Swelling Speed", note("Swelling Speed")],
                ["Surface Resistance", note("Surface Resistance")],
              ];
              return (
                <div className="divide-y border rounded-md">
                  {pairs.map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-sm text-muted-foreground">{k}</span>
                      <span className={`font-mono ${v != null && v !== "" ? "font-semibold" : "text-muted-foreground"}`}>
                        {v != null && v !== "" ? v : "N/A"}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })()}
            <DialogFooter>
              <Button variant="outline" onClick={() => setReportEntry(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!editEntry} onOpenChange={(o) => !o && setEditEntry(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Slitting Entry</DialogTitle>
              <DialogDescription>Update details including the date for this slitting entry.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={editForm.date} onChange={(e) => setEditForm({ ...editForm, date: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Cut Width (mm)</Label>
                  <Input type="number" step="any" value={editForm.cut_width_mm} onChange={(e) => setEditForm({ ...editForm, cut_width_mm: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Total Length (mtr)</Label>
                  <Input type="number" step="any" value={editForm.cut_quantity_produced} onChange={(e) => setEditForm({ ...editForm, cut_quantity_produced: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Thickness (mm)</Label>
                  <Input type="number" step="any" value={editForm.thickness_mm} onChange={(e) => setEditForm({ ...editForm, thickness_mm: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>GSM</Label>
                  <Input type="number" step="any" value={editForm.gsm} onChange={(e) => setEditForm({ ...editForm, gsm: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Input value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditEntry(null)}>Cancel</Button>
              <Button onClick={handleSaveEdit} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!editH36} onOpenChange={(o) => !o && setEditH36(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit 36 Head Entry</DialogTitle>
              <DialogDescription>Update details including the date for this 36 head production entry.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={editH36Form.date} onChange={(e) => setEditH36Form({ ...editH36Form, date: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Rolls Taken</Label>
                  <Input type="number" step="any" value={editH36Form.rolls_taken} onChange={(e) => setEditH36Form({ ...editH36Form, rolls_taken: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Rolls Produced</Label>
                  <Input type="number" step="any" value={editH36Form.rolls_produced} onChange={(e) => setEditH36Form({ ...editH36Form, rolls_produced: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Tape Width (mm)</Label>
                  <Input type="number" step="any" value={editH36Form.roll_width_mm} onChange={(e) => setEditH36Form({ ...editH36Form, roll_width_mm: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Length/Tape (mtr)</Label>
                  <Input type="number" step="any" value={editH36Form.length_per_tape_mtr} onChange={(e) => setEditH36Form({ ...editH36Form, length_per_tape_mtr: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Thickness (mm)</Label>
                  <Input type="number" step="any" value={editH36Form.thickness_mm} onChange={(e) => setEditH36Form({ ...editH36Form, thickness_mm: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>GSM</Label>
                  <Input type="number" step="any" value={editH36Form.gsm} onChange={(e) => setEditH36Form({ ...editH36Form, gsm: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Input value={editH36Form.notes} onChange={(e) => setEditH36Form({ ...editH36Form, notes: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditH36(null)}>Cancel</Button>
              <Button onClick={handleSaveH36} disabled={savingH36}>{savingH36 ? "Saving..." : "Save Changes"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </CardContent>
    </Card>
  );
}
