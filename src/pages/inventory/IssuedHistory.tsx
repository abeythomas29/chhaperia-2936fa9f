import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Search, PackageOpen } from "lucide-react";
import { toast } from "@/hooks/use-toast";

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

      // Read stock_issues directly. Do NOT filter by issue_type; support old + new rows.
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

      // Collect ids to resolve labels
      const productCodeIds = Array.from(new Set(issues.map((r) => r.product_code_id).filter(Boolean)));
      const rawMaterialIds = Array.from(new Set(issues.map((r) => r.raw_material_id).filter(Boolean)));
      const clientIds = Array.from(new Set(issues.map((r) => r.client_id).filter(Boolean)));
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
      const pcMap = new Map<string, string>((pcRes.data ?? []).map((p: any) => [p.id, p.code]));
      const rmMap = new Map<string, string>((rmRes.data ?? []).map((p: any) => [p.id, p.name]));
      const clMap = new Map<string, string>((clRes.data ?? []).map((p: any) => [p.id, p.name]));
      const profMap = new Map<string, string>((profRes.data ?? []).map((p: any) => [p.user_id, p.name]));

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
          recipient: recipientName,
          recipientType,
          quantity,
          unit,
          qtySqm,
          qtyKg,
          thickness: r.thickness_mm != null ? Number(r.thickness_mm) : null,
          gsm: r.gsm != null ? Number(r.gsm) : meta.gsm,
          notes: r.notes,
        };
      });

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
