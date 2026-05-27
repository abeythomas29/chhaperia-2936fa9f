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
import { Download, Search, Pencil, Trash2, CalendarIcon } from "lucide-react";
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
  product_codes: { code: string } | null;
  profiles: { name: string } | null;
}

interface ProductCode {
  id: string;
  code: string;
}

interface Client {
  id: string;
  name: string;
}

export default function ProductionLogs() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [search, setSearch] = useState("");
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

  // Dropdowns
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [clients, setClients] = useState<Client[]>([]);

  const fetchEntries = async () => {
    setLoading(true);

    // Try with thickness_mm first; fall back without it if column doesn't exist yet
    let { data, error } = await supabase
      .from("production_entries")
      .select("id, date, rolls_count, quantity_per_roll, total_quantity, unit, thickness_mm, product_code_id, client_id, product_codes(code), profiles:worker_id(name)")
      .order("date", { ascending: false })
      .limit(500);

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
    const [{ data: pc }, { data: cl }] = await Promise.all([
      supabase.from("product_codes").select("id, code").eq("status", "active").order("code"),
      supabase.from("company_clients").select("id, name").eq("status", "active").order("name"),
    ]);
    setProductCodes(pc ?? []);
    setClients(cl ?? []);
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
      e.profiles?.name?.toLowerCase().includes(s);

    const entryDate = new Date(e.date);
    const matchesFrom = !dateFrom || entryDate >= dateFrom;
    const matchesTo = !dateTo || entryDate <= dateTo;

    return matchesSearch && matchesFrom && matchesTo;
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
    const rows = [
      ["Date", "Product Code", "Production Manager", "Rolls", "Qty/Roll", "Total", "Unit", "Thickness (mm)"],
      ...filtered.map((e) => [
        e.date,
        e.product_codes?.code ?? "",
        e.profiles?.name ?? "",
        e.rolls_count,
        e.quantity_per_roll,
        e.total_quantity ?? "",
        e.unit,
        e.thickness_mm ?? "",
      ]),
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
    const { error } = await supabase
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
      .eq("id", editEntry.id);

    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
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
              <TableHead>Production Manager</TableHead>
              <TableHead className="text-right">Rolls</TableHead>
              <TableHead className="text-right">Qty/Roll</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">Thickness (mm)</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">Loading...</TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No entries found</TableCell>
              </TableRow>
            ) : (
              filtered.map((e) => (
                <TableRow key={e.id} data-state={selectedIds.has(e.id) ? "selected" : undefined}>
                  <TableCell>
                    <Checkbox checked={selectedIds.has(e.id)} onCheckedChange={() => toggleSelect(e.id)} aria-label="Select row" />
                  </TableCell>
                  <TableCell className="text-base font-medium whitespace-nowrap">{(() => { const d = new Date(e.date); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(-2)}`; })()}</TableCell>
                  <TableCell className="font-medium">{e.product_codes?.code ?? "—"}</TableCell>
                  <TableCell>{e.profiles?.name ?? "—"}</TableCell>
                  <TableCell className="text-right">{e.rolls_count}</TableCell>
                  <TableCell className="text-right">{e.quantity_per_roll}</TableCell>
                  <TableCell className="text-right font-semibold">{e.total_quantity ?? "—"}</TableCell>
                  <TableCell>{e.unit}</TableCell>
                  <TableCell className="text-right">{e.thickness_mm ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(e)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteId(e.id)} title="Delete" className="text-destructive hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
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
    </div>
  );
}
