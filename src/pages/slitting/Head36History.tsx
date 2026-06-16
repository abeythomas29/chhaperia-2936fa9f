import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Layers } from "lucide-react";
import { format } from "date-fns";

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

export default function Head36History() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Head36Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
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
      // Prefer entries the user logged themselves; if any exist with mismatched
      // operator_id but the underlying slitting entry is theirs, include those too.
      list = list.filter((r) =>
        r.operator_id === user.id ||
        r.slitting_entries?.slitting_manager_id === user.id ||
        (!r.operator_id && !r.slitting_entries?.slitting_manager_id)
      );
      if (!error) setRows(list);
      setLoading(false);
    })();
  }, [user]);

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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((h) => {
                    const total = h.total_quantity ?? ((h.length_per_tape_mtr ?? 0) * (h.rolls_produced ?? 0));
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
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
