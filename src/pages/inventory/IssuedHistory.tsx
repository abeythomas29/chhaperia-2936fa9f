import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Search, PackageOpen } from "lucide-react";

interface Row {
  id: string;
  date: string;
  kind: "Finished" | "Raw Material";
  item: string;
  recipient: string;
  recipientType: string;
  quantity: number;
  unit: string;
  qtySqm: number | null;
  qtyKg: number | null;
  thickness: number | null;
  gsm: number | null;
  notes: string | null;
}

function parseNotesMeta(notes: string | null): { sqm: number | null; kg: number | null; gsm: number | null } {
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

export default function IssuedHistory() {
  const { isAdmin, hasRole } = useAuth();
  const canView = isAdmin || hasRole("inventory_manager");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      const [stockRes, rmRes] = await Promise.all([
        supabase
          .from("stock_issues")
          .select(
            "id, date, quantity, unit, notes, thickness_mm, recipient_type, product_codes(code), company_clients(name), recipient:profiles!stock_issues_recipient_user_id_fkey(name)",
          )
          .order("date", { ascending: false })
          .limit(1000),
        supabase
          .from("raw_material_stock_entries")
          .select(
            "id, date, quantity, notes, thickness_mm, gsm, entry_type, issue_unit, issue_quantity, issue_quantity_kg, issued_to_user_id, raw_materials(name)",
          )
          .eq("entry_type", "out")
          .order("date", { ascending: false })
          .limit(1000),
      ]);

      const userIds = Array.from(
        new Set(
          ((rmRes.data ?? []) as any[])
            .map((r) => r.issued_to_user_id)
            .filter(Boolean),
        ),
      );
      const profMap = new Map<string, string>();
      if (userIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, name")
          .in("user_id", userIds);
        for (const p of profs ?? []) profMap.set((p as any).user_id, (p as any).name);
      }

      const list: Row[] = [];
      for (const i of (stockRes.data ?? []) as any[]) {
        const meta = parseNotesMeta(i.notes);
        const recipient =
          i.recipient_type === "production_manager"
            ? i.recipient?.name ?? "Manager"
            : i.company_clients?.name ?? "—";
        list.push({
          id: `s-${i.id}`,
          date: i.date,
          kind: "Finished",
          item: i.product_codes?.code ?? "—",
          recipient,
          recipientType: i.recipient_type ?? "—",
          quantity: Number(i.quantity ?? 0),
          unit: i.unit ?? "",
          qtySqm: meta.sqm,
          qtyKg: meta.kg,
          thickness: i.thickness_mm != null ? Number(i.thickness_mm) : null,
          gsm: meta.gsm,
          notes: i.notes,
        });
      }
      for (const r of (rmRes.data ?? []) as any[]) {
        list.push({
          id: `r-${r.id}`,
          date: r.date,
          kind: "Raw Material",
          item: r.raw_materials?.name ?? "—",
          recipient: profMap.get(r.issued_to_user_id) ?? "—",
          recipientType: r.issued_to_user_id ? "production_manager" : "—",
          quantity: Number(r.issue_quantity ?? r.quantity ?? 0),
          unit: r.issue_unit ?? "kg",
          qtySqm: r.issue_unit === "sqm" ? Number(r.issue_quantity ?? 0) : null,
          qtyKg: r.issue_quantity_kg != null ? Number(r.issue_quantity_kg) : (r.issue_unit === "kg" ? Number(r.issue_quantity ?? 0) : null),
          thickness: r.thickness_mm != null ? Number(r.thickness_mm) : null,
          gsm: r.gsm != null ? Number(r.gsm) : null,
          notes: r.notes,
        });
      }
      list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setRows(list);
      setLoading(false);
    })();
  }, [canView]);

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
        <Input placeholder="Search product, recipient, notes..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">All Issued Items ({filtered.length})</CardTitle>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={12} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={12} className="text-center py-8 text-muted-foreground">No issued records found</TableCell></TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-base">{format(new Date(r.date), "dd/MM/yy")}</TableCell>
                    <TableCell><Badge variant={r.kind === "Finished" ? "default" : "secondary"}>{r.kind}</Badge></TableCell>
                    <TableCell className="font-medium">{r.item}</TableCell>
                    <TableCell>{r.recipient}</TableCell>
                    <TableCell className="capitalize">{r.recipientType.replace("_", " ")}</TableCell>
                    <TableCell className="text-right font-semibold">{r.quantity.toLocaleString()}</TableCell>
                    <TableCell>{r.unit}</TableCell>
                    <TableCell className="text-right">{r.qtySqm != null ? r.qtySqm.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "-"}</TableCell>
                    <TableCell className="text-right">{r.qtyKg != null ? r.qtyKg.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "-"}</TableCell>
                    <TableCell className="text-right">{r.thickness != null ? r.thickness : "-"}</TableCell>
                    <TableCell className="text-right">{r.gsm != null ? r.gsm : "-"}</TableCell>
                    <TableCell className="max-w-[240px] truncate">{r.notes ?? "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
