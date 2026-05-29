import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, History, Pencil, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { format } from "date-fns";

interface Head36Row {
  id: string;
  date: string;
  rolls_taken: number;
  rolls_produced: number;
  roll_width_mm: number | null;
  length_per_tape_mtr: number | null;
  total_quantity: number | null;
  unit: string;
  notes: string | null;
}

interface SlittingRow {
  id: string;
  date: string;
  source_quantity: number;
  cut_quantity_produced: number;
  cut_width_mm: number;
  remaining_returned: number;
  thickness_mm: number | null;
  gsm: number | null;
  unit: string;
  notes: string | null;
  product_codes: { code: string } | null;
}

const parseGsm = (notes: string | null): number => {
  if (!notes) return 0;
  const m = notes.match(/GSM\s*[:\-]*\s*([\d.]+)/i);
  return m ? parseFloat(m[1]) : 0;
};

const computeTotals = (r: SlittingRow) => {
  const lengthMtr = r.cut_quantity_produced || 0;
  const sqm = (r.cut_width_mm / 1000) * lengthMtr;
  const gsm = r.gsm ?? parseGsm(r.notes);
  const kg = gsm > 0 ? (sqm * gsm) / 1000 : 0;
  return { lengthMtr, sqm, kg };
};

export default function SlittingHistory() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [entries, setEntries] = useState<SlittingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editEntry, setEditEntry] = useState<SlittingRow | null>(null);
  const [editForm, setEditForm] = useState({
    date: "", cut_width_mm: "", cut_quantity_produced: "",
    thickness_mm: "", gsm: "", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [head36Map, setHead36Map] = useState<Record<string, Head36Row[]>>({});
  const [loadingHead36, setLoadingHead36] = useState<string | null>(null);

  const toggleExpand = async (entryId: string) => {
    if (expandedId === entryId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(entryId);
    if (!head36Map[entryId]) {
      setLoadingHead36(entryId);
      const { data } = await supabase
        .from("head36_entries" as any)
        .select("id, date, rolls_taken, rolls_produced, roll_width_mm, length_per_tape_mtr, total_quantity, unit, notes")
        .eq("slitting_entry_id", entryId)
        .order("date", { ascending: false });
      setHead36Map((m) => ({ ...m, [entryId]: ((data as unknown) as Head36Row[]) ?? [] }));
      setLoadingHead36(null);
    }
  };

  const fetchEntries = async () => {
    if (!user) return;
    setLoading(true);
    const fullSelect = "id, date, source_quantity, cut_quantity_produced, cut_width_mm, remaining_returned, thickness_mm, gsm, unit, notes, product_codes(code)";
    const basicSelect = "id, date, source_quantity, cut_quantity_produced, cut_width_mm, remaining_returned, thickness_mm, unit, notes, product_codes(code)";

    let { data, error } = await supabase
      .from("slitting_entries")
      .select(fullSelect)
      .eq("slitting_manager_id", user.id)
      .order("date", { ascending: false });

    if (error) {
      const fallback = await supabase
        .from("slitting_entries")
        .select(basicSelect)
        .eq("slitting_manager_id", user.id)
        .order("date", { ascending: false });
      data = fallback.data as any;
      error = fallback.error;
    }

    setEntries(error ? [] : ((data as unknown as SlittingRow[]) ?? []));
    setLoading(false);
  };

  useEffect(() => { fetchEntries(); }, [user]);

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

  const handleSave = async () => {
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
    const { error } = await supabase.from("slitting_entries").update(payload).eq("id", editEntry.id);
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Entry updated" });
      setEditEntry(null);
      fetchEntries();
    }
  };

  const handleDelete = async (idToDelete: string) => {
    setDeleting(true);
    const { data, error } = await supabase
      .from("slitting_entries")
      .delete()
      .eq("id", idToDelete)
      .eq("slitting_manager_id", user?.id ?? "")
      .select("id");
    setDeleting(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else if (!data || data.length === 0) {
      toast({ title: "Not deleted", description: "You don't have permission to delete this entry, or it no longer exists.", variant: "destructive" });
      setDeleteId(null);
    } else {
      toast({ title: "Entry deleted" });
      setDeleteId(null);
      fetchEntries();
    }
  };

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
          <History className="h-5 w-5" />
          My Slitting History
        </CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-muted-foreground text-center py-6">No slitting entries yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Cut Width</TableHead>
                  <TableHead className="text-right">Length (mtr)</TableHead>
                  <TableHead className="text-right">Area (sqm)</TableHead>
                  <TableHead className="text-right">Weight (kg)</TableHead>
                  <TableHead className="text-right">Thickness (mm)</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => {
                  const t = computeTotals(e);
                  const displayNotes = (e.notes ?? "").split("|").map((s) => s.trim()).filter((s) => s && !/^gsm\s*[:\-]/i.test(s)).join(" | ");
                  return (
                    <TableRow key={e.id}>
                      <TableCell>{format(new Date(e.date), "dd/MM/yy")}</TableCell>
                      <TableCell className="font-medium">{e.product_codes?.code ?? "—"}</TableCell>
                      <TableCell>{e.cut_width_mm} mm</TableCell>
                      <TableCell className="text-right font-mono">{t.lengthMtr.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right font-mono">{t.sqm.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right font-mono">{t.kg > 0 ? t.kg.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</TableCell>
                      <TableCell className="text-right font-mono">{e.thickness_mm ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground text-xs max-w-xs truncate">{displayNotes || "—"}</TableCell>
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
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Edit Dialog */}
        <Dialog open={!!editEntry} onOpenChange={(o) => !o && setEditEntry(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Slitting Entry</DialogTitle>
              <DialogDescription>Update details for this slitting entry.</DialogDescription>
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
              </div>
              <div className="space-y-2">
                <Label>Thickness (mm)</Label>
                <Input type="number" step="any" value={editForm.thickness_mm} onChange={(e) => setEditForm({ ...editForm, thickness_mm: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Input value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditEntry(null)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Entry</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this slitting entry? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  if (deleteId) {
                    void handleDelete(deleteId);
                  }
                }}
                disabled={deleting}
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
