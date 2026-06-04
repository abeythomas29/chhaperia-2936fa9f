import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Pencil, Trash2, FileText } from "lucide-react";
import { format } from "date-fns";
import { toast } from "@/hooks/use-toast";

interface RawMaterialUsage {
  quantity_used: number;
  raw_materials: { name: string; unit: string } | null;
}

interface HistoryEntry {
  id: string;
  date: string;
  rolls_count: number;
  quantity_per_roll: number;
  total_quantity: number | null;
  unit: string;
  thickness_mm: number | null;
  product_code_id: string;
  client_id: string | null;
  notes: string | null;
  raw_material_included: boolean | null;
  gsm: number | null;
  tensile_strength: number | null;
  elongation: number | null;
  swelling_height: number | null;
  swelling_speed: number | null;
  surface_resistance: number | null;
  product_codes: { code: string } | null;
  company_clients: { name: string } | null;
  raw_material_usage: RawMaterialUsage[] | null;
}

export default function ProductionHistory() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit state
  const [editEntry, setEditEntry] = useState<HistoryEntry | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editRolls, setEditRolls] = useState("");
  const [editQtyPerRoll, setEditQtyPerRoll] = useState("");
  const [editUnit, setEditUnit] = useState("meters");
  const [editThickness, setEditThickness] = useState("");
  const [saving, setSaving] = useState(false);

  // Delete state
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Report dialog
  const [reportEntry, setReportEntry] = useState<HistoryEntry | null>(null);

  const fetchHistory = async () => {
    if (!user) return;
    setLoading(true);
    const fullSelect = "id, date, rolls_count, quantity_per_roll, total_quantity, unit, thickness_mm, product_code_id, client_id, notes, raw_material_included, gsm, tensile_strength, elongation, swelling_height, swelling_speed, surface_resistance, product_codes(code), company_clients:client_id(name), raw_material_usage(quantity_used, raw_materials(name, unit))";
    const midSelect = "id, date, rolls_count, quantity_per_roll, total_quantity, unit, thickness_mm, product_code_id, client_id, notes, raw_material_included, product_codes(code), company_clients:client_id(name), raw_material_usage(quantity_used, raw_materials(name, unit))";
    const noRMISelect = "id, date, rolls_count, quantity_per_roll, total_quantity, unit, thickness_mm, product_code_id, client_id, notes, product_codes(code), company_clients:client_id(name), raw_material_usage(quantity_used, raw_materials(name, unit))";
    const minimalSelect = "id, date, rolls_count, quantity_per_roll, total_quantity, unit, thickness_mm, product_code_id, client_id, notes, product_codes(code), company_clients:client_id(name)";

    let { data, error } = await supabase
      .from("production_entries")
      .select(fullSelect)
      .eq("worker_id", user.id)
      .order("date", { ascending: false })
      .limit(200);

    if (error) {
      const fb = await supabase.from("production_entries").select(midSelect).eq("worker_id", user.id).order("date", { ascending: false }).limit(200);
      data = fb.data as any; error = fb.error;
    }
    if (error) {
      const fb = await supabase.from("production_entries").select(noRMISelect).eq("worker_id", user.id).order("date", { ascending: false }).limit(200);
      data = fb.data as any; error = fb.error;
    }
    if (error) {
      const fb = await supabase.from("production_entries").select(minimalSelect).eq("worker_id", user.id).order("date", { ascending: false }).limit(200);
      data = fb.data as any; error = fb.error;
    }

    setEntries((data as unknown as HistoryEntry[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    fetchHistory();
  }, [user]);

  const openEdit = (entry: HistoryEntry) => {
    setEditEntry(entry);
    setEditDate(entry.date);
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
      fetchHistory();
    }
  };

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
      fetchHistory();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>My Production History</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Client</TableHead>
              <TableHead className="text-right">Rolls</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Raw Materials</TableHead>
              <TableHead className="text-right">Thickness (mm)</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : entries.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No entries yet</TableCell></TableRow>
            ) : (
              entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap">{(() => { const d = new Date(e.date); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(-2)}`; })()}</TableCell>
                  <TableCell className="font-medium">{e.product_codes?.code ?? "—"}</TableCell>
                  <TableCell>{e.company_clients?.name ?? "—"}</TableCell>
                  <TableCell className="text-right">{e.rolls_count}</TableCell>
                  <TableCell className="text-right font-semibold">{e.total_quantity ?? (e.rolls_count * e.quantity_per_roll)} {e.unit}</TableCell>
                  <TableCell>{e.unit}</TableCell>
                  <TableCell className="text-xs">
                    {(() => {
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
                      return materialLines.length > 0
                        ? materialLines.map((line, i) => (
                            <div key={i}>{line}</div>
                          ))
                        : <span className="text-muted-foreground">—</span>;
                    })()}
                  </TableCell>
                  <TableCell className="text-right">{e.thickness_mm ?? "—"}</TableCell>
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
              ))
            )}
          </TableBody>
        </Table>

        {/* Edit Dialog */}
        <Dialog open={!!editEntry} onOpenChange={(open) => !open && setEditEntry(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Production Entry</DialogTitle>
              <DialogDescription>Update the details for this entry.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Rolls Count</Label>
                  <Input type="number" value={editRolls} onChange={(e) => setEditRolls(e.target.value)} min={1} />
                </div>
                <div className="space-y-2">
                  <Label>Qty per Roll (sqmtr)</Label>
                  <Input type="number" value={editQtyPerRoll} onChange={(e) => setEditQtyPerRoll(e.target.value)} min={0} step="0.0001" />
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
                <Input type="number" value={editThickness} onChange={(e) => setEditThickness(e.target.value)} min={0} step="0.0001" placeholder="e.g. 0.25" />
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
              const materials = reportEntry.raw_material_usage && reportEntry.raw_material_usage.length > 0
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
                    {materials.length > 0 ? (
                      <div className="divide-y border rounded-md">
                        {materials.map((u, i) => (
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
      </CardContent>
    </Card>
  );
}
