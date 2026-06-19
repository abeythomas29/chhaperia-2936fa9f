import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { History, Pencil, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface StockEntry {
  id: string;
  raw_material_id: string;
  quantity: number;
  date: string;
  lot_number: string | null;
  supplier: string | null;
  pallets: number | null;
  thickness_mm: number | null;
  gsm: number | null;
  notes: string | null;
  created_at: string;
  material_name?: string;
  material_unit?: string;
}

interface EditForm {
  date: string;
  quantity: string;
  pallets: string;
  thickness_mm: string;
  gsm: string;
  lot_number: string;
  supplier: string;
  notes: string;
}

const toForm = (e: StockEntry): EditForm => ({
  date: e.date,
  quantity: String(e.quantity ?? ""),
  pallets: e.pallets != null ? String(e.pallets) : "",
  thickness_mm: e.thickness_mm != null ? String(e.thickness_mm) : "",
  gsm: e.gsm != null ? String(e.gsm) : "",
  lot_number: e.lot_number ?? "",
  supplier: e.supplier ?? "",
  notes: e.notes ?? "",
});

export default function InwardHistory() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<StockEntry[]>([]);
  const [editing, setEditing] = useState<StockEntry | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!user) return;
    const { data: stockData } = await supabase
      .from("raw_material_stock_entries")
      .select("*")
      .eq("added_by", user.id)
      .order("created_at", { ascending: false })
      .limit(100);

    const materialIds = [...new Set((stockData ?? []).map((e: StockEntry) => e.raw_material_id))];
    let materialMap = new Map<string, { name: string; unit: string }>();
    if (materialIds.length > 0) {
      const { data: mats } = await supabase.from("raw_materials").select("id, name, unit").in("id", materialIds);
      materialMap = new Map((mats ?? []).map((m: { id: string; name: string; unit: string }) => [m.id, m]));
    }

    setEntries((stockData ?? []).map((e: StockEntry) => ({
      ...e,
      material_name: materialMap.get(e.raw_material_id)?.name ?? "Unknown",
      material_unit: materialMap.get(e.raw_material_id)?.unit ?? "",
    })));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const openEdit = (e: StockEntry) => {
    setEditing(e);
    setEditForm(toForm(e));
  };

  const saveEdit = async () => {
    if (!editing || !editForm) return;
    const qty = parseFloat(editForm.quantity);
    if (!editForm.date || isNaN(qty) || qty <= 0) {
      toast.error("Date and a positive quantity are required");
      return;
    }
    setSaving(true);
    const payload = {
      date: editForm.date,
      quantity: qty,
      pallets: editForm.pallets ? parseInt(editForm.pallets) : null,
      thickness_mm: editForm.thickness_mm ? parseFloat(editForm.thickness_mm) : null,
      gsm: editForm.gsm ? parseFloat(editForm.gsm) : null,
      lot_number: editForm.lot_number.trim() || null,
      supplier: editForm.supplier.trim() || null,
      notes: editForm.notes.trim() || null,
    };
    const { error } = await supabase.from("raw_material_stock_entries").update(payload).eq("id", editing.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Entry updated");
    setEditing(null);
    setEditForm(null);
    await load();
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    const idToDelete = deleteId;
    setDeleteId(null);
    const { error } = await supabase.from("raw_material_stock_entries").delete().eq("id", idToDelete);
    if (error) {
      toast.error(error.message);
      return;
    }
    // Optimistically remove from UI so it disappears immediately
    setEntries((prev) => prev.filter((e) => e.id !== idToDelete));
    toast.success("Entry deleted");
    await load();
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">My Inward History</h1>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Recent Entries ({entries.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Material</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Pallets</TableHead>
                <TableHead className="text-right">Thickness</TableHead>
                <TableHead className="text-right">GSM</TableHead>
                <TableHead>Lot No.</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 ? (
                <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">No entries yet</TableCell></TableRow>
              ) : entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{format(new Date(e.date), "dd/MM/yy")}</TableCell>
                  <TableCell className="font-medium">{e.material_name}</TableCell>
                  <TableCell>{e.supplier ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{e.quantity.toLocaleString()}</TableCell>
                  <TableCell>{e.material_unit}</TableCell>
                  <TableCell className="text-right font-mono">{e.pallets ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{e.thickness_mm != null ? `${e.thickness_mm} mm` : "—"}</TableCell>
                  <TableCell className="text-right font-mono">{e.gsm != null ? `${e.gsm}` : "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{e.lot_number ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{e.notes ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(e)} aria-label="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setDeleteId(e.id)} aria-label="Delete">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) { setEditing(null); setEditForm(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Stock Entry</DialogTitle></DialogHeader>
          {editForm && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Date</Label>
                <Input type="date" value={editForm.date} onChange={(e) => setEditForm({ ...editForm, date: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Quantity</Label>
                <Input type="number" step="0.01" value={editForm.quantity} onChange={(e) => setEditForm({ ...editForm, quantity: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Pallets</Label>
                <Input type="number" value={editForm.pallets} onChange={(e) => setEditForm({ ...editForm, pallets: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Thickness (mm)</Label>
                <Input type="number" step="0.01" value={editForm.thickness_mm} onChange={(e) => setEditForm({ ...editForm, thickness_mm: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>GSM</Label>
                <Input type="number" step="0.01" value={editForm.gsm} onChange={(e) => setEditForm({ ...editForm, gsm: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Lot No.</Label>
                <Input value={editForm.lot_number} onChange={(e) => setEditForm({ ...editForm, lot_number: e.target.value })} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label>Supplier</Label>
                <Input value={editForm.supplier} onChange={(e) => setEditForm({ ...editForm, supplier: e.target.value })} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label>Notes</Label>
                <Textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditing(null); setEditForm(null); }}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove the stock entry and adjust raw material stock accordingly.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
