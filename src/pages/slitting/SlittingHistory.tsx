import { Fragment, useEffect, useState } from "react";
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
import { Loader2, History, Pencil, Trash2, ChevronDown, ChevronRight, FileText } from "lucide-react";
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

interface ReturnRow {
  id: string;
  date: string;
  returned_quantity: number;
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
  const [returnsMap, setReturnsMap] = useState<Record<string, ReturnRow[]>>({});
  const [loadingHead36, setLoadingHead36] = useState<string | null>(null);
  const [reportEntry, setReportEntry] = useState<SlittingRow | null>(null);

  const toggleExpand = async (entryId: string) => {
    if (expandedId === entryId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(entryId);
    if (!head36Map[entryId] || !returnsMap[entryId]) {
      setLoadingHead36(entryId);
      const [h36Res, retRes] = await Promise.all([
        supabase
          .from("head36_entries" as any)
          .select("id, date, rolls_taken, rolls_produced, roll_width_mm, length_per_tape_mtr, total_quantity, unit, notes")
          .eq("slitting_entry_id", entryId)
          .order("date", { ascending: false }),
        supabase
          .from("slitting_returns" as any)
          .select("id, date, returned_quantity, unit, notes")
          .eq("slitting_entry_id", entryId)
          .order("date", { ascending: false }),
      ]);
      setHead36Map((m) => ({ ...m, [entryId]: ((h36Res.data as unknown) as Head36Row[]) ?? [] }));
      setReturnsMap((m) => ({ ...m, [entryId]: ((retRes.data as unknown) as ReturnRow[]) ?? [] }));
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
    const { data, error } = await supabase.from("slitting_entries").update(payload).eq("id", editEntry.id).select("id");
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else if (!data || data.length === 0) {
      toast({ title: "Not updated", description: "No rows changed. You may not have permission to edit this entry.", variant: "destructive" });
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
                  <TableHead className="w-8"></TableHead>
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
                  const isExpanded = expandedId === e.id;
                  const head36 = head36Map[e.id] ?? [];
                  return (
                    <Fragment key={e.id}>
                    {/* main row */}
                    <TableRow key={e.id}>
                      <TableCell className="p-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleExpand(e.id)} title="Show 36 Head production">
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </Button>
                      </TableCell>
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
                    {isExpanded && (
                      <TableRow key={e.id + "-h36"} className="bg-muted/40 hover:bg-muted/40">
                        <TableCell colSpan={10} className="p-3">
                          <div className="text-xs font-semibold mb-2 text-muted-foreground">36 Head Production from this slitting entry</div>
                          {loadingHead36 === e.id ? (
                            <div className="flex items-center justify-center py-3"><Loader2 className="h-4 w-4 animate-spin" /></div>
                          ) : head36.length === 0 ? (
                            <p className="text-muted-foreground text-xs italic py-2">No 36 Head production recorded for this slitting entry yet.</p>
                          ) : (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="text-xs">Date</TableHead>
                                  <TableHead className="text-xs">Rolls Taken</TableHead>
                                  <TableHead className="text-xs">Rolls Produced</TableHead>
                                  <TableHead className="text-xs">Width (mm)</TableHead>
                                  <TableHead className="text-xs">Length/Tape (mtr)</TableHead>
                                  <TableHead className="text-xs text-right">Total</TableHead>
                                  <TableHead className="text-xs">Notes</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {head36.map((h) => (
                                  <TableRow key={h.id}>
                                    <TableCell className="text-xs">{format(new Date(h.date), "dd/MM/yy")}</TableCell>
                                    <TableCell className="text-xs">{h.rolls_taken}</TableCell>
                                    <TableCell className="text-xs">{h.rolls_produced}</TableCell>
                                    <TableCell className="text-xs">{h.roll_width_mm ?? "—"}</TableCell>
                                    <TableCell className="text-xs">{h.length_per_tape_mtr ?? "—"}</TableCell>
                                    <TableCell className="text-xs text-right font-mono">{h.total_quantity ?? ((h.length_per_tape_mtr ?? 0) * h.rolls_produced)} {h.unit}</TableCell>
                                    <TableCell className="text-xs text-muted-foreground">{h.notes ?? "—"}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                    </Fragment>
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
      </CardContent>
    </Card>
  );
}
