import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import StockManagement from "@/pages/admin/StockManagement";
import RawMaterials from "@/pages/admin/RawMaterials";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Warehouse, Boxes, Trash2 } from "lucide-react";

interface WastageRow {
  category_id: string | null;
  category_name: string;
  total_wastage: number;
  unit: string | null;
}

export default function InventoryManagement() {
  const { isAdmin, hasRole } = useAuth();
  const canEdit = isAdmin || hasRole("inventory_manager");
  const readOnly = !canEdit;

  const [wastage, setWastage] = useState<WastageRow[]>([]);

  useEffect(() => {
    if (!canEdit) return;
    (async () => {
      const { data } = await supabase.rpc("list_wastage_by_category", {
        _from: null,
        _to: null,
      });
      setWastage((data as WastageRow[]) ?? []);
    })();
  }, [canEdit]);

  return (
    <div className="space-y-6 w-full max-w-none">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Inventory Management</h1>
        {readOnly && (
          <span className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground">View only</span>
        )}
      </div>

      <div className="space-y-6">
        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Warehouse className="h-5 w-5 text-secondary" /> Finished Stock
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <StockManagement embedded readOnly={readOnly} />
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Boxes className="h-5 w-5 text-secondary" /> Raw Materials Inventory
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <RawMaterials embedded readOnly={readOnly} />
          </CardContent>
        </Card>
      </div>

      {canEdit && wastage.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Trash2 className="h-5 w-5 text-destructive" /> Total Wastage by Category
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {wastage.map((row) => (
                <div key={row.category_id ?? "none"} className="flex items-center justify-between py-2">
                  <span className="font-medium">{row.category_name}</span>
                  <span className="font-semibold text-destructive">
                    {Number(row.total_wastage).toLocaleString(undefined, { maximumFractionDigits: 2 })} {row.unit ?? ""}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
