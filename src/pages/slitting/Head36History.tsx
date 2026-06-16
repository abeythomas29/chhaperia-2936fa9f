import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Layers, Pencil, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

interface Head36Row {
  id: string;
  date: string;
  product_code_id: string | null;
  rolls_taken: number;
  rolls_produced: number;
  roll_width_mm: number | null;
  length_per_tape_mtr: number | null;
  thickness_mm: number | null;
  gsm: number | null;
  total_quantity: number | null;
  unit: string;
  notes: string | null;
  operator_id: string | null;
  slitting_entry_id: string | null;
  slitting_entries?: {
    cut_width_mm: number | null;
    slitting_manager_id?: string | null;
    product_code_id?: string | null;
    product_codes?: { code: string } | null;
  } | null;
}

interface SlittingLookupRow {
  id: string;
  cut_width_mm: number | null;
  slitting_manager_id: string | null;
  product_code_id: string | null;
}

interface ProductLookupRow {
  id: string;
  code: string;
}

interface EditForm {
  date: string;
  rolls_taken: string;
  rolls_produced: string;
  roll_width_mm: string;
  length_per_tape_mtr: string;
  notes: string;
}

const toForm = (r: Head36Row): EditForm => ({
  date: r.date,
  rolls_taken: String(r.rolls_taken ?? ""),
  rolls_produced: String(r.rolls_produced ?? ""),
  roll_width_mm: r.roll_width_mm == null ? "" : String(r.roll_width_mm),
  length_per_tape_mtr: r.length_per_tape_mtr == null ? "" : String(r.length_per_tape_mtr),
  notes: r.notes ?? "",
});

