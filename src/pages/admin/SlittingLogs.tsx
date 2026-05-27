import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Scissors, Search } from "lucide-react";
import { format } from "date-fns";

interface SlittingRow {
  id: string;
  date: string;
  source_quantity: number;
  cut_quantity_produced: number;
  cut_width_mm: number;
  thickness_mm: number | null;
  gsm: number | null;
  unit: string;
  notes: string | null;
  slitting_manager_id: string;
  product_codes: { code: string } | null;
}

const parseGsm = (notes: string | null): number => {
  if (!notes) return 0;
  const m = notes.match(/GSM:\s*([\d.]+)/i);
  return m ? parseFloat(m[1]) : 0;
};

const computeTotals = (r: SlittingRow) => {
  const lengthMtr = r.cut_quantity_produced || 0;
  const sqm = (r.cut_width_mm / 1000) * lengthMtr;
  const gsm = r.gsm ?? parseGsm(r.notes);
  const kg = gsm > 0 ? (sqm * gsm) / 1000 : 0;
  return { lengthMtr, sqm, kg };
};

export default function SlittingLogs() {
  const [entries, setEntries] = useState<SlittingRow[]>([]);
  const [managers, setManagers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [productFilter, setProductFilter] = useState<string>("all");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("slitting_entries")
        .select("id, date, source_quantity, cut_quantity_produced, cut_width_mm, thickness_mm, gsm, unit, notes, slitting_manager_id, product_codes(code)")
        .order("date", { ascending: false });
      const rows = (data as unknown as SlittingRow[]) ?? [];
      setEntries(rows);

      const ids = Array.from(new Set(rows.map((r) => r.slitting_manager_id).filter(Boolean)));
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, name")
          .in("user_id", ids);
        const map: Record<string, string> = {};
        (profs ?? []).forEach((p: any) => { map[p.user_id] = p.name; });
        setManagers(map);
      }
      setLoading(false);
    })();
  }, []);

  const products = Array.from(new Set(entries.map((e) => e.product_codes?.code).filter(Boolean))) as string[];

  const filtered = entries.filter((e) => {
    if (productFilter !== "all" && e.product_codes?.code !== productFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (e.product_codes?.code ?? "").toLowerCase().includes(q) ||
      (managers[e.slitting_manager_id] ?? "").toLowerCase().includes(q) ||
      (e.notes ?? "").toLowerCase().includes(q)
    );
  });

  const totals = filtered.reduce(
    (acc, e) => {
      const t = computeTotals(e);
      acc.length += t.lengthMtr;
      acc.sqm += t.sqm;
      acc.kg += t.kg;
      return acc;
    },
    { length: 0, sqm: 0, kg: 0 }
  );

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
          <Scissors className="h-5 w-5" /> Slitting Logs
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by product, manager, notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={productFilter} onValueChange={setProductFilter}>
            <SelectTrigger className="sm:w-64"><SelectValue placeholder="All products" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All products</SelectItem>
              {products.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="bg-muted rounded-lg p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-center mb-4">
          <div>
            <p className="text-xs text-muted-foreground">Entries</p>
            <p className="text-xl font-bold text-primary">{filtered.length}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Length</p>
            <p className="text-xl font-bold text-primary">{totals.length.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-sm font-normal">mtr</span></p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Area</p>
            <p className="text-xl font-bold text-primary">{totals.sqm.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-sm font-normal">sqm</span></p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Weight</p>
            <p className="text-xl font-bold text-primary">{totals.kg.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-sm font-normal">kg</span></p>
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="text-muted-foreground text-center py-6">No slitting entries.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Manager</TableHead>
                  <TableHead>Cut Width</TableHead>
                  <TableHead className="text-right">Length (mtr)</TableHead>
                  <TableHead className="text-right">Area (sqm)</TableHead>
                  <TableHead className="text-right">Weight (kg)</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((e) => {
                  const t = computeTotals(e);
                  return (
                    <TableRow key={e.id}>
                      <TableCell>{format(new Date(e.date), "dd/MM/yy")}</TableCell>
                      <TableCell className="font-medium">{e.product_codes?.code ?? "—"}</TableCell>
                      <TableCell>{managers[e.slitting_manager_id] ?? "—"}</TableCell>
                      <TableCell>{e.cut_width_mm} mm</TableCell>
                      <TableCell className="text-right font-mono">{t.lengthMtr.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right font-mono">{t.sqm.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right font-mono">{t.kg > 0 ? t.kg.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</TableCell>
                      <TableCell className="text-muted-foreground text-xs max-w-xs truncate">{e.notes ?? "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
