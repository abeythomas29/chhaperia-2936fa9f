import { Fragment, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Package, ArrowDownToLine, Search, Pencil, Trash2, ChevronRight, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

interface RawMaterial {
  id: string;
  name: string;
  unit: string;
  current_stock: number;
  status: string;
}

interface StockEntry {
  id: string;
  raw_material_id: string;
  quantity: number;
  date: string;
  lot_number: string | null;
  supplier: string | null;
  pallets: number | null;
  thickness_mm: number | null;
  notes: string | null;
  added_by: string;
  created_at: string;
  kind?: "in" | "out";
}


export default function RawMaterials() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [stockEntries, setStockEntries] = useState<(StockEntry & { material_name?: string; material_unit?: string; person_name?: string })[]>([]);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [stockOpen, setStockOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [expandedMaterials, setExpandedMaterials] = useState<Set<string>>(new Set());

  const [newName, setNewName] = useState("");
  const [newUnit, setNewUnit] = useState("kg");

  const [editMaterial, setEditMaterial] = useState<RawMaterial | null>(null);
  const [editName, setEditName] = useState("");
  const [editUnit, setEditUnit] = useState("");

  // Stock entry edit/delete state
  const [editEntryOpen, setEditEntryOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<StockEntry | null>(null);
  const [eMaterialId, setEMaterialId] = useState("");
  const [eQty, setEQty] = useState("");
  const [eDate, setEDate] = useState("");
  const [eLot, setELot] = useState("");
  const [eSupplier, setESupplier] = useState("");
  const [ePallets, setEPallets] = useState("");
  const [eThickness, setEThickness] = useState("");
  const [eNotes, setENotes] = useState("");
  const [deleteEntryId, setDeleteEntryId] = useState<string | null>(null);

  const [stockMaterialId, setStockMaterialId] = useState("");
  const [stockQty, setStockQty] = useState("");
  const [stockDate, setStockDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [stockLot, setStockLot] = useState("");
  const [stockSupplier, setStockSupplier] = useState("");
  const [stockPallets, setStockPallets] = useState("");
  const [stockThickness, setStockThickness] = useState("");
  const [stockNotes, setStockNotes] = useState("");

  const fetchData = async () => {
    const [matRes, entryRes, saleRes] = await Promise.all([
      supabase.from("raw_materials").select("*").order("name"),
      supabase.from("raw_material_stock_entries").select("*").order("created_at", { ascending: false }).limit(2000),
      supabase
        .from("sales")
        .select("id, raw_material_id, quantity, date, notes, thickness_mm, sold_by, client_name, client_id, created_at")
        .eq("item_type", "raw_material")
        .order("created_at", { ascending: false })
        .limit(2000),
    ]);
    setMaterials(matRes.data ?? []);

    const inwardEntries = (entryRes.data ?? []) as StockEntry[];
    const salesRows = (saleRes.data ?? []) as any[];

    // Resolve client names for sales (some sales reference company_clients by id)
    const clientIds = [...new Set(salesRows.map((s) => s.client_id).filter(Boolean))];
    let clientMap = new Map<string, string>();
    if (clientIds.length > 0) {
      const { data: clients } = await supabase.from("company_clients").select("id, name").in("id", clientIds);
      clientMap = new Map((clients ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));
    }

    const outwardEntries: StockEntry[] = salesRows
      .filter((s) => s.raw_material_id)
      .map((s) => ({
        id: `sale-${s.id}`,
        raw_material_id: s.raw_material_id,
        quantity: Number(s.quantity) || 0,
        date: s.date,
        lot_number: null,
        supplier: clientMap.get(s.client_id) ?? s.client_name ?? null,
        pallets: null,
        thickness_mm: s.thickness_mm,
        notes: s.notes ? `Sale: ${s.notes}` : "Sale",
        added_by: s.sold_by,
        created_at: s.created_at,
        kind: "out",
      }));

    const allEntries = [...inwardEntries.map((e) => ({ ...e, kind: "in" as const })), ...outwardEntries]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // Resolve names
    const materialMap = new Map((matRes.data ?? []).map((m: RawMaterial) => [m.id, m]));
    const userIds = [...new Set(allEntries.map((e) => e.added_by).filter(Boolean))];
    let profileMap = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await supabase.from("profiles").select("user_id, name").in("user_id", userIds);
      profileMap = new Map((profiles ?? []).map((p: { user_id: string; name: string }) => [p.user_id, p.name]));
    }
    setStockEntries(allEntries.map((e) => ({
      ...e,
      material_name: materialMap.get(e.raw_material_id)?.name ?? "Unknown",
      material_unit: materialMap.get(e.raw_material_id)?.unit ?? "",
      person_name: profileMap.get(e.added_by) ?? "Unknown",
    })));
  };


  useEffect(() => { fetchData(); }, []);

  const q = search.trim().toLowerCase();
  const filtered = materials.filter((m) => m.name.toLowerCase().includes(q));

  const filteredEntries = stockEntries.filter((e) => {
    if (dateFrom && e.date < dateFrom) return false;
    if (dateTo && e.date > dateTo) return false;
    if (!q) return true;
    return (
      (e.material_name ?? "").toLowerCase().includes(q) ||
      (e.supplier ?? "").toLowerCase().includes(q) ||
      (e.lot_number ?? "").toLowerCase().includes(q) ||
      (e.notes ?? "").toLowerCase().includes(q) ||
      (e.person_name ?? "").toLowerCase().includes(q)
    );
  });

  const addMaterial = async () => {
    if (!newName.trim()) return;
    const { error } = await supabase.from("raw_materials").insert({ name: newName.trim(), unit: newUnit });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Raw material added" });
    setAddOpen(false);
    setNewName("");
    setNewUnit("kg");
    fetchData();
  };

  const saveEdit = async () => {
    if (!editMaterial || !editName.trim()) return;
    const { error } = await supabase.from("raw_materials").update({ name: editName.trim(), unit: editUnit }).eq("id", editMaterial.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Updated" });
    setEditOpen(false);
    setEditMaterial(null);
    fetchData();
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    // Check dependencies
    const { count } = await supabase.from("product_recipes").select("id", { count: "exact", head: true }).eq("raw_material_id", deleteId);
    if ((count ?? 0) > 0) {
      toast({ title: "Cannot delete", description: "This material is used in product recipes.", variant: "destructive" });
      setDeleteId(null);
      return;
    }
    const { error } = await supabase.from("raw_materials").delete().eq("id", deleteId);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Deleted" });
    setDeleteId(null);
    fetchData();
  };

  const addStockEntry = async () => {
    if (!stockMaterialId || !stockQty || !user) return;
    const { error } = await supabase.from("raw_material_stock_entries").insert({
      raw_material_id: stockMaterialId,
      quantity: Number(stockQty),
      date: stockDate,
      lot_number: stockLot.trim() || null,
      supplier: stockSupplier.trim() || null,
      pallets: stockPallets ? Number(stockPallets) : null,
      thickness_mm: stockThickness ? Number(stockThickness) : null,
      notes: stockNotes || null,
      added_by: user.id,
    } as any);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Stock added" });
    setStockOpen(false);
    setStockMaterialId("");
    setStockQty("");
    setStockLot("");
    setStockSupplier("");
    setStockPallets("");
    setStockThickness("");
    setStockNotes("");
    fetchData();
  };

  const openEdit = (m: RawMaterial) => {
    setEditMaterial(m);
    setEditName(m.name);
    setEditUnit(m.unit);
    setEditOpen(true);
  };

  const openEditEntry = (e: StockEntry) => {
    setEditEntry(e);
    setEMaterialId(e.raw_material_id);
    setEQty(String(e.quantity));
    setEDate(e.date);
    setELot(e.lot_number ?? "");
    setESupplier(e.supplier ?? "");
    setEPallets(e.pallets != null ? String(e.pallets) : "");
    setEThickness(e.thickness_mm != null ? String(e.thickness_mm) : "");
    setENotes(e.notes ?? "");
    setEditEntryOpen(true);
  };

  const saveEntryEdit = async () => {
    if (!editEntry || !eMaterialId || !eQty) return;
    const { error } = await supabase.from("raw_material_stock_entries").update({
      raw_material_id: eMaterialId,
      quantity: Number(eQty),
      date: eDate,
      lot_number: eLot.trim() || null,
      supplier: eSupplier.trim() || null,
      pallets: ePallets ? Number(ePallets) : null,
      thickness_mm: eThickness ? Number(eThickness) : null,
      notes: eNotes || null,
    } as any).eq("id", editEntry.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Stock entry updated" });
    setEditEntryOpen(false);
    setEditEntry(null);
    fetchData();
  };

  const confirmDeleteEntry = async () => {
    if (!deleteEntryId) return;
    const { error } = await supabase.from("raw_material_stock_entries").delete().eq("id", deleteEntryId);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Stock entry deleted" });
    setDeleteEntryId(null);
    fetchData();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Raw Materials</h1>
        <div className="flex gap-2">
          <Dialog open={stockOpen} onOpenChange={setStockOpen}>
            <DialogTrigger asChild>
              <Button variant="outline"><ArrowDownToLine className="h-4 w-4 mr-2" />Add Stock</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Stock (Purchase)</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Raw Material</Label>
                  <Select value={stockMaterialId} onValueChange={setStockMaterialId}>
                    <SelectTrigger><SelectValue placeholder="Select material" /></SelectTrigger>
                    <SelectContent>{materials.filter(m => m.status === "active").map((m) => <SelectItem key={m.id} value={m.id}>{m.name} ({m.unit})</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Quantity ({materials.find(m => m.id === stockMaterialId)?.unit ?? 'kg'})</Label>
                  <Input type="number" min="0" step="0.01" value={stockQty} onChange={(e) => setStockQty(e.target.value)} placeholder="0" />
                </div>
                <div>
                  <Label>Date</Label>
                  <Input type="date" value={stockDate} onChange={(e) => setStockDate(e.target.value)} />
                </div>
                <div>
                  <Label>Lot Number</Label>
                  <Input value={stockLot} onChange={(e) => setStockLot(e.target.value)} placeholder="e.g. LOT-2025-001" />
                </div>
                <div>
                  <Label>Supplier / From</Label>
                  <Input value={stockSupplier} onChange={(e) => setStockSupplier(e.target.value)} placeholder="e.g. Combined Origins Ltd" />
                </div>
                <div>
                  <Label>Pallets / Pieces</Label>
                  <Input type="number" min="0" step="1" value={stockPallets} onChange={(e) => setStockPallets(e.target.value)} placeholder="e.g. 29" />
                </div>
                <div>
                  <Label>Thickness (mm, optional)</Label>
                  <Input type="number" min="0" step="0.001" value={stockThickness} onChange={(e) => setStockThickness(e.target.value)} placeholder="e.g. 0.13" />
                </div>
                <div>
                  <Label>Notes (optional)</Label>
                  <Input value={stockNotes} onChange={(e) => setStockNotes(e.target.value)} placeholder="e.g. invoice #" />
                </div>
                <Button onClick={addStockEntry} className="w-full bg-secondary hover:bg-secondary/90">Add Stock</Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button className="bg-secondary hover:bg-secondary/90"><Plus className="h-4 w-4 mr-2" />Add Material</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Raw Material</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div><Label>Name</Label><Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. ALUMINIUM FOIL 009MIC" /></div>
                <div>
                  <Label>Unit</Label>
                  <Select value={newUnit} onValueChange={setNewUnit}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="kg">Kilograms (kg)</SelectItem>
                      <SelectItem value="meters">Meters</SelectItem>
                      <SelectItem value="rolls">Rolls</SelectItem>
                      <SelectItem value="pieces">Pieces</SelectItem>
                      <SelectItem value="liters">Liters</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={addMaterial} className="w-full bg-secondary hover:bg-secondary/90">Add</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by material, supplier, lot, notes…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">From</Label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-[150px]" />
          <Label className="text-xs text-muted-foreground whitespace-nowrap">To</Label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-[150px]" />
          {(dateFrom || dateTo || search) && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setDateFrom(""); setDateTo(""); }}>Clear</Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Package className="h-5 w-5" />Inventory ({filtered.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Current Stock</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No raw materials found</TableCell></TableRow>
              ) : filtered.map((m) => {
                const isExpanded = expandedMaterials.has(m.id);
                // Build variants by thickness from stockEntries (all, not filtered by search/date)
                const matEntries = stockEntries.filter((e) => e.raw_material_id === m.id);
                const variantMap = new Map<string, { in: number; out: number }>();
                matEntries.forEach((e) => {
                  const key = e.thickness_mm != null ? `${e.thickness_mm} mm` : "No thickness";
                  const v = variantMap.get(key) ?? { in: 0, out: 0 };
                  if (e.kind === "out") v.out += Number(e.quantity) || 0;
                  else v.in += Number(e.quantity) || 0;
                  variantMap.set(key, v);
                });
                const variants = Array.from(variantMap.entries())
                  .map(([label, v]) => ({ label, in: v.in, out: v.out, net: v.in - v.out }))
                  .sort((a, b) => {
                    const an = parseFloat(a.label); const bn = parseFloat(b.label);
                    if (isNaN(an) && isNaN(bn)) return a.label.localeCompare(b.label);
                    if (isNaN(an)) return 1;
                    if (isNaN(bn)) return -1;
                    return an - bn;
                  });
                const toggle = () => {
                  setExpandedMaterials((prev) => {
                    const next = new Set(prev);
                    if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
                    return next;
                  });
                };
                return (
                  <Fragment key={m.id}>
                    <TableRow key={m.id} className="cursor-pointer hover:bg-muted/50" onClick={toggle}>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(ev) => { ev.stopPropagation(); toggle(); }}>
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                      <TableCell className="font-medium">{m.name}</TableCell>
                      <TableCell>{m.unit}</TableCell>
                      <TableCell className="text-right font-mono">{m.current_stock.toLocaleString()} {m.unit}</TableCell>
                      <TableCell><Badge variant={m.status === "active" ? "default" : "secondary"}>{m.status}</Badge></TableCell>
                      <TableCell className="text-right" onClick={(ev) => ev.stopPropagation()}>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(m)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteId(m.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow key={`${m.id}-variants`} className="bg-muted/30 hover:bg-muted/30">
                        <TableCell></TableCell>
                        <TableCell colSpan={5}>
                          {variants.length === 0 ? (
                            <div className="text-sm text-muted-foreground py-2">No variant data yet — add stock entries with thickness to see breakdown.</div>
                          ) : (
                            <div className="py-2">
                              <div className="text-xs font-semibold text-muted-foreground mb-2">Variants by Thickness</div>
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Thickness</TableHead>
                                    <TableHead className="text-right">In</TableHead>
                                    <TableHead className="text-right">Out</TableHead>
                                    <TableHead className="text-right">Balance</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {variants.map((v) => (
                                    <TableRow key={v.label}>
                                      <TableCell className="font-medium">{v.label}</TableCell>
                                      <TableCell className="text-right font-mono text-secondary">+{v.in.toLocaleString()} {m.unit}</TableCell>
                                      <TableCell className="text-right font-mono text-destructive">−{v.out.toLocaleString()} {m.unit}</TableCell>
                                      <TableCell className="text-right font-mono font-semibold">{v.net.toLocaleString()} {m.unit}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent Stock Entries ({filteredEntries.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Material</TableHead>
                <TableHead>Supplier / Client</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Pallets</TableHead>
                <TableHead className="text-right">Thickness</TableHead>
                <TableHead>Lot No.</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>By</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEntries.length === 0 ? (
                <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-8">No stock entries match your filters</TableCell></TableRow>
              ) : filteredEntries.map((e) => {
                const isOut = e.kind === "out";
                return (
                <TableRow key={e.id}>
                  <TableCell>{format(new Date(e.date), "dd/MM/yy")}</TableCell>
                  <TableCell>
                    <Badge variant={isOut ? "destructive" : "default"}>{isOut ? "Out (Sale)" : "In"}</Badge>
                  </TableCell>
                  <TableCell>{e.material_name}</TableCell>
                  <TableCell>{e.supplier ?? "—"}</TableCell>
                  <TableCell className={`text-right font-mono ${isOut ? "text-destructive" : ""}`}>
                    {isOut ? "−" : "+"}{Number(e.quantity).toLocaleString()} {e.material_unit}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{e.material_unit}</TableCell>
                  <TableCell className="text-right font-mono">{e.pallets ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{e.thickness_mm != null ? `${e.thickness_mm} mm` : "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{e.lot_number ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{e.notes ?? "—"}</TableCell>
                  <TableCell>{e.person_name}</TableCell>
                  <TableCell className="text-right">
                    {isOut ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <>
                        <Button variant="ghost" size="icon" onClick={() => openEditEntry(e)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteEntryId(e.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
                );
              })}

            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Raw Material</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Name</Label><Input value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
            <div>
              <Label>Unit</Label>
              <Select value={editUnit} onValueChange={setEditUnit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="kg">Kilograms (kg)</SelectItem>
                  <SelectItem value="meters">Meters</SelectItem>
                  <SelectItem value="rolls">Rolls</SelectItem>
                  <SelectItem value="pieces">Pieces</SelectItem>
                  <SelectItem value="liters">Liters</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={saveEdit} className="w-full bg-secondary hover:bg-secondary/90">Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Raw Material?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Stock Entry Dialog */}
      <Dialog open={editEntryOpen} onOpenChange={setEditEntryOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Stock Entry</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Raw Material</Label>
              <Select value={eMaterialId} onValueChange={setEMaterialId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{materials.map((m) => <SelectItem key={m.id} value={m.id}>{m.name} ({m.unit})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Quantity</Label><Input type="number" min="0" step="0.01" value={eQty} onChange={(e) => setEQty(e.target.value)} /></div>
            <div><Label>Date</Label><Input type="date" value={eDate} onChange={(e) => setEDate(e.target.value)} /></div>
            <div><Label>Lot Number</Label><Input value={eLot} onChange={(e) => setELot(e.target.value)} /></div>
            <div><Label>Supplier / From</Label><Input value={eSupplier} onChange={(e) => setESupplier(e.target.value)} /></div>
            <div><Label>Pallets / Pieces</Label><Input type="number" min="0" step="1" value={ePallets} onChange={(e) => setEPallets(e.target.value)} /></div>
            <div><Label>Thickness (mm)</Label><Input type="number" min="0" step="0.001" value={eThickness} onChange={(e) => setEThickness(e.target.value)} /></div>
            <div><Label>Notes</Label><Input value={eNotes} onChange={(e) => setENotes(e.target.value)} /></div>
            <Button onClick={saveEntryEdit} className="w-full bg-secondary hover:bg-secondary/90">Save Changes</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Stock Entry Confirm */}
      <AlertDialog open={!!deleteEntryId} onOpenChange={(open) => !open && setDeleteEntryId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Stock Entry?</AlertDialogTitle>
            <AlertDialogDescription>This will remove the inward record. The raw material's current stock will not be auto-adjusted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteEntry} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
