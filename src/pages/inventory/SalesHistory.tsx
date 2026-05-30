import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, ShoppingCart, Pencil, Trash2, Filter, X } from "lucide-react";
import { format, isWithinInterval, startOfDay, endOfDay } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

interface SaleRow {
  id: string;
  date: string;
  item_type: "raw_material" | "finished_product";
  quantity: number;
  unit: string;
  price_per_unit: number;
  total_amount: number;
  thickness_mm: number | null;
  notes: string | null;
  raw_material_id: string | null;
  product_code_id: string | null;
  client_id: string;
  item_name?: string;
  client_name?: string;
  sold_by?: string;
}

export default function SalesHistory() {
  const { user, isAdmin } = useAuth();
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | "raw_material" | "finished_product">("all");
  const [showFilters, setShowFilters] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editRow, setEditRow] = useState<SaleRow | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteRow, setDeleteRow] = useState<SaleRow | null>(null);
  const [editForm, setEditForm] = useState({ quantity: "", price_per_unit: "", thickness_mm: "", notes: "" });
  const { toast } = useToast();

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      let q = supabase.from("sales").select("*").order("date", { ascending: false }).order("created_at", { ascending: false }).limit(500);
      if (!isAdmin) q = q.eq("sold_by", user.id);
      const { data } = await q;
      const sales = (data ?? []) as SaleRow[];

      // enrich
      const matIds = [...new Set(sales.filter((s) => s.raw_material_id).map((s) => s.raw_material_id as string))];
      const prodIds = [...new Set(sales.filter((s) => s.product_code_id).map((s) => s.product_code_id as string))];
      const clientIds = [...new Set(sales.filter((s) => s.client_id).map((s) => s.client_id))];

      const [mats, prods, cls] = await Promise.all([
        matIds.length ? supabase.from("raw_materials").select("id, name").in("id", matIds) : Promise.resolve({ data: [] as any[] }),
        prodIds.length ? supabase.from("product_codes").select("id, code").in("id", prodIds) : Promise.resolve({ data: [] as any[] }),
        clientIds.length ? supabase.from("company_clients").select("id, name").in("id", clientIds) : Promise.resolve({ data: [] as any[] }),
      ]);

      const matMap = new Map((mats.data ?? []).map((m: any) => [m.id, m.name]));
      const prodMap = new Map((prods.data ?? []).map((p: any) => [p.id, p.code]));
      const clientMap = new Map((cls.data ?? []).map((c: any) => [c.id, c.name]));

      const enriched = sales.map((s: any) => ({
        ...s,
        item_name: s.raw_material_id ? matMap.get(s.raw_material_id) : prodMap.get(s.product_code_id || ""),
        client_name: s.client_id ? clientMap.get(s.client_id) : (s.client_name || null),
        sold_by: s.sold_by,
      }));
      setRows(enriched);
      setLoading(false);
    };
    load();
  }, [user, isAdmin, loading]);

  const reload = () => { setLoading(true); };

  const openEdit = (r: SaleRow) => {
    setEditRow(r);
    setEditForm({
      quantity: String(r.quantity),
      price_per_unit: String(r.price_per_unit),
      thickness_mm: r.thickness_mm != null ? String(r.thickness_mm) : "",
      notes: r.notes ?? "",
    });
    setEditDialogOpen(true);
  };

  const handleEditSave = async () => {
    if (!editRow) return;
    const { error } = await supabase.from("sales").update({
      quantity: Number(editForm.quantity),
      price_per_unit: Number(editForm.price_per_unit),
      thickness_mm: editForm.thickness_mm ? Number(editForm.thickness_mm) : null,
      notes: editForm.notes.trim() || null,
    } as any).eq("id", editRow.id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Sale updated" });
    setEditDialogOpen(false);
    setEditRow(null);
    reload();
  };

  const handleDelete = async () => {
    if (!deleteRow) return;
    const { error } = await supabase.from("sales").delete().eq("id", deleteRow.id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Sale deleted" });
    setDeleteRow(null);
    reload();
  };

  const canModify = (r: any) => isAdmin || r.sold_by === user?.id;

  const filtered = rows.filter((r) => {
    const q = search.toLowerCase();
    const matchesSearch =
      (r.item_name ?? "").toLowerCase().includes(q) ||
      (r.client_name ?? "").toLowerCase().includes(q) ||
      (r.notes ?? "").toLowerCase().includes(q);

    let matchesDate = true;
    if (dateFrom || dateTo) {
      const d = new Date(r.date);
      if (dateFrom && dateTo) {
        matchesDate = isWithinInterval(d, { start: startOfDay(new Date(dateFrom)), end: endOfDay(new Date(dateTo)) });
      } else if (dateFrom) {
        matchesDate = d >= startOfDay(new Date(dateFrom));
      } else if (dateTo) {
        matchesDate = d <= endOfDay(new Date(dateTo));
      }
    }

    const matchesCategory = categoryFilter === "all" || r.item_type === categoryFilter;

    return matchesSearch && matchesDate && matchesCategory;
  });

  const totalRevenue = filtered.reduce((sum, r) => sum + Number(r.total_amount || 0), 0);

  const activeFilterCount = [dateFrom, dateTo].filter(Boolean).length + (categoryFilter !== "all" ? 1 : 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShoppingCart className="h-6 w-6" /> Sales History
        </h1>
        <div className="text-sm text-muted-foreground">
          Total: <span className="font-mono font-bold text-foreground">{totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by item, client, notes..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
          </div>
          <Button
            type="button"
            variant={showFilters || activeFilterCount > 0 ? "default" : "outline"}
            size="icon"
            onClick={() => setShowFilters((s) => !s)}
            className="relative"
          >
            <Filter className="h-4 w-4" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] text-white font-bold">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </div>

        {showFilters && (
          <div className="rounded-lg border bg-card p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Filters</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => { setDateFrom(""); setDateTo(""); setCategoryFilter("all"); }}
                className="h-7 text-xs"
              >
                <X className="h-3 w-3 mr-1" /> Clear
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">From Date</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">To Date</Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Category</Label>
                <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="raw_material">Raw Material</SelectItem>
                    <SelectItem value="finished_product">Finished Product</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{filtered.length} sale{filtered.length !== 1 ? "s" : ""}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Client</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Price/unit</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No sales yet</TableCell></TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{format(new Date(r.date), "dd/MM/yy")}</TableCell>
                    <TableCell>
                      <Badge variant={r.item_type === "raw_material" ? "secondary" : "default"}>
                        {r.item_type === "raw_material" ? "Raw" : "Product"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">
                      {r.item_name ?? "—"}
                      {r.thickness_mm ? <span className="text-xs text-muted-foreground ml-1">({r.thickness_mm}mm)</span> : null}
                    </TableCell>
                    <TableCell>{r.client_name ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">{Number(r.quantity).toLocaleString()} {r.unit}</TableCell>
                    <TableCell className="text-right font-mono">{Number(r.price_per_unit).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{Number(r.total_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{r.notes ?? "—"}</TableCell>
                    <TableCell className="text-center">
                      {canModify(r) && (
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteRow(r)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}{/* end map */}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={(open) => { setEditDialogOpen(open); if (!open) setEditRow(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Sale</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Quantity</Label>
              <Input type="number" min="0" step="0.01" value={editForm.quantity} onChange={(e) => setEditForm(f => ({ ...f, quantity: e.target.value }))} />
            </div>
            <div>
              <Label>Price per unit</Label>
              <Input type="number" min="0" step="0.01" value={editForm.price_per_unit} onChange={(e) => setEditForm(f => ({ ...f, price_per_unit: e.target.value }))} />
            </div>
            <div>
              <Label>Thickness (mm, optional)</Label>
              <Input type="number" min="0" step="0.001" value={editForm.thickness_mm} onChange={(e) => setEditForm(f => ({ ...f, thickness_mm: e.target.value }))} />
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={editForm.notes} onChange={(e) => setEditForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <Button onClick={handleEditSave} className="w-full bg-secondary hover:bg-secondary/90">Save Changes</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteRow} onOpenChange={(open) => { if (!open) setDeleteRow(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Sale</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this sale record ({deleteRow?.item_name ?? "item"} — {deleteRow?.client_name ?? "client"})? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
