import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, CheckCircle, Loader2, Trash2, ChevronDown, Package, Layers } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { UNIT_OPTIONS } from "@/lib/units";

interface ThicknessRow { thickness_mm: string; rolls_count: string; length_per_roll: string; width_per_roll: string; }

interface MaterialUsageRow {
  raw_material_id: string;
  quantity_used: string;
}

interface RawMaterial {
  id: string;
  name: string;
  unit: string;
  current_stock: number;
}

export default function ProductionEntry() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [productCodes, setProductCodes] = useState<{ id: string; code: string; category_id: string }[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);

  const [selectedCategory, setSelectedCategory] = useState("");
  const [form, setForm] = useState({
    date: format(new Date(), "yyyy-MM-dd"),
    product_code_id: "",
    client_id: "",
    rolls_count: "",
    length_per_roll: "",
    width_per_roll: "",
    unit: "meters",
    thickness_mm: "",
    gsm: "",
    notes: "",
    swelling_speed: "",
    swelling_height: "",
    tensile_strength: "",
    elongation: "",
    surface_resistance: "",
    lab_report_included: false,
    raw_material_included: false,
    copper_wire_count: "",
    rope_diameter_mm: "",
    bundles_count: "",
    bundles_per_pallet: "",
    weight_per_pallet: "",
  });

  // Rope multi-thickness rows (only used when category is Rope)
  const [thicknessRows, setThicknessRows] = useState<ThicknessRow[]>([]);

  const [newProductCode, setNewProductCode] = useState("");
  const [newProductCat, setNewProductCat] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [clientDialogOpen, setClientDialogOpen] = useState(false);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Optional raw material usage
  const [materialUsage, setMaterialUsage] = useState<MaterialUsageRow[]>([]);
  const [materialsOpen, setMaterialsOpen] = useState(false);

  const fetchData = async () => {
    const [codesRes, catsRes, clientsRes, matsRes] = await Promise.all([
      supabase.from("product_codes").select("id, code, category_id").eq("status", "active").order("code"),
      supabase.from("product_categories").select("id, name").eq("status", "active").order("name"),
      supabase.from("company_clients").select("id, name").eq("status", "active").order("name"),
      supabase.from("raw_materials").select("id, name, unit, current_stock").eq("status", "active").order("name"),
    ]);
    setProductCodes(codesRes.data ?? []);
    setCategories(catsRes.data ?? []);
    setClients(clientsRes.data ?? []);
    setRawMaterials(matsRes.data ?? []);
  };

  useEffect(() => { fetchData(); }, []);

  // Width is entered in millimeters; convert to meters for area calculations
  const qtyPerRoll = (Number(form.length_per_roll) || 0) * ((Number(form.width_per_roll) || 0) / 1000);
  const totalQuantity = (Number(form.rolls_count) || 0) * qtyPerRoll;

  const filteredProductCodes = selectedCategory
    ? productCodes.filter((p) => p.category_id === selectedCategory)
    : productCodes;

  const selectedCategoryName = categories.find((c) => c.id === selectedCategory)?.name?.toLowerCase() ?? "";
  const selectedProductCode = productCodes.find((p) => p.id === form.product_code_id)?.code?.toUpperCase() ?? "";
  const isFiberGlassSelection =
    selectedCategoryName.includes("fiber") ||
    selectedCategoryName.includes("fibre") ||
    selectedCategoryName.includes("glass") ||
    selectedCategoryName.includes("fgt") ||
    selectedProductCode.includes("FGT") ||
    selectedProductCode.includes("FIBER GLASS") ||
    selectedProductCode.includes("FIBRE GLASS");
  const isCopperTapeSelection =
    !isFiberGlassSelection &&
    (
      selectedCategoryName.includes("copper") ||
      selectedCategoryName.includes("semi cond") ||
      selectedCategoryName.includes("semicond") ||
      selectedCategoryName.includes("water block") ||
      selectedProductCode.includes("CWT") ||
      selectedProductCode.includes("SCT")
    );
  const isCwrSelection =
    selectedProductCode.includes("CWR") ||
    (selectedCategoryName.includes("rope") && selectedCategoryName.includes("water"));

  const handleCategoryChange = (catId: string) => {
    setSelectedCategory(catId);
    if (form.product_code_id) {
      const current = productCodes.find((p) => p.id === form.product_code_id);
      if (current && current.category_id !== catId) {
        setForm((f) => ({ ...f, product_code_id: "" }));
      }
    }
  };

  // Material usage helpers
  const addMaterialRow = () => {
    setMaterialUsage((prev) => [...prev, { raw_material_id: "", quantity_used: "" }]);
  };

  const updateMaterialRow = (index: number, field: keyof MaterialUsageRow, value: string) => {
    setMaterialUsage((prev) => prev.map((row, i) => i === index ? { ...row, [field]: value } : row));
  };

  const removeMaterialRow = (index: number) => {
    setMaterialUsage((prev) => prev.filter((_, i) => i !== index));
  };

  const usedMaterialIds = materialUsage.map((r) => r.raw_material_id).filter(Boolean);
  const getAvailableMaterials = (currentId: string) =>
    rawMaterials.filter((m) => m.id === currentId || !usedMaterialIds.includes(m.id));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !form.product_code_id) return;

    const categoryName = categories.find((c) => c.id === selectedCategory)?.name?.toLowerCase() ?? "";
    const isRope = categoryName.includes("rope");
    const validRopeRows = thicknessRows.filter((r) => r.thickness_mm && r.rolls_count && r.length_per_roll && r.width_per_roll);
    const useMultiThickness = isRope && validRopeRows.length > 0;

    if (!useMultiThickness && (!form.rolls_count || !form.length_per_roll || !form.width_per_roll)) return;

    setSubmitting(true);
    const validUsage = materialUsage.filter((r) => r.raw_material_id && Number(r.quantity_used) > 0);

    // Lab fields don't exist as columns in this DB — fold them into notes
    const labParts: string[] = [];
    if (form.gsm) labParts.push(`GSM: ${form.gsm}`);
    if (form.swelling_speed) labParts.push(`Swelling Speed: ${form.swelling_speed}`);
    if (form.swelling_height) labParts.push(`Swelling Height: ${form.swelling_height}`);
    if (form.tensile_strength) labParts.push(`Tensile: ${form.tensile_strength}`);
    if (form.elongation) labParts.push(`Elongation: ${form.elongation}`);
    if (form.surface_resistance) labParts.push(`Surface Resistance: ${form.surface_resistance}`);
    if (form.copper_wire_count) labParts.push(`Copper Wires: ${form.copper_wire_count}`);
    if ((form.raw_material_included || validUsage.length > 0) && validUsage.length === 0) {
      labParts.push("Raw Material Used: Yes");
    }
    if (form.rope_diameter_mm) labParts.push(`Rope Diameter: ${form.rope_diameter_mm} mm`);
    if (form.bundles_count) labParts.push(`Bundles: ${form.bundles_count}`);
    if (form.bundles_per_pallet) labParts.push(`Bundles/Pallet: ${form.bundles_per_pallet}`);
    if (form.weight_per_pallet) labParts.push(`Weight/Pallet: ${form.weight_per_pallet} kg`);

    const combinedNotes = [form.notes.trim(), labParts.join(" | ")].filter(Boolean).join(" || ");

    const baseExtras: Record<string, unknown> = {
      client_id: form.client_id || null,
      lab_report_included: form.lab_report_included,
      raw_material_included: form.raw_material_included || validUsage.length > 0,
    };
    if (combinedNotes) baseExtras.notes = combinedNotes;

    const rowsToInsert = useMultiThickness
      ? validRopeRows.map((r) => ({
          product_code_id: form.product_code_id,
          date: form.date,
          worker_id: user.id,
          rolls_count: Number(r.rolls_count),
          quantity_per_roll: Number(r.length_per_roll) * (Number(r.width_per_roll) / 1000),
          unit: form.unit,
          thickness_mm: Number(r.thickness_mm),
          ...baseExtras,
        }))
      : [{
          product_code_id: form.product_code_id,
          date: form.date,
          worker_id: user.id,
          rolls_count: Number(form.rolls_count),
          quantity_per_roll: Number(form.length_per_roll) * (Number(form.width_per_roll) / 1000),
          unit: form.unit,
          ...(form.thickness_mm ? { thickness_mm: Number(form.thickness_mm) } : {}),
          ...baseExtras,
        }];

    const { data: entries, error } = await supabase
      .from("production_entries")
      .insert(rowsToInsert as any)
      .select("id");

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }
    const entry = entries?.[0];
    if (!entry) {
      toast({ title: "Error", description: "Insert returned no rows", variant: "destructive" });
      setSubmitting(false);
      return;
    }

    // Insert optional raw material usage rows
    if (validUsage.length > 0) {
      const usageRows = validUsage.map((r) => ({
        production_entry_id: entry.id,
        raw_material_id: r.raw_material_id,
        quantity_used: Number(r.quantity_used),
      }));
      const { error: usageError } = await supabase.from("raw_material_usage").insert(usageRows);
      if (usageError) {
        toast({ title: "Warning", description: "Production saved but material usage failed: " + usageError.message, variant: "destructive" });
      }
    }

    setSubmitted(true);
    setTimeout(() => {
      setForm({ date: format(new Date(), "yyyy-MM-dd"), product_code_id: "", client_id: "", rolls_count: "", length_per_roll: "", width_per_roll: "", unit: "meters", thickness_mm: "", gsm: "", notes: "", swelling_speed: "", swelling_height: "", tensile_strength: "", elongation: "", surface_resistance: "", lab_report_included: false, raw_material_included: false, copper_wire_count: "", rope_diameter_mm: "", bundles_count: "", bundles_per_pallet: "", weight_per_pallet: "" });
      setThicknessRows([]);
      setSelectedCategory("");
      setMaterialUsage([]);
      setMaterialsOpen(false);
      setSubmitted(false);
    }, 2000);
    setSubmitting(false);
  };

  const addCategory = async () => {
    if (!newCategoryName.trim()) return;
    const { data, error } = await supabase.from("product_categories").insert({ name: newCategoryName.trim() }).select().single();
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Category added" });
    setCategoryDialogOpen(false);
    setNewCategoryName("");
    await fetchData();
    if (data) { setNewProductCat(data.id); setSelectedCategory(data.id); }
  };

  const addProductCode = async () => {
    if (!newProductCode.trim() || !newProductCat) return;
    const { data, error } = await supabase.from("product_codes").insert({ code: newProductCode.trim(), category_id: newProductCat }).select().single();
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Product code added" });
    setProductDialogOpen(false);
    setNewProductCode("");
    setNewProductCat("");
    await fetchData();
    if (data) { setSelectedCategory(data.category_id); setForm((f) => ({ ...f, product_code_id: data.id })); }
  };

  const addClient = async () => {
    if (!newClientName.trim()) return;
    const { data, error } = await supabase.from("company_clients").insert({ name: newClientName.trim() }).select().single();
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Client added" });
    setClientDialogOpen(false);
    setNewClientName("");
    await fetchData();
    if (data) setForm((f) => ({ ...f, client_id: data.id }));
  };

  if (submitted) {
    return (
      <Card className="max-w-lg mx-auto mt-8">
        <CardContent className="flex flex-col items-center py-12">
          <CheckCircle className="h-16 w-16 text-secondary mb-4" />
          <h2 className="text-xl font-bold">Entry Submitted!</h2>
          <p className="text-muted-foreground mt-1">Production entry recorded successfully.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-lg mx-auto">
      <CardHeader>
        <CardTitle>New Production Entry</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Date</Label>
            <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>Category</Label>
              <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
                <DialogTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" className="h-6 text-xs text-secondary"><Plus className="h-3 w-3 mr-1" /> Add New</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Add Product Category</DialogTitle></DialogHeader>
                  <div className="space-y-4">
                    <div><Label>Category Name</Label><Input value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="e.g. Semiconductor Woven Water Blocking Tape" /></div>
                    <Button type="button" onClick={addCategory} className="w-full bg-secondary hover:bg-secondary/90">Add</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <SearchableSelect
              value={selectedCategory}
              onValueChange={handleCategoryChange}
              placeholder="Select a category"
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>Product Code</Label>
              <Dialog open={productDialogOpen} onOpenChange={setProductDialogOpen}>
                <DialogTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" className="h-6 text-xs text-secondary"><Plus className="h-3 w-3 mr-1" /> Add New</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Add Product Code</DialogTitle></DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label>Category</Label>
                      <SearchableSelect
                        value={newProductCat}
                        onValueChange={setNewProductCat}
                        placeholder="Select category"
                        options={categories.map((c) => ({ value: c.id, label: c.name }))}
                      />
                    </div>
                    <div><Label>Code</Label><Input value={newProductCode} onChange={(e) => setNewProductCode(e.target.value)} placeholder="e.g. CHSCWWBT 18" /></div>
                    <Button type="button" onClick={addProductCode} className="w-full bg-secondary hover:bg-secondary/90">Add</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <SearchableSelect
              value={form.product_code_id}
              onValueChange={(v) => setForm({ ...form, product_code_id: v })}
              placeholder={selectedCategory ? "Select product code" : "Select a category first"}
              disabled={!selectedCategory}
              emptyText={selectedCategory ? "No products in this category" : "Select a category first"}
              options={filteredProductCodes.map((p) => ({ value: p.id, label: p.code }))}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>Client (Optional)</Label>
              <Dialog open={clientDialogOpen} onOpenChange={setClientDialogOpen}>
                <DialogTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" className="h-6 text-xs text-secondary"><Plus className="h-3 w-3 mr-1" /> Add New</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Add Client</DialogTitle></DialogHeader>
                  <div className="space-y-4">
                    <div><Label>Client Name</Label><Input value={newClientName} onChange={(e) => setNewClientName(e.target.value)} placeholder="e.g. ABC Industries" /></div>
                    <Button type="button" onClick={addClient} className="w-full bg-secondary hover:bg-secondary/90">Add</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <SearchableSelect
              value={form.client_id}
              onValueChange={(v) => setForm({ ...form, client_id: v })}
              placeholder="Select client (optional)"
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>


          {/* Rope multi-thickness panel */}
          {(() => {
            const catName = categories.find((c) => c.id === selectedCategory)?.name?.toLowerCase() ?? "";
            const isRope = catName.includes("rope");
            if (!isRope) return null;
            return (
              <div className="border border-border rounded-lg p-3 space-y-3 bg-muted/30">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold flex items-center gap-1"><Layers className="h-4 w-4" /> Multiple Thickness Rows</Label>
                  <Button type="button" variant="outline" size="sm" onClick={() => setThicknessRows((r) => [...r, { thickness_mm: "", rolls_count: "", length_per_roll: "", width_per_roll: "" }])}>
                    <Plus className="h-3 w-3 mr-1" /> Add
                  </Button>
                </div>
                {thicknessRows.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No rows. Use the fields below for a single thickness, or add rows to record multiple thicknesses in one entry.</p>
                ) : (
                  <div className="space-y-2">
                    {thicknessRows.map((row, idx) => (
                      <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 items-end">
                        <div>
                          {idx === 0 && <Label className="text-xs">Thickness (mm)</Label>}
                          <Input type="number" step="any" value={row.thickness_mm} className="h-9"
                            onChange={(e) => setThicknessRows((rs) => rs.map((r, i) => i === idx ? { ...r, thickness_mm: e.target.value } : r))} />
                        </div>
                        <div>
                          {idx === 0 && <Label className="text-xs">Rolls</Label>}
                          <Input type="number" step="any" value={row.rolls_count} className="h-9"
                            onChange={(e) => setThicknessRows((rs) => rs.map((r, i) => i === idx ? { ...r, rolls_count: e.target.value } : r))} />
                        </div>
                        <div>
                          {idx === 0 && <Label className="text-xs">Length / Roll (mtr)</Label>}
                          <Input type="number" step="any" value={row.length_per_roll} className="h-9"
                            onChange={(e) => setThicknessRows((rs) => rs.map((r, i) => i === idx ? { ...r, length_per_roll: e.target.value } : r))} />
                        </div>
                        <div>
                          {idx === 0 && <Label className="text-xs">Width / Roll (mm)</Label>}
                          <Input type="number" step="any" value={row.width_per_roll} className="h-9"
                            onChange={(e) => setThicknessRows((rs) => rs.map((r, i) => i === idx ? { ...r, width_per_roll: e.target.value } : r))} />
                        </div>
                        <Button type="button" variant="ghost" size="icon" className="h-9 w-9" onClick={() => setThicknessRows((rs) => rs.filter((_, i) => i !== idx))}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Number of Rolls</Label>
              <Input type="number" min="0" step="0.0001" value={form.rolls_count} onChange={(e) => setForm({ ...form, rolls_count: e.target.value })} placeholder="0" />
            </div>
            <div>
              <Label>Length / Roll (mtr)</Label>
              <Input type="number" min="0" step="0.0001" value={form.length_per_roll} onChange={(e) => setForm({ ...form, length_per_roll: e.target.value })} placeholder="0" />
            </div>
            <div>
              <Label>Width / Roll (mm)</Label>
              <Input type="number" min="0" step="0.0001" value={form.width_per_roll} onChange={(e) => setForm({ ...form, width_per_roll: e.target.value })} placeholder="0" />
            </div>
          </div>
          {(Number(form.length_per_roll) > 0 && Number(form.width_per_roll) > 0) && (
            <p className="text-xs text-muted-foreground -mt-2">Qty per roll (sqmtr) = {qtyPerRoll.toLocaleString(undefined, { maximumFractionDigits: 4 })}</p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Thickness (mm)</Label>
              <Input type="number" min="0" step="0.0001" value={form.thickness_mm} onChange={(e) => setForm({ ...form, thickness_mm: e.target.value })} placeholder="e.g. 0.25" />
            </div>
            <div>
              <Label>GSM</Label>
              <Input type="number" min="0" step="0.0001" value={form.gsm} onChange={(e) => setForm({ ...form, gsm: e.target.value })} placeholder="e.g. 80" />
            </div>
          </div>

          <div>
            <Label>Unit</Label>
            <Select value={form.unit} onValueChange={(v) => setForm({ ...form, unit: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {UNIT_OPTIONS.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Copper Tape flags (semi-cond / water blocking tape — NOT fiber glass) */}
          {(() => {
            if (!isCopperTapeSelection) return null;
            return (
              <div className="border border-border rounded-lg p-3 space-y-3 bg-muted/30">
                <Label className="text-sm font-semibold">Copper Tape Options</Label>
                <div className="space-y-1">
                  <Label className="text-xs">Lab report prepared here?</Label>
                  <Select value={form.lab_report_included ? "yes" : "no"}
                    onValueChange={(v) => setForm({ ...form, lab_report_included: v === "yes" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no">No</SelectItem>
                      <SelectItem value="yes">Yes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            );
          })()}

          {/* Fiber Glass Tape options */}
          {(() => {
            if (!isFiberGlassSelection) return null;
            return (
              <div className="border border-border rounded-lg p-3 space-y-3 bg-muted/30">
                <Label className="text-sm font-semibold">Fiber Glass Tape Options</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">No. of Copper Wires (woven)</Label>
                    <Input type="number" min="0" step="1" value={form.copper_wire_count}
                      onChange={(e) => setForm({ ...form, copper_wire_count: e.target.value })} placeholder="e.g. 12" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Raw material prepared here?</Label>
                    <Select value={form.raw_material_included ? "yes" : "no"}
                      onValueChange={(v) => setForm({ ...form, raw_material_included: v === "yes" })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="no">No</SelectItem>
                        <SelectItem value="yes">Yes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Water Blocking Rope (CWR) options */}
          {(() => {
            if (!isCwrSelection) return null;
            return (
              <div className="border border-border rounded-lg p-3 space-y-3 bg-muted/30">
                <Label className="text-sm font-semibold">Water Blocking Rope (CWR)</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Diameter of Rope (mm)</Label>
                    <Input type="number" min="0" step="0.0001" value={form.rope_diameter_mm}
                      onChange={(e) => setForm({ ...form, rope_diameter_mm: e.target.value })} placeholder="e.g. 4.5" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">No. of Bundles</Label>
                    <Input type="number" min="0" step="1" value={form.bundles_count}
                      onChange={(e) => setForm({ ...form, bundles_count: e.target.value })} placeholder="e.g. 10" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Bundles per Pallet</Label>
                    <Input type="number" min="0" step="1" value={form.bundles_per_pallet}
                      onChange={(e) => setForm({ ...form, bundles_per_pallet: e.target.value })} placeholder="e.g. 20" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Weight per Pallet (kg)</Label>
                    <Input type="number" min="0" step="0.0001" value={form.weight_per_pallet}
                      onChange={(e) => setForm({ ...form, weight_per_pallet: e.target.value })} placeholder="e.g. 250" />
                  </div>
                </div>
              </div>
            );
          })()}

          {(() => {
            const gsmVal = Number(form.gsm) || 0;
            const rolls = Number(form.rolls_count) || 0;
            const len = Number(form.length_per_roll) || 0;
            const wid = (Number(form.width_per_roll) || 0) / 1000; // mm -> m
            const sqm: number | null = rolls > 0 && len > 0 && wid > 0 ? rolls * len * wid : null;
            const mtr: number | null = rolls > 0 && len > 0 ? rolls * len : null;
            const kg: number | null = sqm !== null && gsmVal > 0 ? (sqm * gsmVal) / 1000 : null;
            const base = totalQuantity;
            const fmt = (n: number | null, u: string) =>
              n === null ? <span className="text-muted-foreground">—</span> : <>{n.toLocaleString(undefined, { maximumFractionDigits: 4 })} <span className="text-xs font-normal text-muted-foreground">{u}</span></>;
            return (
              <div className="bg-muted rounded-lg p-4 space-y-2">
                <p className="text-sm text-muted-foreground text-center">Total Quantity {thicknessRows.length > 0 ? "(single-row preview)" : ""}</p>
                <p className="text-3xl font-bold text-primary text-center">{base.toLocaleString(undefined, { maximumFractionDigits: 4 })} <span className="text-lg font-normal text-muted-foreground">{form.unit}</span></p>
                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border text-center">
                  <div><p className="text-xs text-muted-foreground">Meters</p><p className="text-base font-semibold">{fmt(mtr, "mtr")}</p></div>
                  <div><p className="text-xs text-muted-foreground">Square Meters</p><p className="text-base font-semibold">{fmt(sqm, "sqmtr")}</p></div>
                  <div><p className="text-xs text-muted-foreground">Kilograms</p><p className="text-base font-semibold">{fmt(kg, "kg")}</p></div>
                </div>
                {!gsmVal && (
                  <p className="text-xs text-center text-muted-foreground italic">Enter GSM to compute kg</p>
                )}
              </div>
            );
          })()}


         <div>
           <Label>Notes / Remarks (Optional)</Label>
           <Input
             value={form.notes}
             onChange={(e) => setForm({ ...form, notes: e.target.value })}
             placeholder="e.g. Single coated, Double coated, etc."
           />
         </div>

          {/* Lab Report Data */}
          {selectedCategory && (() => {
            const catName = categories.find(c => c.id === selectedCategory)?.name?.toLowerCase() || "";
            const isWaterBlocking = catName.includes("water block");
            const selectedCode = productCodes.find(p => p.id === form.product_code_id)?.code?.toUpperCase() || "";
            const surfaceResistanceCodes = ["CHCNW", "CHCWSCWBT", "CHN-WS", "CHN-TDM", "CHN-TDMS", "CHDSW", "CHSCWWBT", "CHSMWBT-F"];
            const needsSurfaceResistance = surfaceResistanceCodes.some(c => selectedCode.startsWith(c));
            return (
              <div className="border border-border rounded-lg p-4 space-y-3">
                <Label className="text-sm font-semibold">Lab Report (Optional)</Label>
                {isWaterBlocking && !needsSurfaceResistance ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs">Tensile Strength</Label>
                      <Input type="number" min="0" step="0.0001" value={form.tensile_strength} onChange={(e) => setForm({ ...form, tensile_strength: e.target.value })} placeholder="e.g. 45.0" />
                    </div>
                    <div>
                      <Label className="text-xs">Elongation</Label>
                      <Input type="number" min="0" step="0.0001" value={form.elongation} onChange={(e) => setForm({ ...form, elongation: e.target.value })} placeholder="e.g. 15.0" />
                    </div>
                    <div>
                      <Label className="text-xs">Swelling Speed</Label>
                      <Input type="number" min="0" step="0.0001" value={form.swelling_speed} onChange={(e) => setForm({ ...form, swelling_speed: e.target.value })} placeholder="e.g. 5.2" />
                    </div>
                    <div>
                      <Label className="text-xs">Swelling Height</Label>
                      <Input type="number" min="0" step="0.0001" value={form.swelling_height} onChange={(e) => setForm({ ...form, swelling_height: e.target.value })} placeholder="e.g. 12.5" />
                    </div>
                  </div>
                ) : needsSurfaceResistance ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs">Tensile Strength</Label>
                      <Input type="number" min="0" step="0.0001" value={form.tensile_strength} onChange={(e) => setForm({ ...form, tensile_strength: e.target.value })} placeholder="e.g. 45.0" />
                    </div>
                    <div>
                      <Label className="text-xs">Elongation</Label>
                      <Input type="number" min="0" step="0.0001" value={form.elongation} onChange={(e) => setForm({ ...form, elongation: e.target.value })} placeholder="e.g. 15.0" />
                    </div>
                    {isWaterBlocking && (
                      <>
                        <div>
                          <Label className="text-xs">Swelling Speed</Label>
                          <Input type="number" min="0" step="0.0001" value={form.swelling_speed} onChange={(e) => setForm({ ...form, swelling_speed: e.target.value })} placeholder="e.g. 5.2" />
                        </div>
                        <div>
                          <Label className="text-xs">Swelling Height</Label>
                          <Input type="number" min="0" step="0.0001" value={form.swelling_height} onChange={(e) => setForm({ ...form, swelling_height: e.target.value })} placeholder="e.g. 12.5" />
                        </div>
                      </>
                    )}
                    <div className="col-span-2">
                      <Label className="text-xs">Surface Resistance (Ω)</Label>
                      <Input type="number" min="0" step="0.0001" value={form.surface_resistance} onChange={(e) => setForm({ ...form, surface_resistance: e.target.value })} placeholder="e.g. 1000" />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs">Tensile Strength</Label>
                      <Input type="number" min="0" step="0.0001" value={form.tensile_strength} onChange={(e) => setForm({ ...form, tensile_strength: e.target.value })} placeholder="e.g. 45.0" />
                    </div>
                    <div>
                      <Label className="text-xs">Elongation</Label>
                      <Input type="number" min="0" step="0.0001" value={form.elongation} onChange={(e) => setForm({ ...form, elongation: e.target.value })} placeholder="e.g. 15.0" />
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Optional Raw Material Usage */}
          <Collapsible open={materialsOpen} onOpenChange={setMaterialsOpen}>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="outline" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Raw Materials Used (Optional)
                  {materialUsage.length > 0 && (
                    <span className="text-xs bg-secondary text-secondary-foreground rounded-full px-2 py-0.5">
                      {materialUsage.length}
                    </span>
                  )}
                </span>
                <ChevronDown className={`h-4 w-4 transition-transform ${materialsOpen ? "rotate-180" : ""}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-3">
              {materialUsage.map((row, idx) => {
                const mat = rawMaterials.find((m) => m.id === row.raw_material_id);
                return (
                  <div key={idx} className="flex items-end gap-2">
                    <div className="flex-1">
                      {idx === 0 && <Label className="text-xs">Material</Label>}
                      <Select value={row.raw_material_id} onValueChange={(v) => updateMaterialRow(idx, "raw_material_id", v)}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select material" />
                        </SelectTrigger>
                        <SelectContent>
                          {getAvailableMaterials(row.raw_material_id).map((m) => (
                            <SelectItem key={m.id} value={m.id}>{m.name} ({m.unit})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {mat && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Stock: {mat.current_stock.toLocaleString()} {mat.unit}
                        </p>
                      )}
                    </div>
                    <div className="w-24">
                      {idx === 0 && <Label className="text-xs">Qty</Label>}
                      <Input
                        type="number"
                        min="0"
                        step="0.001"
                        className="h-9 text-right"
                        value={row.quantity_used}
                        onChange={(e) => updateMaterialRow(idx, "quantity_used", e.target.value)}
                        placeholder="0"
                      />
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => removeMaterialRow(idx)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                );
              })}
              <Button type="button" variant="outline" size="sm" onClick={addMaterialRow} className="w-full">
                <Plus className="h-4 w-4 mr-1" /> Add Material
              </Button>
            </CollapsibleContent>
          </Collapsible>

          <Button type="submit" disabled={submitting} className="w-full bg-secondary hover:bg-secondary/90 text-lg py-6">
            {submitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
            Submit Entry
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
