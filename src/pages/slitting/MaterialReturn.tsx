import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, PackageOpen, BarChart3 } from "lucide-react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listManagerIssuedMaterials, type ManagerIssuedMaterial } from "@/lib/issuedMaterials";

interface ClientRow { id: string; name: string }

const formatNumber = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function MaterialReturn() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [issues, setIssues] = useState<ManagerIssuedMaterial[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [wastageDialogOpen, setWastageDialogOpen] = useState(false);

  const [form, setForm] = useState({
    issue_key: "",
    client_id: "",
    entry_date: new Date().toISOString().slice(0, 10),
    return_type: "reusable" as "reusable" | "wastage",
    quantity: "",
    location: "",
    notes: "",
  });

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [{ data, errors }, clRes] = await Promise.all([
      listManagerIssuedMaterials(user.id),
      supabase.from("company_clients").select("id, name").eq("status", "active").order("name"),
    ]);
    if (errors.length) {
      toast({
        title: "Issued materials partial load",
        description: errors.map((e) => `${e.source}: ${e.message}`).join(" · "),
        variant: "destructive",
      });
    }
    // Only show issues with pending > 0 (per spec).
    setIssues(data.filter((d) => d.pending_quantity > 0.0001));
    setClients((clRes.data as ClientRow[] | null) ?? []);
    setLoading(false);
  }, [user, toast]);

  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(
    () => issues.find((i) => i.key === form.issue_key) ?? null,
    [issues, form.issue_key],
  );

  const enteredQty = parseFloat(form.quantity) || 0;
  const exceeds = !!selected && enteredQty > selected.pending_quantity + 1e-6;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selected) {
      toast({ title: "Select an issued log", description: "Pick an issued material to declare a return.", variant: "destructive" });
      return;
    }
    if (enteredQty <= 0) {
      toast({ title: "Enter quantity", description: "Quantity must be greater than 0.", variant: "destructive" });
      return;
    }
    if (exceeds) {
      toast({
        title: "Exceeds pending",
        description: `Only ${formatNumber(selected.pending_quantity)} ${selected.unit} pending on this issue.`,
        variant: "destructive",
      });
      return;
    }
    if (form.return_type === "reusable" && !form.location.trim()) {
      toast({ title: "Location required", description: "Enter the return location for reusable stock.", variant: "destructive" });
      return;
    }

    // slitting_returns FK requires slitting_entry_id.
    // Secondary rows already carry the entry id; primary rows need lookup.
    let anchorId: string | null = null;
    if (selected.is_secondary && selected.secondary_slitting_entry_id) {
      anchorId = selected.secondary_slitting_entry_id;
    } else {
      const anchorRes = await supabase
        .from("slitting_entries")
        .select("id")
        .eq("stock_issue_id", selected.issue_id)
        .limit(1);
      anchorId = (anchorRes.data?.[0]?.id as string | undefined) ?? null;
    }
    if (!anchorId) {
      toast({
        title: "No slitting entry yet",
        description: "Consume at least once via Slitting Entry before declaring a return for this issue.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    const isoDate = form.entry_date || new Date().toISOString().slice(0, 10);
    const isWastage = form.return_type === "wastage";
    const payload: Record<string, unknown> = {
      slitting_entry_id: anchorId,
      client_id: form.client_id || null,
      date: isoDate,
      returned_quantity: isWastage ? 0 : enteredQty,
      wastage_quantity: isWastage ? enteredQty : null,
      unit: selected.unit,
      notes: [form.notes, `Issue: ${selected.display_name}`, selected.lot_number ? `Lot: ${selected.lot_number}` : ""].filter(Boolean).join(" | "),
      returned_by: user.id,
      return_type: form.return_type,
      location: isWastage ? null : (form.location || null),
      created_at: new Date(isoDate + "T12:00:00").toISOString(),
    };

    const tryInsert = async (p: Record<string, unknown>) =>
      (supabase as any).from("slitting_returns").insert(p);
    let { error } = await tryInsert(payload);
    // Fallback: strip unknown columns if schema is older.
    const stripAndRetry = async (col: string) => {
      const { [col]: _, ...rest } = payload;
      ({ error } = await tryInsert(rest));
    };
    if (error?.code === "PGRST204" && /'location' column/.test(error.message)) await stripAndRetry("location");
    if (error?.code === "PGRST204" && /'wastage_quantity' column/.test(error.message)) await stripAndRetry("wastage_quantity");
    if (error?.code === "PGRST204" && /'return_type' column/.test(error.message)) await stripAndRetry("return_type");

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }
    toast({ title: form.return_type === "wastage" ? "Wastage recorded" : "Reusable return recorded" });
    setForm({
      issue_key: "",
      client_id: "",
      entry_date: new Date().toISOString().slice(0, 10),
      return_type: "reusable",
      quantity: "",
      location: "",
      notes: "",
    });
    await load();
    setSubmitting(false);
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><PackageOpen className="h-5 w-5" /> Material Return Entry</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_1fr]">
            <div className="space-y-2">
              <Label>Select Issued Log *</Label>
              <SearchableSelect
                value={form.issue_key}
                onValueChange={(v) => setForm({ ...form, issue_key: v })}
                placeholder={issues.length ? "Choose an issued material" : "No pending issued logs"}
                options={issues.map((i) => ({
                  value: i.key,
                  label: `${i.is_secondary ? "↳ " : ""}${i.display_name} | Lot ${i.lot_number ?? "—"} | ${i.thickness_mm ?? "—"} mm | GSM ${i.gsm ?? "—"} | Pending ${formatNumber(i.pending_quantity)} ${i.unit}`,
                  keywords: `${i.display_name} ${i.product_code ?? ""} ${i.raw_material_name ?? ""} ${i.lot_number ?? ""} ${i.issue_type} ${i.is_secondary ? "secondary slit" : "primary"}`,
                }))}
              />
              {!issues.length && (
                <p className="text-xs text-muted-foreground">
                  No pending issued logs found for your account. Material Return starts from issues assigned to you (raw material or finished stock) with pending quantity &gt; 0.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Date *</Label>
              <Input type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Client (Optional)</Label>
            <Select value={form.client_id} onValueChange={(v) => setForm({ ...form, client_id: v })}>
              <SelectTrigger><SelectValue placeholder="Select client (optional)" /></SelectTrigger>
              <SelectContent>
                {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {selected && (
            <div className="rounded-lg border p-3 text-sm space-y-2">
              <div className="font-semibold">{selected.display_name}
                <span className="ml-2 text-xs text-muted-foreground">({selected.issue_type === "raw_material" ? "Raw material" : "Finished stock"})</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                <div>Unit: <b>{selected.unit}</b></div>
                <div>Thickness: <b>{selected.thickness_mm ?? "—"} mm</b></div>
                <div>GSM: <b>{selected.gsm ?? "—"}</b></div>
                <div>Lot: <b>{selected.lot_number ?? "—"}</b></div>
                <div>Date: <b>{selected.date ? format(new Date(selected.date), "dd/MM/yy") : "—"}</b></div>
                <div>Code: <b>{selected.product_code ?? "—"}</b></div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 border-t pt-2 text-xs">
                <div>Issued: <b>{formatNumber(selected.issued_quantity)}</b></div>
                <div>Consumed: <b>{formatNumber(selected.consumed_quantity)}</b></div>
                <div>Reusable: <b>{formatNumber(selected.returned_reusable)}</b></div>
                <div>Wastage: <b>{formatNumber(selected.wastage)}</b></div>
                <div>Pending: <b className="text-secondary">{formatNumber(selected.pending_quantity)} {selected.unit}</b></div>
              </div>
            </div>
          )}

          {/* Reusable vs Wastage */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setForm({ ...form, return_type: "reusable" })}
              className={`rounded-lg border-2 p-3 text-left transition ${
                form.return_type === "reusable" ? "border-secondary bg-secondary/10" : "border-muted hover:border-muted-foreground/30"
              }`}
            >
              <div className="font-semibold">♻ Reusable</div>
              <div className="text-xs text-muted-foreground">Returns to stock at a storage location</div>
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, return_type: "wastage", location: "" })}
              className={`rounded-lg border-2 p-3 text-left transition ${
                form.return_type === "wastage" ? "border-destructive bg-destructive/10" : "border-muted hover:border-muted-foreground/30"
              }`}
            >
              <div className="font-semibold">🗑 Wastage</div>
              <div className="text-xs text-muted-foreground">Counts towards total wastage by category</div>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{form.return_type === "wastage" ? "Wastage Quantity *" : "Returned Quantity *"}</Label>
              <Input
                type="number"
                step="any"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                placeholder={selected ? `Max ${formatNumber(selected.pending_quantity)}` : ""}
              />
              {exceeds && selected && (
                <p className="text-xs text-destructive">Exceeds pending ({formatNumber(selected.pending_quantity)} {selected.unit}).</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Unit</Label>
              <Input value={selected?.unit ?? "—"} disabled />
            </div>
          </div>

          {form.return_type === "reusable" && (
            <div className="space-y-2">
              <Label>Return Location *</Label>
              <Input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="e.g. Rack A-3 / Bay 2"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>Notes</Label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>

          <Button
            type="submit"
            className="w-full bg-secondary text-secondary-foreground hover:bg-secondary/90"
            disabled={submitting || !selected || exceeds || enteredQty <= 0}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Return
          </Button>

          <Button type="button" variant="outline" className="w-full" onClick={() => setWastageDialogOpen(true)}>
            <BarChart3 className="mr-2 h-4 w-4" /> Wastage Count
          </Button>
        </form>

        <WastageCountDialog open={wastageDialogOpen} onOpenChange={setWastageDialogOpen} />
      </CardContent>
    </Card>
  );
}

function WastageCountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      const { data, error } = await (supabase as any)
        .from("slitting_returns")
        .select("id, date, returned_quantity, wastage_quantity, unit, notes, return_type, client_id, slitting_entry_id")
        .eq("return_type", "wastage")
        .order("date", { ascending: false })
        .limit(1000);
      if (error) {
        console.error("[Wastage] fetch error:", error);
        setRows([]);
        setLoading(false);
        return;
      }
      const wastageRows = ((data as any[]) ?? []);
      const entryIds = Array.from(new Set(wastageRows.map((r) => r.slitting_entry_id).filter(Boolean)));
      const clientIds = Array.from(new Set(wastageRows.map((r) => r.client_id).filter(Boolean)));

      const [entriesRes, clientsRes] = await Promise.all([
        entryIds.length
          ? supabase.from("slitting_entries").select("id, thickness_mm, gsm, product_codes(code)" as any).in("id", entryIds)
          : Promise.resolve({ data: [] as any[] }),
        clientIds.length
          ? supabase.from("company_clients").select("id, name").in("id", clientIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const entryMap = new Map<string, any>();
      ((entriesRes.data as any[]) ?? []).forEach((e: any) => entryMap.set(e.id, e));
      const clientMap = new Map<string, string>();
      ((clientsRes.data as any[]) ?? []).forEach((c: any) => clientMap.set(c.id, c.name));

      const enriched = wastageRows.map((r) => {
        const ent = entryMap.get(r.slitting_entry_id);
        return {
          ...r,
          product: ent?.product_codes?.code ?? "—",
          thickness_mm: ent?.thickness_mm ?? null,
          gsm: ent?.gsm ?? null,
          client_name: r.client_id ? (clientMap.get(r.client_id) ?? "—") : "—",
          qty: Number(r.wastage_quantity ?? r.returned_quantity ?? 0),
        };
      });
      setRows(enriched);
      setLoading(false);
    })();
  }, [open]);

  const total = rows.reduce((s, r) => s + Number(r.qty || 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" /> Wastage Count</DialogTitle>
        </DialogHeader>
        <div className="mb-2 rounded-md bg-destructive/10 p-2 text-center text-sm font-semibold text-destructive">
          Total Wastage: {total.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </div>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No wastage entries found.</div>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Thickness</TableHead>
                  <TableHead>GSM</TableHead>
                  <TableHead className="text-right">Wastage Qty</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.date ? format(new Date(r.date), "dd/MM/yy") : "—"}</TableCell>
                    <TableCell className="font-mono">{r.product}</TableCell>
                    <TableCell>{r.client_name}</TableCell>
                    <TableCell>{r.thickness_mm ?? "—"} mm</TableCell>
                    <TableCell>{r.gsm ?? "—"}</TableCell>
                    <TableCell className="text-right font-semibold text-destructive">
                      {Number(r.qty).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell>{r.unit ?? "sqmtr"}</TableCell>
                    <TableCell className="max-w-[200px] truncate" title={r.notes ?? ""}>{r.notes ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
