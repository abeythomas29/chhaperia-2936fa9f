import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { History } from "lucide-react";
import { format } from "date-fns";

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

export default function InwardHistory() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<StockEntry[]>([]);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
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
    load();
  }, [user]);

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
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">No entries yet</TableCell></TableRow>
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
