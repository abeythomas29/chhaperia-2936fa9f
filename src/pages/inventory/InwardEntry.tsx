import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, CheckCircle, ArrowDownToLine } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface RawMaterial {
  id: string;
  name: string;
  unit: string;
  current_stock: number;
}

export default function InwardEntry() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [materialId, setMaterialId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [lotNumber, setLotNumber] = useState("");
  const [supplier, setSupplier] = useState("");
  const [pallets, setPallets] = useState("");
  const [thickness, setThickness] = useState("");
  const [gsm, setGsm] = useState("");
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Add new material dialog
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUnit, setNewUnit] = useState("kg");

  const fetchMaterials = async () => {
    const { data } = await supabase.from("raw_materials").select("id, name, unit, current_stock").eq("status", "active").order("name");
    setMaterials(data ?? []);
  };

  useEffect(() => { fetchMaterials(); }, []);

  const selectedMaterial = materials.find((m) => m.id === materialId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !materialId || !quantity) return;
    setSubmitting(true);

    const { error } = await supabase.from("raw_material_stock_entries").insert({
      raw_material_id: materialId,
      quantity: Number(quantity),
      date,
      lot_number: lotNumber.trim() || null,
      supplier: supplier.trim() || null,
      pallets: pallets ? Number(pallets) : null,
      thickness_mm: thickness ? Number(thickness) : null,
      gsm: gsm ? Number(gsm) : null,
      notes: notes || null,
      added_by: user.id,
    } as any);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    setSubmitted(true);
    setTimeout(() => {
      setMaterialId("");
      setQuantity("");
      setDate(format(new Date(), "yyyy-MM-dd"));
      setLotNumber("");
      setSupplier("");
      setPallets("");
      setThickness("");
      setGsm("");
      setNotes("");
      setSubmitted(false);
      fetchMaterials();
    }, 2000);
    setSubmitting(false);
  };

  const addMaterial = async () => {
    if (!newName.trim()) return;
    const { data, error } = await supabase.from("raw_materials").insert({ name: newName.trim(), unit: newUnit }).select().single();
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Material added" });
    setAddOpen(false);
    setNewName("");
    setNewUnit("kg");
    await fetchMaterials();
    if (data) setMaterialId(data.id);
  };

  if (submitted) {
    return (
      <Card className="max-w-lg mx-auto mt-8">
        <CardContent className="flex flex-col items-center py-12">
          <CheckCircle className="h-16 w-16 text-secondary mb-4" />
          <h2 className="text-xl font-bold">Stock Entry Recorded!</h2>
          <p className="text-muted-foreground mt-1">Inventory has been updated.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-lg mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowDownToLine className="h-5 w-5" />
          Add Inward Stock
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>Raw Material</Label>
              <Dialog open={addOpen} onOpenChange={setAddOpen}>
                <DialogTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" className="h-6 text-xs text-secondary">
                    <Plus className="h-3 w-3 mr-1" /> Add New
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Add Raw Material</DialogTitle></DialogHeader>
                  <div className="space-y-4">
                    <div><Label>Name</Label><Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. ALUMINIUM FOIL 009MIC" /></div>
                    <div>
                      <Label>Unit</Label>
                      <Select value={newUnit} onValueChange={setNewUnit}>
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
                    <Button onClick={addMaterial} className="w-full bg-secondary hover:bg-secondary/90">Add</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <Select value={materialId} onValueChange={setMaterialId}>
              <SelectTrigger><SelectValue placeholder="Select material" /></SelectTrigger>
              <SelectContent>
                {materials.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name} ({m.unit})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedMaterial && (
              <p className="text-xs text-muted-foreground mt-1">
                Current stock: {selectedMaterial.current_stock.toLocaleString()} {selectedMaterial.unit}
              </p>
            )}
          </div>

          <div>
            <Label>Quantity ({selectedMaterial?.unit ?? 'kg'})</Label>
            <Input type="number" min="0" step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" />
          </div>

          <div>
            <Label>Supplier / From</Label>
            <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g. Combined Origins Ltd" />
          </div>

          <div>
            <Label>Pallets / Pieces</Label>
            <Input type="number" min="0" step="1" value={pallets} onChange={(e) => setPallets(e.target.value)} placeholder="e.g. 29" />
          </div>

          <div>
            <Label>Lot Number</Label>
            <Input value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} placeholder="e.g. LOT-2025-001" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Thickness (mm, optional)</Label>
              <Input type="number" min="0" step="0.001" value={thickness} onChange={(e) => setThickness(e.target.value)} placeholder="e.g. 0.13" />
            </div>
            <div>
              <Label>GSM (optional)</Label>
              <Input type="number" min="0" step="0.01" value={gsm} onChange={(e) => setGsm(e.target.value)} placeholder="e.g. 80" />
            </div>
          </div>

          <div>
            <Label>Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. invoice #" />
          </div>

          <Button type="submit" disabled={submitting} className="w-full bg-secondary hover:bg-secondary/90 text-lg py-6">
            Record Stock Entry
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
