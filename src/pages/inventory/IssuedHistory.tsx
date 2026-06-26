import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { format } from "date-fns";
import { Search, PackageOpen, Pencil, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface Row {
  id: string;
  date: string;
  kind: "Finished" | "Raw Material";
  item: string;
  lot: string;
  recipient: string;
  recipientType: string;
  quantity: number;
  unit: string;
  qtySqm: number | null;
  qtyKg: number | null;
  thickness: number | null;
  gsm: number | null;
  notes: string | null;
  raw: any;
}

function parseNotesMeta(notes: string | null): {
  sqm: number | null;
  kg: number | null;
  gsm: number | null;
} {
  if (!notes) return { sqm: null, kg: null, gsm: null };
  const m = (re: RegExp) => {
    const x = notes.match(re);
    return x ? Number(x[1]) : null;
  };
  return {
    sqm: m(/sqm=([\d.]+)/i),
    kg: m(/kg=([\d.]+)/i),
    gsm: m(/gsm=([\d.]+)/i),
  };
}

function clearInventoryCaches() {
  try {
    Object.keys(localStorage)
      .filter((k) => /issued|stock|inventory|raw_material/i.test(k))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }
}

// Locate the matching raw_material_stock_entries 'issue' row that mirrors a
// given stock_issues row. Uses the full key from spec §3:
//   raw_material_id, lot_number, issued_to_user_id, date,
//   issue_quantity, issue_unit, thickness_mm, gsm, notes.
// Always constrained to entry_type='issue' so inward rows are never touched.
async function findMirrorRmseId(rawIssue: any): Promise<string | null> {
  const rmId = rawIssue?.raw_material_id;
  if (!rmId) return null;
  const issuedTo = rawIssue.issued_to_user_id ?? rawIssue.recipient_user_id ?? null;
  const lot = rawIssue.lot_number ?? null;
  const date = rawIssue.date ?? null;
  const oldQty = rawIssue.issue_quantity ?? rawIssue.quantity ?? null;
  const oldUnit = rawIssue.issue_unit ?? rawIssue.unit ?? null;
  const thickness = rawIssue.thickness_mm ?? null;
  const gsm = rawIssue.gsm ?? null;
  const notes = rawIssue.notes ?? null;

  let q: any = (supabase as any)
    .from("raw_material_stock_entries")
    .select("id")
    .eq("raw_material_id", rmId)
    .eq("entry_type", "issue");
  if (issuedTo) q = q.eq("issued_to_user_id", issuedTo);
  if (lot != null) q = q.eq("lot_number", lot);
  if (date) q = q.eq("date", date);
  if (oldUnit) q = q.eq("issue_unit", oldUnit);
  if (oldQty != null) q = q.eq("issue_quantity", oldQty);
  if (thickness != null) q = q.eq("thickness_mm", thickness);
  if (gsm != null) q = q.eq("gsm", gsm);
  if (notes != null) q = q.eq("notes", notes);

  const { data, error } = await q.limit(1);
  if (error) {
    // eslint-disable-next-line no-console
    console.warn("findMirrorRmseId lookup failed", error);
    return null;
  }
  return data && data.length ? (data[0] as any).id : null;
}

export default function IssuedHistory() {
  const { isAdmin, hasRole } = useAuth();
  const canView = isAdmin || hasRole("inventory_manager");
  const canManage = isAdmin || hasRole("inventory_manager");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [editRow, setEditRow] = useState<Row | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [deleteRow, setDeleteRow] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("stock_issues")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(2000);

      // eslint-disable-next-line no-console
      console.log("stock_issues fetched", data?.length, error, data);

      if (error) {
        toast({
          title: "Failed to load issued records",
          description: error.message,
          variant: "destructive",
        });
        setRows([]);
        setLoading(false);
        return;
      }

      const issues = (data ?? []) as any[];
      const productCodeIds = Array.from(
        new Set(issues.map((r) => r.product_code_id).filter(Boolean)),
      );
      const rawMaterialIds = Array.from(
        new Set(issues.map((r) => r.raw_material_id).filter(Boolean)),
      );
      const clientIds = Array.from(
        new Set(issues.map((r) => r.client_id).filter(Boolean)),
      );
      const userIds = Array.from(
        new Set(
          issues
            .flatMap((r) => [r.issued_to_user_id, r.recipient_user_id])
            .filter(Boolean),
        ),
      );

      const [pcRes, rmRes, clRes, profRes] = await Promise.all([
        productCodeIds.length
          ? supabase.from("product_codes").select("id, code").in("id", productCodeIds)
          : Promise.resolve({ data: [] as any[] }),
        rawMaterialIds.length
          ? supabase.from("raw_materials").select("id, name").in("id", rawMaterialIds)
          : Promise.resolve({ data: [] as any[] }),
        clientIds.length
          ? supabase.from("company_clients").select("id, name").in("id", clientIds)
          : Promise.resolve({ data: [] as any[] }),
        userIds.length
          ? supabase.from("profiles").select("user_id, name").in("user_id", userIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const pcMap = new Map<string, string>(
        (pcRes.data ?? []).map((p: any) => [p.id, p.code]),
      );
      const rmMap = new Map<string, string>(
        (rmRes.data ?? []).map((p: any) => [p.id, p.name]),
      );
      const clMap = new Map<string, string>(
        (clRes.data ?? []).map((p: any) => [p.id, p.name]),
      );
      const profMap = new Map<string, string>(
        (profRes.data ?? []).map((p: any) => [p.user_id, p.name]),
      );

      const list: Row[] = issues.map((r) => {
        const meta = parseNotesMeta(r.notes);
        const inferredType: "raw_material" | "finished_stock" =
          (r.issue_type as any) ??
          (r.raw_material_id ? "raw_material" : "finished_stock");
        const quantity = Number(r.issue_quantity ?? r.quantity ?? 0);
        const unit = r.issue_unit ?? r.unit ?? "";
        const issuedToId = r.issued_to_user_id ?? r.recipient_user_id ?? null;
        const date = r.date ?? r.created_at ?? null;
        const qtySqm =
          r.issue_quantity_sqm != null
            ? Number(r.issue_quantity_sqm)
            : unit === "sqm"
              ? quantity
              : meta.sqm;
        const qtyKg =
          r.issue_quantity_kg != null
            ? Number(r.issue_quantity_kg)
            : unit === "kg"
              ? quantity
              : meta.kg;

        let recipientName = "—";
        let recipientType = r.recipient_type ?? "—";
        if (inferredType === "raw_material") {
          recipientName = issuedToId ? profMap.get(issuedToId) ?? "Manager" : "—";
          if (recipientType === "—") recipientType = "production_manager";
        } else if (r.recipient_type === "production_manager" || issuedToId) {
          recipientName = issuedToId ? profMap.get(issuedToId) ?? "Manager" : "—";
          if (recipientType === "—") recipientType = "production_manager";
        } else {
          recipientName = r.client_id ? clMap.get(r.client_id) ?? "—" : "—";
          if (recipientType === "—") recipientType = "client";
        }

        const item =
          inferredType === "raw_material"
            ? r.raw_material_id
              ? rmMap.get(r.raw_material_id) ?? "Raw Material"
              : "Raw Material"
            : r.product_code_id
              ? pcMap.get(r.product_code_id) ?? "—"
              : "—";

        return {
          id: r.id,
          date: date ?? new Date().toISOString(),
          kind: inferredType === "raw_material" ? "Raw Material" : "Finished",
          item,
          lot: r.lot_number ?? "-",
          recipient: recipientName,
          recipientType,
          quantity,
          unit,
          qtySqm,
          qtyKg,
          thickness: r.thickness_mm != null ? Number(r.thickness_mm) : null,
          gsm: r.gsm != null ? Number(r.gsm) : meta.gsm,
          notes: r.notes,
          raw: r,
        };
      });

      list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setRows(list);
      setLoading(false);
    })();
  }, [canView, reloadKey]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.item.toLowerCase().includes(q) ||
        r.recipient.toLowerCase().includes(q) ||
        (r.notes ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  function openEdit(r: Row) {
    const dateStr = r.date ? new Date(r.date).toISOString().slice(0, 10) : "";
    setEditForm({
      date: dateStr,
      recipient: r.recipient,
      quantity: r.quantity ?? "",
      unit: r.unit ?? "",
      qtySqm: r.qtySqm ?? "",
      qtyKg: r.qtyKg ?? "",
      thickness: r.thickness ?? "",
      gsm: r.gsm ?? "",
      notes: r.notes ?? "",
    });
    setEditRow(r);
  }

  function applyConversion(form: any) {
    const sqm = form.qtySqm !== "" ? Number(form.qtySqm) : null;
    const kg = form.qtyKg !== "" ? Number(form.qtyKg) : null;
    const gsm = form.gsm !== "" ? Number(form.gsm) : null;
    if (sqm != null && kg == null && gsm) {
      form.qtyKg = +(sqm * gsm / 1000).toFixed(3);
    } else if (kg != null && sqm == null && gsm) {
      form.qtySqm = +(kg * 1000 / gsm).toFixed(3);
    }
    return form;
  }

  async function handleSave() {
    if (!editRow) return;
    const f = { ...editForm };
    const sqm = f.qtySqm !== "" && f.qtySqm != null ? Number(f.qtySqm) : null;
    const kg = f.qtyKg !== "" && f.qtyKg != null ? Number(f.qtyKg) : null;
    const gsm = f.gsm !== "" && f.gsm != null ? Number(f.gsm) : null;

    // Auto-fill missing unit when GSM provided
    let qtySqm = sqm;
    let qtyKg = kg;
    if (qtySqm != null && qtyKg == null && gsm) qtyKg = +(qtySqm * gsm / 1000).toFixed(3);
    if (qtyKg != null && qtySqm == null && gsm) qtySqm = +(qtyKg * 1000 / gsm).toFixed(3);
    if ((qtySqm != null && qtyKg == null) || (qtyKg != null && qtySqm == null)) {
      if (!gsm) {
        toast({
          title: "GSM required for conversion",
          description: "Provide GSM to auto-convert between sqm and kg, or fill both values.",
          variant: "destructive",
        });
        return;
      }
    }

    const quantity = f.quantity !== "" ? Number(f.quantity) : editRow.quantity;
    const unit = (f.unit || editRow.unit || "").trim();
    const thickness = f.thickness !== "" ? Number(f.thickness) : null;
    const update: any = {
      date: f.date || null,
      issue_quantity: quantity,
      issue_unit: unit,
      quantity,
      unit,
      issue_quantity_sqm: qtySqm,
      issue_quantity_kg: qtyKg,
      thickness_mm: thickness,
      gsm: gsm,
      notes: f.notes || null,
    };

    setSaving(true);
    const { error } = await supabase
      .from("stock_issues")
      .update(update)
      .eq("id", editRow.id);

    if (error) {
      setSaving(false);
      // eslint-disable-next-line no-console
      console.error("update stock_issues failed", error);
      toast({
        title: "Update failed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    // Mirror update to raw_material_stock_entries for raw material issues.
    // Match strictly on entry_type='issue' so inward rows are never touched.
    if (editRow.kind === "Raw Material" && editRow.raw?.raw_material_id) {
      const matchId = await findMirrorRmseId(editRow.raw);
      if (matchId) {
        const rmUpdate: any = {
          date: f.date || null,
          quantity: qtyKg ?? quantity,
          issue_quantity: quantity,
          issue_unit: unit,
          issue_quantity_kg: qtyKg,
          // raw_material_stock_entries has no issue_quantity_sqm column in live
          // schema; sqm lives only on stock_issues. Keep core fields only.
          lot_number: editRow.raw.lot_number ?? null,
          thickness_mm: thickness,
          gsm: gsm,
          notes: f.notes || null,
          entry_type: "issue",
          entry_kind: "out",
        };
        const { error: rmErr } = await (supabase as any)
          .from("raw_material_stock_entries")
          .update(rmUpdate)
          .eq("id", matchId)
          .eq("entry_type", "issue");
        if (rmErr) {
          // eslint-disable-next-line no-console
          console.error("update raw_material_stock_entries failed", rmErr);
          toast({
            title: "Stock entry update failed",
            description: rmErr.message,
            variant: "destructive",
          });
        }
      } else {
        // eslint-disable-next-line no-console
        console.warn("No matching raw_material_stock_entries row found for issue", editRow.id);
      }
    }


    setSaving(false);
    clearInventoryCaches();
    toast({ title: "Issued record updated" });
    setEditRow(null);
    setReloadKey((k) => k + 1);
  }

  async function handleDelete() {
    if (!deleteRow) return;
    setDeleting(true);
    const { error } = await supabase
      .from("stock_issues")
      .delete()
      .eq("id", deleteRow.id);
    if (error) {
      setDeleting(false);
      // eslint-disable-next-line no-console
      console.error("delete stock_issues failed", error);
      toast({
        title: "Delete failed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    // Mirror delete on raw_material_stock_entries (entry_type='issue' only).
    // Spec §3: never delete inward rows.
    if (deleteRow.kind === "Raw Material" && deleteRow.raw?.raw_material_id) {
      const matchId = await findMirrorRmseId(deleteRow.raw);
      if (matchId) {
        const { error: rmErr } = await (supabase as any)
          .from("raw_material_stock_entries")
          .delete()
          .eq("id", matchId)
          .eq("entry_type", "issue");
        if (rmErr) {
          // eslint-disable-next-line no-console
          console.error("delete raw_material_stock_entries failed", rmErr);
          toast({
            title: "Stock entry delete failed",
            description: rmErr.message,
            variant: "destructive",
          });
        }
      } else {
        // eslint-disable-next-line no-console
        console.warn("No matching raw_material_stock_entries row found for delete", deleteRow.id);
      }
    }


    setDeleting(false);
    clearInventoryCaches();
    toast({ title: "Issued record deleted" });
    setDeleteRow(null);
    setReloadKey((k) => k + 1);
  }

  if (!canView) {
    return <p className="text-muted-foreground">You do not have access to this page.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <PackageOpen className="h-6 w-6 text-secondary" /> Issued
        </h1>
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search product, recipient, notes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            All Issued Items ({filtered.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Product / Material</TableHead>
                <TableHead>Issued To</TableHead>
                <TableHead>Recipient Type</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">sqm</TableHead>
                <TableHead className="text-right">kg</TableHead>
                <TableHead className="text-right">Thickness</TableHead>
                <TableHead className="text-right">GSM</TableHead>
                <TableHead>Notes</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={canManage ? 13 : 12} className="text-center py-8 text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canManage ? 13 : 12} className="text-center py-8 text-muted-foreground">
                    No issued records found
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-base">
                      {format(new Date(r.date), "dd/MM/yy")}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.kind === "Finished" ? "default" : "secondary"}>
                        {r.kind}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{r.item}</TableCell>
                    <TableCell>{r.recipient}</TableCell>
                    <TableCell className="capitalize">
                      {r.recipientType.replace("_", " ")}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {r.quantity.toLocaleString()}
                    </TableCell>
                    <TableCell>{r.unit}</TableCell>
                    <TableCell className="text-right">
                      {r.qtySqm != null
                        ? r.qtySqm.toLocaleString(undefined, { maximumFractionDigits: 2 })
                        : "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.qtyKg != null
                        ? r.qtyKg.toLocaleString(undefined, { maximumFractionDigits: 2 })
                        : "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.thickness != null ? r.thickness : "-"}
                    </TableCell>
                    <TableCell className="text-right">{r.gsm != null ? r.gsm : "-"}</TableCell>
                    <TableCell className="max-w-[240px] truncate">{r.notes ?? "—"}</TableCell>
                    {canManage && (
                      <TableCell className="text-right whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(r)}
                          aria-label="Edit issued record"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteRow(r)}
                          aria-label="Delete issued record"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={!!editRow} onOpenChange={(o) => !o && setEditRow(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Edit Issued — {editRow?.kind} · {editRow?.item}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Recipient</Label>
              <Input value={editForm.recipient ?? ""} disabled />
            </div>
            <div>
              <Label>Date</Label>
              <Input
                type="date"
                value={editForm.date ?? ""}
                onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
              />
            </div>
            <div>
              <Label>Unit</Label>
              <Input
                value={editForm.unit ?? ""}
                onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })}
                placeholder="sqm, kg, meters..."
              />
            </div>
            <div>
              <Label>Quantity</Label>
              <Input
                type="number"
                value={editForm.quantity ?? ""}
                onChange={(e) => setEditForm({ ...editForm, quantity: e.target.value })}
              />
            </div>
            <div>
              <Label>Thickness (mm)</Label>
              <Input
                type="number"
                value={editForm.thickness ?? ""}
                onChange={(e) => setEditForm({ ...editForm, thickness: e.target.value })}
              />
            </div>
            <div>
              <Label>Quantity (sqm)</Label>
              <Input
                type="number"
                value={editForm.qtySqm ?? ""}
                onChange={(e) =>
                  setEditForm(applyConversion({ ...editForm, qtySqm: e.target.value, qtyKg: "" }))
                }
              />
            </div>
            <div>
              <Label>Quantity (kg)</Label>
              <Input
                type="number"
                value={editForm.qtyKg ?? ""}
                onChange={(e) =>
                  setEditForm(applyConversion({ ...editForm, qtyKg: e.target.value, qtySqm: "" }))
                }
              />
            </div>
            <div>
              <Label>GSM</Label>
              <Input
                type="number"
                value={editForm.gsm ?? ""}
                onChange={(e) => setEditForm({ ...editForm, gsm: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <Label>Notes</Label>
              <Textarea
                value={editForm.notes ?? ""}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteRow} onOpenChange={(o) => !o && setDeleteRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete issued record?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the issued record for{" "}
              <span className="font-medium">{deleteRow?.item}</span>. Inventory totals
              will recalculate immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