export default function Head36History() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Head36Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Head36Row | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("head36_entries")
      .select(
        "id, date, product_code_id, rolls_taken, rolls_produced, roll_width_mm, length_per_tape_mtr, thickness_mm, gsm, total_quantity, unit, notes, slitting_entry_id, operator_id"
      )
      .order("date", { ascending: false });
    let list = (data as Head36Row[] | null) ?? [];
    const slittingIds = Array.from(new Set(list.map((r) => r.slitting_entry_id).filter(Boolean))) as string[];
    const directProductIds = Array.from(new Set(list.map((r) => r.product_code_id).filter(Boolean))) as string[];
    let slittingById: Record<string, { cut_width_mm: number | null; slitting_manager_id: string | null; product_code_id: string | null }> = {};
    if (slittingIds.length > 0) {
      const { data: slittingRows } = await supabase
        .from("slitting_entries")
        .select("id, cut_width_mm, slitting_manager_id, product_code_id")
        .in("id", slittingIds);
      slittingById = Object.fromEntries(
        (((slittingRows as SlittingLookupRow[] | null) ?? []).map((s) => [s.id, s]))
      );
    }
    const productIds = Array.from(new Set([
      ...directProductIds,
      ...Object.values(slittingById).map((s) => s.product_code_id).filter(Boolean),
    ])) as string[];
    let productById: Record<string, { code: string }> = {};
    if (productIds.length > 0) {
      const { data: products } = await supabase
        .from("product_codes")
        .select("id, code")
        .in("id", productIds);
      productById = Object.fromEntries((((products as ProductLookupRow[] | null) ?? []).map((p) => [p.id, { code: p.code }])));
    }
    list = list.map((r) => {
      const linkedSlitting = r.slitting_entry_id ? slittingById[r.slitting_entry_id] : null;
      const productId = r.product_code_id ?? linkedSlitting?.product_code_id ?? null;
      return {
        ...r,
        slitting_entries: linkedSlitting ? {
          ...linkedSlitting,
          product_codes: productId ? productById[productId] ?? null : null,
        } : {
          cut_width_mm: null,
          product_codes: productId ? productById[productId] ?? null : null,
        },
      };
    });
    list = list.filter((r) =>
      r.operator_id === user.id ||
      r.slitting_entries?.slitting_manager_id === user.id ||
      (!r.operator_id && !r.slitting_entries?.slitting_manager_id)
    );
    if (!error) setRows(list);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const openEdit = (r: Head36Row) => {
    setEditing(r);
    setEditForm(toForm(r));
  };

  const saveEdit = async () => {
    if (!editing || !editForm) return;
    setSaving(true);
    const payload: Record<string, unknown> = {
      date: editForm.date,
      rolls_taken: Number(editForm.rolls_taken) || 0,
      rolls_produced: Number(editForm.rolls_produced) || 0,
      roll_width_mm: editForm.roll_width_mm === "" ? null : Number(editForm.roll_width_mm),
      length_per_tape_mtr: editForm.length_per_tape_mtr === "" ? null : Number(editForm.length_per_tape_mtr),
      notes: editForm.notes || null,
    };
    const { error } = await supabase.from("head36_entries").update(payload).eq("id", editing.id);
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
    const { error } = await supabase.from("head36_entries").delete().eq("id", deleteId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Entry deleted");
    setDeleteId(null);
    await load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            My 36 Head History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-center py-6">No 36 Head production entries yet.</p>
          ) : (
            <>
              {/* Desktop / tablet table */}
              <div className="hidden md:block w-full overflow-x-auto">
                <Table className="text-xs sm:text-sm">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Cut Width</TableHead>
                      <TableHead className="text-right">Rolls Taken</TableHead>
                      <TableHead className="text-right">Rolls Produced</TableHead>
                      <TableHead className="text-right">Width (mm)</TableHead>
                      <TableHead className="text-right">Length/Tape</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((h) => {
                      const total = h.total_quantity ?? ((h.length_per_tape_mtr ?? 0) * (h.rolls_produced ?? 0));
                      const canManage = h.operator_id === user?.id;
                      return (
                        <TableRow key={h.id}>
                          <TableCell>{format(new Date(h.date), "dd/MM/yy")}</TableCell>
                          <TableCell className="font-medium">{h.slitting_entries?.product_codes?.code ?? "—"}</TableCell>
                          <TableCell className="text-right">{h.slitting_entries?.cut_width_mm ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono">{h.rolls_taken}</TableCell>
                          <TableCell className="text-right font-mono">{h.rolls_produced}</TableCell>
                          <TableCell className="text-right font-mono">{h.roll_width_mm ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono">{h.length_per_tape_mtr ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono">{total} {h.unit}</TableCell>
                          <TableCell className="text-muted-foreground text-xs max-w-[200px] truncate">{h.notes ?? "—"}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                disabled={!canManage}
                                onClick={() => openEdit(h)}
                                aria-label="Edit entry"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                disabled={!canManage}
                                onClick={() => setDeleteId(h.id)}
                                aria-label="Delete entry"
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden space-y-3">
                {rows.map((h) => {
                  const total = h.total_quantity ?? ((h.length_per_tape_mtr ?? 0) * (h.rolls_produced ?? 0));
                  const canManage = h.operator_id === user?.id;
                  return (
                    <div key={h.id} className="border rounded-lg p-3 bg-card">
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-medium text-sm">{h.slitting_entries?.product_codes?.code ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{format(new Date(h.date), "dd/MM/yy")}</div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div><div className="text-muted-foreground">Rolls Taken</div><div className="font-mono">{h.rolls_taken}</div></div>
                        <div><div className="text-muted-foreground">Produced</div><div className="font-mono">{h.rolls_produced}</div></div>
                        <div><div className="text-muted-foreground">Cut Width</div><div className="font-mono">{h.slitting_entries?.cut_width_mm ?? "—"}</div></div>
                        <div><div className="text-muted-foreground">Width (mm)</div><div className="font-mono">{h.roll_width_mm ?? "—"}</div></div>
                        <div><div className="text-muted-foreground">Len/Tape</div><div className="font-mono">{h.length_per_tape_mtr ?? "—"}</div></div>
                        <div><div className="text-muted-foreground">Total</div><div className="font-mono">{total} {h.unit}</div></div>
                      </div>
                      {h.notes && (
                        <div className="mt-2 text-xs text-muted-foreground border-t pt-2">{h.notes}</div>
                      )}
                      <div className="flex justify-end gap-2 mt-3 pt-2 border-t">
                        <Button size="sm" variant="outline" disabled={!canManage} onClick={() => openEdit(h)}>
                          <Pencil className="h-3 w-3 mr-1" /> Edit
                        </Button>
                        <Button size="sm" variant="outline" disabled={!canManage} onClick={() => setDeleteId(h.id)}>
                          <Trash2 className="h-3 w-3 mr-1 text-destructive" /> Delete
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) { setEditing(null); setEditForm(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit 36 Head Entry</DialogTitle>
          </DialogHeader>
          {editForm && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="edit-date">Date</Label>
                <Input id="edit-date" type="date" value={editForm.date} onChange={(e) => setEditForm({ ...editForm, date: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="edit-taken">Rolls Taken</Label>
                  <Input id="edit-taken" type="number" value={editForm.rolls_taken} onChange={(e) => setEditForm({ ...editForm, rolls_taken: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="edit-prod">Rolls Produced</Label>
                  <Input id="edit-prod" type="number" value={editForm.rolls_produced} onChange={(e) => setEditForm({ ...editForm, rolls_produced: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="edit-width">Width (mm)</Label>
                  <Input id="edit-width" type="number" value={editForm.roll_width_mm} onChange={(e) => setEditForm({ ...editForm, roll_width_mm: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="edit-len">Length / Tape</Label>
                  <Input id="edit-len" type="number" value={editForm.length_per_tape_mtr} onChange={(e) => setEditForm({ ...editForm, length_per_tape_mtr: e.target.value })} />
                </div>
              </div>
              <div>
                <Label htmlFor="edit-notes">Notes</Label>
                <Textarea id="edit-notes" value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditing(null); setEditForm(null); }}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the 36 Head production entry. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
