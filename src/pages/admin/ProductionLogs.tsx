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
import { Download, Search, Pencil, Trash2, CalendarIcon, FlaskConical, ChevronLeft, ChevronRight } from "lucide-react";
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

  // Pagination
  const [page, setPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

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

  // RM (Raw Material) + LR (Lab Report) status dialogs
  const [rmEntry, setRmEntry] = useState<LogEntry | null>(null);
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

  useEffect(() => {
    setPage(1);
  }, [search, dateFrom, dateTo, categoryFilter, itemsPerPage]);

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

  const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage));
  const paginated = filtered.slice((page - 1) * itemsPerPage, page * itemsPerPage);
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
        const isKg = e.unit === "kg";
        const width = parseNoteNum(e.notes, "Width") || parseNoteNum(e.notes, "RollWidth");
        const gsm = e.gsm ?? parseNoteNum(e.notes, "GSM");
        // quantity_per_roll is stored as area-per-roll (length × width/1000) when width is provided, so total = area (sqm).
        const sqm = width > 0 ? total : 0;
        const lengthMtr = width > 0 ? (total * 1000) / width : (e.unit === "meters" ? total : 0);
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

      <div className="hidden md:block border rounded-lg w-full overflow-x-auto">
        <Table className="w-full table-auto text-xs sm:text-sm [&_th]:px-2 [&_td]:px-2 [&_th]:py-2 [&_td]:py-2 [&_th]:whitespace-normal [&_td]:break-words">
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
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">Length (mtr)</TableHead>
              <TableHead className="text-right">Area (sqm)</TableHead>
              <TableHead className="text-right">Weight (kg)</TableHead>
              <TableHead className="text-right">GSM</TableHead>
              <TableHead className="text-right">Thickness (mm)</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={13} className="text-center py-8 text-muted-foreground">Loading...</TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} className="text-center py-8 text-muted-foreground">No entries found</TableCell>
              </TableRow>

            ) : (
              paginated.map((e) => {
                const parseNum = (label: string) => {
                  if (!e.notes) return 0;
                  const m = e.notes.match(new RegExp(`${label}\\s*[:\\-]*\\s*([\\d.]+)`, "i"));
                  return m ? parseFloat(m[1]) : 0;
                };
                const total = e.total_quantity ?? (e.rolls_count * e.quantity_per_roll);
                const isKg = e.unit === "kg";
                const width = parseNum("Width") || parseNum("RollWidth");
                const gsm = e.gsm ?? parseNum("GSM");
                // quantity_per_roll = length × width/1000 (area per roll), so total = total area in sqm
                const sqm = width > 0 ? total : 0;
                const lengthMtr = width > 0 ? (total * 1000) / width : (e.unit === "meters" ? total : 0);
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
                  <TableCell>{e.unit}</TableCell>
                  <TableCell className="text-right font-mono">{lengthMtr > 0 ? fmt(lengthMtr) : "—"}</TableCell>
                  <TableCell className="text-right font-mono">{sqm > 0 ? fmt(sqm) : "—"}</TableCell>
                  <TableCell className="text-right font-mono">{kg > 0 ? fmt(kg) : "—"}</TableCell>
                  <TableCell className="text-right font-mono">{gsm > 0 ? gsm : "—"}</TableCell>
                  <TableCell className="text-right">{e.thickness_mm ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setRmEntry(e)}
                        title={materialLines.length > 0 ? "Raw material recorded — click to view" : "No raw material recorded"}
                        className={cn(
                          "h-7 w-7 rounded-full text-[10px] font-bold text-white flex items-center justify-center transition-opacity hover:opacity-80",
                          materialLines.length > 0 ? "bg-emerald-500" : "bg-red-500"
                        )}
                      >
                        RM
                      </button>
                      <button
                        type="button"
                        onClick={() => setReportEntry(e)}
                        title={hasReport ? "Lab report recorded — click to view" : "No lab report recorded"}
                        className={cn(
                          "h-7 w-7 rounded-full text-[10px] font-bold text-white flex items-center justify-center transition-opacity hover:opacity-80",
                          hasReport ? "bg-emerald-500" : "bg-red-500"
                        )}
                      >
                        LR
                      </button>

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

      {/* Mobile card view */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">No entries found</div>
        ) : (
          paginated.map((e) => {
            const parseNum = (label: string) => {
              if (!e.notes) return 0;
              const m = e.notes.match(new RegExp(`${label}\\s*[:\\-]*\\s*([\\d.]+)`, "i"));
              return m ? parseFloat(m[1]) : 0;
            };
            const total = e.total_quantity ?? (e.rolls_count * e.quantity_per_roll);
            const isKg = e.unit === "kg";
            const width = parseNum("Width") || parseNum("RollWidth");
            const gsm = e.gsm ?? parseNum("GSM");
            const sqm = width > 0 ? total : 0;
            const lengthMtr = width > 0 ? (total * 1000) / width : (e.unit === "meters" ? total : 0);
            const kg = isKg ? total : (gsm > 0 && sqm > 0 ? (sqm * gsm) / 1000 : 0);
            const fmt = (n: number, d = 2) => n.toLocaleString(undefined, { maximumFractionDigits: d });
            const noteHasRawMaterialFlag = /raw\s*material\s*used\s*[:\-]*\s*yes/i.test(e.notes ?? "");
            const noteCopperWires = (() => {
              const m = (e.notes ?? "").match(/copper\s*wires\s*[:\-]*\s*([^|]+)/i);
              return m?.[1]?.trim() ?? null;
            })();
            const hasMaterial = (e.raw_material_usage && e.raw_material_usage.length > 0) || !!noteCopperWires || !!e.raw_material_included || noteHasRawMaterialFlag;
            const hasReport =
              e.gsm != null || e.thickness_mm != null || e.tensile_strength != null || e.elongation != null ||
              e.swelling_height != null || e.swelling_speed != null || e.surface_resistance != null ||
              parseNum("GSM") || parseNum("Tensile") || parseNum("Elongation") ||
              parseNum("Swelling Height") || parseNum("Swelling Speed") || parseNum("Surface Resistance");
            const d = new Date(e.date);
            const dateStr = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(-2)}`;
            return (
              <div key={e.id} className="border rounded-lg p-3 bg-card">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Checkbox checked={selectedIds.has(e.id)} onCheckedChange={() => toggleSelect(e.id)} aria-label="Select row" />
                      <span className="font-semibold text-sm">{e.product_codes?.code ?? "—"}</span>
                      <span className="text-xs text-muted-foreground">{dateStr}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 truncate">
                      {(e.company_clients?.name ?? "—")} · {(e.profiles?.name ?? "—")}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setRmEntry(e)}
                      title={hasMaterial ? "Raw material recorded — click to view" : "No raw material recorded"}
                      className={cn(
                        "h-7 w-7 rounded-full text-[10px] font-bold text-white flex items-center justify-center",
                        hasMaterial ? "bg-emerald-500" : "bg-red-500"
                      )}
                    >RM</button>
                    <button
                      type="button"
                      onClick={() => setReportEntry(e)}
                      title={hasReport ? "Lab report recorded — click to view" : "No lab report recorded"}
                      className={cn(
                        "h-7 w-7 rounded-full text-[10px] font-bold text-white flex items-center justify-center",
                        hasReport ? "bg-emerald-500" : "bg-red-500"
                      )}
                    >LR</button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(e)} title="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(e.id)} title="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div><div className="text-muted-foreground">Rolls</div><div className="font-mono">{e.rolls_count}</div></div>
                  <div><div className="text-muted-foreground">Unit</div><div>{e.unit}</div></div>
                  <div><div className="text-muted-foreground">Thickness</div><div className="font-mono">{e.thickness_mm ?? "—"}</div></div>
                  <div><div className="text-muted-foreground">Length (m)</div><div className="font-mono">{lengthMtr > 0 ? fmt(lengthMtr) : "—"}</div></div>
                  <div><div className="text-muted-foreground">Area (sqm)</div><div className="font-mono">{sqm > 0 ? fmt(sqm) : "—"}</div></div>
                  <div><div className="text-muted-foreground">Weight (kg)</div><div className="font-mono">{kg > 0 ? fmt(kg) : "—"}</div></div>
                  <div><div className="text-muted-foreground">GSM</div><div className="font-mono">{gsm > 0 ? gsm : "—"}</div></div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {filtered.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              Showing {(page - 1) * itemsPerPage + 1}–{Math.min(page * itemsPerPage, filtered.length)} of {filtered.length} entries
            </span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Rows per page</span>
              <Select value={String(itemsPerPage)} onValueChange={(v) => setItemsPerPage(Number(v))}>
                <SelectTrigger className="h-8 w-[80px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[10, 25, 50, 100, 200].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4 mr-1" /> Previous
            </Button>
            <span className="text-sm font-medium min-w-[3rem] text-center">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

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

      {/* RM (Raw Material) Dialog */}
      <Dialog open={!!rmEntry} onOpenChange={(open) => !open && setRmEntry(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="h-6 w-6 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center">RM</span>
              Raw Material
            </DialogTitle>
            <DialogDescription>
              {rmEntry?.product_codes?.code ?? "—"} · {rmEntry ? format(new Date(rmEntry.date), "dd/MM/yyyy") : ""}
            </DialogDescription>
          </DialogHeader>
          {rmEntry && (() => {
            const noteHasRawMaterialFlag = /raw\s*material\s*used\s*[:\-]*\s*yes/i.test(rmEntry.notes ?? "");
            const noteCopperWires = (() => {
              const m = (rmEntry.notes ?? "").match(/copper\s*wires\s*[:\-]*\s*([^|]+)/i);
              return m?.[1]?.trim() ?? null;
            })();
            const materialLines = rmEntry.raw_material_usage && rmEntry.raw_material_usage.length > 0
              ? rmEntry.raw_material_usage.map((u) => ({
                  label: u.raw_materials?.name ?? "—",
                  value: `${u.quantity_used} ${u.raw_materials?.unit ?? ""}`.trim(),
                }))
              : noteCopperWires
                ? [{ label: "Copper Wires", value: noteCopperWires }]
                : (rmEntry.raw_material_included || noteHasRawMaterialFlag)
                  ? [{ label: "Raw Material", value: "Used" }]
                  : [];
            return materialLines.length > 0 ? (
              <div className="divide-y border rounded-md">
                {materialLines.map((u, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm">{u.label}</span>
                    <span className="font-mono font-semibold">{u.value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">No raw material data recorded for this entry.</p>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRmEntry(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>



      {/* LR (Lab Report) Dialog */}
      <Dialog open={!!reportEntry} onOpenChange={(open) => !open && setReportEntry(null)}>

        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="h-6 w-6 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center">LR</span>
              Lab Report
            </DialogTitle>
            <DialogDescription>
              {reportEntry?.product_codes?.code ?? "—"} · {reportEntry ? format(new Date(reportEntry.date), "dd/MM/yyyy") : ""}
            </DialogDescription>
          </DialogHeader>
          {reportEntry && (() => {
            const parseNoteNum = (label: string): number => {
              if (!reportEntry.notes) return 0;
              const m = reportEntry.notes.match(new RegExp(`${label}\\s*[:\\-]*\\s*([\\d.]+)`, "i"));
              return m ? parseFloat(m[1]) : 0;
            };
            const fields: { label: string; value: string | number | null; unit?: string }[] = [
              { label: "GSM", value: reportEntry.gsm ?? (parseNoteNum("GSM") || null) },
              { label: "Thickness", value: reportEntry.thickness_mm, unit: "mm" },
              { label: "Tensile Strength", value: reportEntry.tensile_strength ?? (parseNoteNum("Tensile") || null) },
              { label: "Elongation", value: reportEntry.elongation ?? (parseNoteNum("Elongation") || null), unit: "%" },
              { label: "Swelling Height", value: reportEntry.swelling_height ?? (parseNoteNum("Swelling Height") || null) },
              { label: "Swelling Speed", value: reportEntry.swelling_speed ?? (parseNoteNum("Swelling Speed") || null) },
              { label: "Surface Resistance", value: reportEntry.surface_resistance ?? (parseNoteNum("Surface Resistance") || null) },
            ].filter((f) => f.value != null && f.value !== 0);
            return fields.length > 0 ? (
              <div className="divide-y border rounded-md">
                {fields.map((f, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm">{f.label}</span>
                    <span className="font-mono font-semibold">{f.value}{f.unit ? ` ${f.unit}` : ""}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">No lab report data recorded for this entry.</p>
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
