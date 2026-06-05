import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CheckCircle, ShoppingCart } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { useLocation, useNavigate } from "react-router-dom";
import { getFinishedProductAvailable } from "@/lib/stock";

interface RawMaterial { id: string; name: string; unit: string; current_stock: number; }
interface ProductCode { id: string; code: string; }
interface Client { id: string; name: string; }

type ItemType = "raw_material" | "finished_product";

export default function SalesEntry() {
  const { user } = useAuth();
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [products, setProducts] = useState<ProductCode[]>([]);
  const [clients, setClients] = useState<Client[]>([]);

  const [tab, setTab] = useState<ItemType>("raw_material");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [clientId, setClientId] = useState("");
  const [manualClientName, setManualClientName] = useState("");
  const [useManualClient, setUseManualClient] = useState(false);
  const [materialId, setMaterialId] = useState("");
  const [productId, setProductId] = useState("");
  const [productAvailable, setProductAvailable] = useState<number | null>(null);
  const [loadingAvailable, setLoadingAvailable] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("kg");
  const [pricePerUnit, setPricePerUnit] = useState("");
  const [thickness, setThickness] = useState("");
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetchAll = async () => {
    const [m, p, c] = await Promise.all([
      supabase.from("raw_materials").select("id, name, unit, current_stock").eq("status", "active").order("name"),
      supabase.from("product_codes").select("id, code").eq("status", "active").order("code"),
      supabase.from("company_clients").select("id, name").eq("status", "active").order("name"),
    ]);
    setMaterials(m.data ?? []);
    setProducts(p.data ?? []);
    setClients(c.data ?? []);
  };

  useEffect(() => { fetchAll(); }, []);

  // Prefill when navigated from inventory view with a material
  useEffect(() => {
    const state = location.state as { materialId?: string; productId?: string; unit?: string } | null;
    if (state?.materialId) {
      setTab("raw_material");
      setMaterialId(state.materialId);
      if (state.unit) setUnit(state.unit);
      navigate(location.pathname, { replace: true });
    } else if (state?.productId) {
      setTab("finished_product");
      setProductId(state.productId);
      if (state.unit) setUnit(state.unit);
      navigate(location.pathname, { replace: true });
    }
  }, [location, navigate]);

  const selectedMaterial = materials.find((m) => m.id === materialId);

  // Auto-set unit when material changes
  useEffect(() => {
    if (selectedMaterial) setUnit(selectedMaterial.unit);
  }, [selectedMaterial]);

  // Fetch available stock for finished product
  useEffect(() => {
    if (tab !== "finished_product" || !productId) {
      setProductAvailable(null);
      return;
    }
    let cancelled = false;
    setLoadingAvailable(true);
    getFinishedProductAvailable(productId)
      .then((v) => { if (!cancelled) setProductAvailable(v); })
      .catch(() => { if (!cancelled) setProductAvailable(null); })
      .finally(() => { if (!cancelled) setLoadingAvailable(false); });
    return () => { cancelled = true; };
  }, [productId, tab]);

  const total = quantity && pricePerUnit ? Number(quantity) * Number(pricePerUnit) : 0;

  const reset = () => {
    setClientId("");
    setManualClientName("");
    setUseManualClient(false);
    setMaterialId("");
    setProductId("");
    setQuantity("");
    setPricePerUnit("");
    setThickness("");
    setNotes("");
    setDate(format(new Date(), "yyyy-MM-dd"));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!useManualClient && !clientId) {
      toast({ title: "Missing fields", description: "Please select a client or enter a name manually", variant: "destructive" });
      return;
    }
    if (useManualClient && !manualClientName.trim()) {
      toast({ title: "Missing fields", description: "Please enter the client name", variant: "destructive" });
      return;
    }
    if (!quantity || !pricePerUnit) {
      toast({ title: "Missing fields", description: "Quantity and price are required", variant: "destructive" });
      return;
    }
    if (tab === "raw_material" && !materialId) {
      toast({ title: "Select a material", variant: "destructive" });
      return;
    }
    if (tab === "finished_product" && !productId) {
      toast({ title: "Select a product code", variant: "destructive" });
      return;
    }

    setSubmitting(true);

    // Block over-issue: validate available stock before insert
    const qtyNum = Number(quantity);
    if (tab === "raw_material" && selectedMaterial && qtyNum > Number(selectedMaterial.current_stock)) {
      toast({
        title: "Insufficient stock",
        description: `Only ${Number(selectedMaterial.current_stock).toLocaleString()} ${selectedMaterial.unit} available`,
        variant: "destructive",
      });
      setSubmitting(false);
      return;
    }
    if (tab === "finished_product") {
      const available = await getFinishedProductAvailable(productId);
      if (qtyNum > available) {
        toast({
          title: "Insufficient stock",
          description: `Only ${available.toLocaleString()} ${unit} available for this product`,
          variant: "destructive",
        });
        setSubmitting(false);
        return;
      }
    }

    const { error } = await supabase.from("sales").insert({
      date,
      client_id: useManualClient ? null : clientId,
      client_name: useManualClient ? manualClientName.trim() : null,
      item_type: tab,
      raw_material_id: tab === "raw_material" ? materialId : null,
      product_code_id: tab === "finished_product" ? productId : null,
      quantity: Number(quantity),
      unit,
      price_per_unit: Number(pricePerUnit),
      thickness_mm: thickness ? Number(thickness) : null,
      notes: notes.trim() || null,
      sold_by: user.id,
    } as any);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    setSubmitted(true);
    setTimeout(() => {
      reset();
      setSubmitted(false);
      fetchAll();
    }, 1800);
    setSubmitting(false);
  };

  if (submitted) {
    return (
      <Card className="max-w-lg mx-auto mt-8">
        <CardContent className="flex flex-col items-center py-12">
          <CheckCircle className="h-16 w-16 text-secondary mb-4" />
          <h2 className="text-xl font-bold">Sale Recorded!</h2>
          <p className="text-muted-foreground mt-1">
            {tab === "raw_material" ? "Stock has been deducted." : "Sale logged successfully."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-lg mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5" />
          Record Sale
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={(v) => setTab(v as ItemType)} className="mb-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="raw_material">Raw Material</TabsTrigger>
            <TabsTrigger value="finished_product">Finished Product</TabsTrigger>
          </TabsList>
        </Tabs>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div>
            <Label>Client</Label>
            <div className="flex items-center gap-2 mb-2">
              <Button
                type="button"
                variant={!useManualClient ? "default" : "outline"}
                size="sm"
                onClick={() => { setUseManualClient(false); setManualClientName(""); }}
              >
                Select from list
              </Button>
              <Button
                type="button"
                variant={useManualClient ? "default" : "outline"}
                size="sm"
                onClick={() => { setUseManualClient(true); setClientId(""); }}
              >
                Enter manually
              </Button>
            </div>
            {!useManualClient ? (
              <SearchableSelect
                value={clientId}
                onValueChange={setClientId}
                placeholder="Select client"
                options={clients.map((c) => ({ value: c.id, label: c.name }))}
              />
            ) : (
              <Input
                value={manualClientName}
                onChange={(e) => setManualClientName(e.target.value)}
                placeholder="Type client name"
              />
            )}
          </div>

          {tab === "raw_material" ? (
            <div>
              <Label>Raw Material</Label>
              <Select value={materialId} onValueChange={setMaterialId}>
                <SelectTrigger><SelectValue placeholder="Select material" /></SelectTrigger>
                <SelectContent>
                  {materials.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} — {m.current_stock.toLocaleString()} {m.unit}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedMaterial && (
                <p className="text-xs text-muted-foreground mt-1">
                  Available: {selectedMaterial.current_stock.toLocaleString()} {selectedMaterial.unit}
                </p>
              )}
            </div>
          ) : (
            <div>
              <Label>Product Code</Label>
              <SearchableSelect
                value={productId}
                onValueChange={setProductId}
                placeholder="Select product"
                options={products.map((p) => ({ value: p.id, label: p.code }))}
              />
              {productId && (
                <p className="text-xs text-muted-foreground mt-1">
                  {loadingAvailable
                    ? "Checking available stock…"
                    : productAvailable !== null
                      ? `Available: ${productAvailable.toLocaleString()} ${unit}`
                      : "Availability unknown"}
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Quantity ({unit})</Label>
              <Input type="number" min="0" step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" />
            </div>
            <div>
              <Label>Unit</Label>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="kg">Kilograms (kg)</SelectItem>
                  <SelectItem value="meters">Meters</SelectItem>
                  <SelectItem value="rolls">Rolls</SelectItem>
                  <SelectItem value="pieces">Pieces</SelectItem>
                  <SelectItem value="liters">Liters</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Price per {unit}</Label>
            <Input type="number" min="0" step="0.01" value={pricePerUnit} onChange={(e) => setPricePerUnit(e.target.value)} placeholder="0.00" />
          </div>

          {total > 0 && (
            <div className="rounded-md bg-muted px-3 py-2 text-sm font-medium">
              Total: <span className="font-mono">{total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          )}

          <div>
            <Label>Thickness (mm, optional)</Label>
            <Input type="number" min="0" step="0.001" value={thickness} onChange={(e) => setThickness(e.target.value)} placeholder="e.g. 0.13" />
          </div>

          <div>
            <Label>Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="invoice #, dispatch ref, etc." />
          </div>

          <Button type="submit" disabled={submitting} className="w-full bg-secondary hover:bg-secondary/90 text-lg py-6">
            {submitting ? "Recording…" : "Record Sale"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
