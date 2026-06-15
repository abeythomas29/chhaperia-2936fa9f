import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Download, Search, Pencil, Trash2, CalendarIcon, FileText } from "lucide-react";
import { format } from "date-fns";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface LogEntry {
  id: string;
  date: string;
  rolls_count: number;
  quantity_per_roll: number;
  total_quantity: number | null;
  unit: string;
  thickness_mm: number | null;
  product_code_id: string;
  client_id: string | null;
  lab_report_included: boolean | null;
  gsm: number | null;
  tensile_strength: number | null;
  elongation: number | null;
  swelling_height: number | null;
  swelling_speed: number | null;
  surface_resistance: number | null;
  notes: string | null;
  raw_material_included: boolean | null;
  product_codes: { code: string; category_id: string | null } | null;
  profiles: { name: string } | null;
  company_clients: { name: string } | null;
  raw_material_usage: { quantity_used: number; raw_materials: { name: string; unit: string } | null }[] | null;
}

interface ProductCode {
  id: string;
  code: string;
}

interface Category {
  id: string;
  name: string;
}

interface Client {
  id: string;
  name: string;
}

export default function ProductionLogs() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  // Date range filter
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Edit state
  const [editEntry, setEditEntry] = useState<LogEntry | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editProductCodeId, setEditProductCodeId] = useState("");
  const [editClientId, setEditClientId] = useState("");
  const [editRolls, setEditRolls] = useState("");
  const [editQtyPerRoll, setEditQtyPerRoll] = useState("");
  const [editUnit, setEditUnit] = useState("meters");
  const [editThickness, setEditThickness] = useState("");
  const [saving, setSaving] = useState(false);

  // Delete state
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Report dialog (was Lab Report + View Totals)
  const [reportEntry, setReportEntry] = useState<LogEntry | null>(null);

  // Dropdowns
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [clients, setClients] = useState<Client[]>([]);

  const fetchEntries = async () => {
    setLoading(true);

    const fullSelect = "id, date, rolls_count, quantity_per_roll, total_quantity, unit, thickness_mm, product_code_id, client_id, notes, gsm, tensile_strength, elongation, swelling_height, swelling_speed, surface_resistance, raw_material_included, product_codes(code, category_id), profiles:worker_id(name), company_clients:client_id(name), raw_material_usage(quantity_used, raw_materials(name, unit))";
    const midSelect = "id, date, rolls_count, quantity_per_roll, total_quantity, unit, thickness_mm, product_code_id, client_id, notes, raw_material_included, product_codes(code, category_id), profiles:worker_id(name), company_clients:client_id(name), raw_material_usage(quantity_used, raw_materials(name, unit))";
    const noRMISelect = "id, date, rolls_count, quantity_per_roll, total_quantity, unit, thickness_mm, product_code_id, client_id, notes, product_codes(code, category_id), profiles:worker_id(name), company_clients:client_id(name), raw_material_usage(quantity_used, raw_materials(name, unit))";
    const minimalSelect = "id, date, rolls_count, quantity_per_roll, total_quantity, unit, thickness_mm, product_code_id, client_id, notes, product_codes(code, category_id), profiles:worker_id(name), company_clients:client_id(name)";

    let { data, error } = await supabase
      .from("production_entries")
      .select(fullSelect)
      .order("date", { ascending: false })
      .limit(500);

    if (error) {
      const fb = await supabase.from("production_entries").select(midSelect).order("date", { ascending: false }).limit(500);
      data = fb.data as any; error = fb.error;
    }
    if (error) {
      const fb = await supabase.from("production_entries").select(noRMISelect).order("date", { ascending: false }).limit(500);
      data = fb.data as any; error = fb.error;
    }
    if (error) {
      const fb = await supabase.from("production_entries").select(minimalSelect).order("date", { ascending: false }).limit(500);
      data = fb.data as any; error = fb.error;
    }

    if (error) {
      toast({ title: "Failed to load production logs", description: error.message, variant: "destructive" });
      setEntries([]);
    } else {
      setEntries((data as unknown as LogEntry[]) ?? []);
    }
    setSelectedIds(new Set());
    setLoading(false);
  };

  const fetchDropdowns = async () => {
    const [{ data: pc }, { data: cl }, { data: cats }] = await Promise.all([
      supabase.from("product_codes").select("id, code").eq("status", "active").order("code"),
      supabase.from("company_clients").select("id, name").eq("status", "active").order("name"),
      supabase.from("product_categories").select("id, name").eq("status", "active").order("name"),
    ]);
    setProductCodes(pc ?? []);
    setClients(cl ?? []);
    setCategories(cats ?? []);
  };

  useEffect(() => {
    fetchEntries();
    fetchDropdowns();
  }, []);

  const filtered = entries.filter((e) => {
    const s = search.toLowerCase();
    const matchesSearch =
      !s ||
      e.product_codes?.code?.toLowerCase().includes(s) ||
      e.profiles?.name?.toLowerCase().includes(s) ||
      e.company_clients?.name?.toLowerCase().includes(s);

    const entryDate = new Date(e.date);
    const matchesFrom = !dateFrom || entryDate >= dateFrom;
    const matchesTo = !dateTo || entryDate <= dateTo;
    const matchesCategory = categoryFilter === "all" || e.product_codes?.category_id === categoryFilter;

    return matchesSearch && matchesFrom && matchesTo && matchesCategory;
  });

  const allFilteredSelected = filtered.length > 0 && filtered.every((e) => selectedIds.has(e.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((e) => e.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exportCSV = () => {
    const parseNoteNum = (notes: string | null, label: string) => {
      if (!notes) return 0;
      const m = notes.match(new RegExp(`${label}\\s*[:\\-]*\\s*([\\d.]+)`, "i"));
      return m ? parseFloat(m[1]) : 0;
    };
    const rows = [
      ["Date", "Product Code", "Client", "Production Manager", "Rolls", "Unit", "Length (mtr)", "Area (sqm)", "Weight (kg)", "GSM", "Thickness (mm)"],
      ...filtered.map((e) => {
        const total = e.total_quantity ?? (e.rolls_count * e.quantity_per_roll);
        const isMeters = e.unit === "meters";
        const isKg = e.unit === "kg";
        const lengthMtr = isMeters ? total : 0;
        const width = parseNoteNum(e.notes, "Width") || parseNoteNum(e.notes, "RollWidth");
        const gsm = e.gsm ?? parseNoteNum(e.notes, "GSM");
        const sqm = width > 0 && lengthMtr > 0 ? (width / 1000) * lengthMtr : 0;
        const kg = isKg ? total : (gsm > 0 && sqm > 0 ? (sqm * gsm) / 1000 : 0);
        return [
          e.date,
          e.product_codes?.code ?? "",
          e.company_clients?.name ?? "",
          e.profiles?.name ?? "",
          e.rolls_count,
          e.unit,
          lengthMtr > 0 ? lengthMtr.toFixed(2) : "",
          sqm > 0 ? sqm.toFixed(2) : "",
          kg > 0 ? kg.toFixed(2) : "",
          gsm > 0 ? gsm : "",
          e.thickness_mm ?? "",
        ];
      }),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `production_logs_${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
  };

  // Edit handlers
  const openEdit = (entry: LogEntry) => {
    setEditEntry(entry);
    setEditDate(entry.date);
    setEditProductCodeId(entry.product_code_id);
    setEditClientId(entry.client_id ?? "");
    setEditRolls(String(entry.rolls_count));
    setEditQtyPerRoll(String(entry.quantity_per_roll));
    setEditUnit(entry.unit);
    setEditThickness(entry.thickness_mm != null ? String(entry.thickness_mm) : "");
  };

  const handleSaveEdit = async () => {
    if (!editEntry) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("production_entries")
      .update({
        date: editDate,
        product_code_id: editProductCodeId,
        client_id: editClientId,
        rolls_count: Number(editRolls),
        quantity_per_roll: Number(editQtyPerRoll),
        unit: editUnit,
        thickness_mm: editThickness ? Number(editThickness) : null,
      })
      .eq("id", editEntry.id)
      .select("id");

    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else if (!data || data.length === 0) {
      toast({ title: "Not updated", description: "No rows changed. You may not have permission to edit this entry.", variant: "destructive" });
    } else {
      toast({ title: "Entry updated successfully" });
      setEditEntry(null);
      fetchEntries();
    }
  };

  // Delete handlers
  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    const { error } = await supabase
      .from("production_entries")
      .delete()
      .eq("id", deleteId);

    setDeleting(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Entry deleted successfully" });
      setDeleteId(null);
      fetchEntries();
    }
  };

  // Bulk delete
  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    const ids = Array.from(selectedIds);
    const { error } = await supabase
      .from("production_entries")
      .delete()
      .in("id", ids);

    setBulkDeleting(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `${ids.length} entries deleted successfully` });
      setBulkDeleteOpen(false);
      fetchEntries();
    }
  };

  const clearDateFilter = () => {
    setDateFrom(undefined);
    setDateTo(undefined);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Production Logs</h1>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <Button onClick={() => setBulkDeleteOpen(true)} variant="destructive" size="sm">
              <Trash2 className="h-4 w-4 mr-2" /> Delete {selectedIds.size} Selected
            </Button>
          )}
          <Button onClick={exportCSV} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by product, client, manager..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
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
          <Button variant="ghost" size="sm" onClick={clearDateFilter}>Clear dates</Button>
        )}
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox checked={allFilteredSelected} onCheckedChange={toggleSelectAll} aria-label="Select all" />
              </TableHead>
              <TableHead className="text-base">Date</TableHead>
              <TableHead>Product Code</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Production Manager</TableHead>
              <TableHead className="text-right">Rolls</TableHead>
              <TableHead className="text-right">Qty/Roll</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">Length (mtr)</TableHead>
              <TableHead className="text-right">Area (sqm)</TableHead>
              <TableHead className="text-right">Weight (kg)</TableHead>
              <TableHead className="text-right">GSM</TableHead>
              <TableHead className="text-right">Thickness (mm)</TableHead>
              <TableHead>Raw Materials</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={16} className="text-center py-8 text-muted-foreground">Loading...</TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={16} className="text-center py-8 text-muted-foreground">No entries found</TableCell>
              </TableRow>
            ) : (
              filtered.map((e) => {
                const parseNum = (label: string) => {
                  if (!e.notes) return 0;
                  const m = e.notes.match(new RegExp(`${label}\\s*[:\\-]*\\s*([\\d.]+)`, "i"));
                  return m ? parseFloat(m[1]) : 0;
                };
                const total = e.total_quantity ?? (e.rolls_count * e.quantity_per_roll);
                const isMeters = e.unit === "meters";
                const isKg = e.unit === "kg";
                const lengthMtr = isMeters ? total : 0;
                const width = parseNum("Width") || parseNum("RollWidth");
                const gsm = e.gsm ?? parseNum("GSM");
                const sqm = width > 0 && lengthMtr > 0 ? (width / 1000) * lengthMtr : 0;
                const kg = isKg ? total : (gsm > 0 && sqm > 0 ? (sqm * gsm) / 1000 : 0);
                const fmt = (n: number, d = 2) => n.toLocaleString(undefined, { maximumFractionDigits: d });
                const noteHasRawMaterialFlag = /raw\s*material\s*used\s*[:\-]*\s*yes/i.test(e.notes ?? "");
                const noteCopperWires = (() => {
                  const m = (e.notes ?? "").match(/copper\s*wires\s*[:\-]*\s*([^|]+)/i);
                  return m?.[1]?.trim() ?? null;
                })();
                const materialLines = e.raw_material_usage && e.raw_material_usage.length > 0
                  ? e.raw_material_usage.map((u) => `${u.raw_materials?.name ?? "—"}: ${u.quantity_used} ${u.raw_materials?.unit ?? ""}`.trim())
                  : noteCopperWires
                    ? [`Copper Wires: ${noteCopperWires}`]
                    : (e.raw_material_included || noteHasRawMaterialFlag)
                      ? ["Raw material used"]
                      : [];
                const hasReport =
                  e.gsm != null || e.thickness_mm != null || e.tensile_strength != null || e.elongation != null ||
                  e.swelling_height != null || e.swelling_speed != null || e.surface_resistance != null ||
                  parseNum("GSM") || parseNum("Tensile") || parseNum("Elongation") ||
                  parseNum("Swelling Height") || parseNum("Swelling Speed") || parseNum("Surface Resistance");
                return (
                <TableRow key={e.id} data-state={selectedIds.has(e.id) ? "selected" : undefined}>
                  <TableCell>
                    <Checkbox checked={selectedIds.has(e.id)} onCheckedChange={() => toggleSelect(e.id)} aria-label="Select row" />
                  </TableCell>
                  <TableCell className="text-base font-medium whitespace-nowrap">{(() => { const d = new Date(e.date); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(-2)}`; })()}</TableCell>
                  <TableCell className="font-medium">{e.product_codes?.code ?? "—"}</TableCell>
                  <TableCell>{e.company_clients?.name ?? "—"}</TableCell>
                  <TableCell>{e.profiles?.name ?? "—"}</TableCell>
                  <TableCell className="text-right">{e.rolls_count}</TableCell>
                  <TableCell className="text-right">{e.quantity_per_roll} sqmtr</TableCell>
                  <TableCell className="text-right font-semibold">{e.total_quantity != null ? `${e.total_quantity} ${e.unit}` : "—"}</TableCell>
                  <TableCell>{e.unit}</TableCell>
                  <TableCell className="text-right font-mono">{lengthMtr > 0 ? fmt(lengthMtr) : "—"}</TableCell>
                  <TableCell className="text-right font-mono">{sqm > 0 ? fmt(sqm) : "—"}</TableCell>
                  <TableCell className="text-right font-mono">{kg > 0 ? fmt(kg) : "—"}</TableCell>
                  <TableCell className="text-right font-mono">{gsm > 0 ? gsm : "—"}</TableCell>
                  <TableCell className="text-right">{e.thickness_mm ?? "—"}</TableCell>
                  <TableCell className="text-xs">
                    {materialLines.length > 0
                      ? materialLines.map((line, i) => (
                          <div key={i}>{line}</div>
                        ))
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
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
              })
            )}
          </TableBody>
        </Table>
      </div>


      {/* Edit Dialog */}
      <Dialog open={!!editEntry} onOpenChange={(open) => !open && setEditEntry(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Production Entry</DialogTitle>
            <DialogDescription>Update the details for this production entry.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Date</Label>
              <Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Product Code</Label>
              <Select value={editProductCodeId} onValueChange={setEditProductCodeId}>
                <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                <SelectContent>
                  {productCodes.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Rolls Count</Label>
                <Input type="number" value={editRolls} onChange={(e) => setEditRolls(e.target.value)} min={1} />
              </div>
              <div className="space-y-2">
                <Label>Qty per Roll</Label>
                <Input type="number" value={editQtyPerRoll} onChange={(e) => setEditQtyPerRoll(e.target.value)} min={0} step="0.01" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Unit</Label>
              <Select value={editUnit} onValueChange={setEditUnit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="meters">Meters</SelectItem>
                  <SelectItem value="kg">Kg</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Thickness (mm)</Label>
              <Input type="number" value={editThickness} onChange={(e) => setEditThickness(e.target.value)} min={0} step="0.01" placeholder="e.g. 0.25" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditEntry(null)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Entry</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this production entry? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirmation */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} Entries</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedIds.size} production entries? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDelete} disabled={bulkDeleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {bulkDeleting ? "Deleting..." : `Delete ${selectedIds.size} Entries`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Report Dialog */}
      <Dialog open={!!reportEntry} onOpenChange={(open) => !open && setReportEntry(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" /> Report
            </DialogTitle>
            <DialogDescription>
              {reportEntry?.product_codes?.code ?? "—"} · {reportEntry ? format(new Date(reportEntry.date), "dd/MM/yyyy") : ""}
            </DialogDescription>
          </DialogHeader>
          {reportEntry && (() => {
            const parseNote = (label: string) => {
              if (!reportEntry.notes) return null;
              const re = new RegExp(`${label}\\s*[:\\-]*\\s*([\\d.]+)`, "i");
              const m = reportEntry.notes.match(re);
              return m ? m[1] : null;
            };
            const get = (col: number | null | undefined, label: string) =>
              col != null ? String(col) : parseNote(label);
            const pairs: [string, string | null][] = [
              ["GSM", get(reportEntry.gsm, "GSM")],
              ["Thickness (mm)", reportEntry.thickness_mm != null ? String(reportEntry.thickness_mm) : parseNote("Thickness")],
              ["Tensile Strength", get(reportEntry.tensile_strength, "Tensile")],
              ["Elongation", get(reportEntry.elongation, "Elongation")],
              ["Swelling Height", get(reportEntry.swelling_height, "Swelling Height")],
              ["Swelling Speed", get(reportEntry.swelling_speed, "Swelling Speed")],
              ["Surface Resistance", get(reportEntry.surface_resistance, "Surface Resistance")],
            ];
            const noteHasRawMaterialFlag = /raw\s*material\s*used\s*[:\-]*\s*yes/i.test(reportEntry.notes ?? "");
            const noteCopperWires = (() => {
              const m = (reportEntry.notes ?? "").match(/copper\s*wires\s*[:\-]*\s*([^|]+)/i);
              return m?.[1]?.trim() ?? null;
            })();
            const materialLines = reportEntry.raw_material_usage && reportEntry.raw_material_usage.length > 0
              ? reportEntry.raw_material_usage.map((u) => ({
                  label: u.raw_materials?.name ?? "—",
                  value: `${u.quantity_used} ${u.raw_materials?.unit ?? ""}`.trim(),
                }))
              : noteCopperWires
                ? [{ label: "Copper Wires", value: noteCopperWires }]
                : (reportEntry.raw_material_included || noteHasRawMaterialFlag)
                  ? [{ label: "Raw Material", value: "Used" }]
                  : [];
            return (
              <div className="space-y-4">
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
                <div>
                  <p className="text-sm font-semibold mb-2">Raw Materials Used</p>
                  {materialLines.length > 0 ? (
                    <div className="divide-y border rounded-md">
                      {materialLines.map((u, i) => (
                        <div key={i} className="flex items-center justify-between px-4 py-2.5">
                          <span className="text-sm">{u.label}</span>
                          <span className="font-mono font-semibold">{u.value}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">None recorded</p>
                  )}
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReportEntry(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
