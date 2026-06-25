import { Fragment, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Package, ArrowDownToLine, ArrowUpFromLine, Search, Pencil, Trash2, ChevronRight, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

interface RawMaterial {
  id: string;
  name: string;
  unit: string;
  current_stock: number;
  status: string;
}

interface StockEntry {
  id: string;
  raw_material_id: string;
  quantity: number;
  date: string;
  lot_number: string | null;
  supplier: string | null;
  pallets: number | null;
  pallet_count?: number | null;
  roll_count?: number | null;
  thickness_mm: number | null;
  gsm: number | null;
  notes: string | null;
  added_by: string;
  created_at: string;
  entry_type?: string | null;
  issue_unit?: string | null;
  issue_quantity?: number | null;
  issue_quantity_kg?: number | null;
  issued_to_user_id?: string | null;
  kind?: "in" | "out" | "issue";
  // Source of the row (which table it came from) + original primary key in that table.
  source?: "rmse" | "stock_issue" | "sale";
  source_id?: string;
}

interface RecipientOption {
  user_id: string;
  name: string;
}


interface RawMaterialsProps {
  embedded?: boolean;
  readOnly?: boolean;
}

export default function RawMaterials({ embedded = false, readOnly = false }: RawMaterialsProps = {}) {
  const { user, isAdmin, isSuperAdmin, isInventoryManager, role: currentUserRole } = useAuth();
  const canManageEntries = isAdmin || isSuperAdmin || isInventoryManager;
  const { toast } = useToast();
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [stockEntries, setStockEntries] = useState<(StockEntry & { material_name?: string; material_unit?: string; person_name?: string })[]>([]);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [stockOpen, setStockOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [expandedMaterials, setExpandedMaterials] = useState<Set<string>>(new Set());

  const [newName, setNewName] = useState("");
  const [newUnit, setNewUnit] = useState("kg");

  const [editMaterial, setEditMaterial] = useState<RawMaterial | null>(null);
  const [editName, setEditName] = useState("");
  const [editUnit, setEditUnit] = useState("");

  // Stock entry edit/delete state
  const [editEntryOpen, setEditEntryOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<StockEntry | null>(null);
  const [eMaterialId, setEMaterialId] = useState("");
  const [eQty, setEQty] = useState("");
  const [eDate, setEDate] = useState("");
  const [eLot, setELot] = useState("");
  const [eSupplier, setESupplier] = useState("");
  const [ePallets, setEPallets] = useState("");
  const [eThickness, setEThickness] = useState("");
  const [eGsm, setEGsm] = useState("");
  const [eNotes, setENotes] = useState("");
  const [deleteEntryId, setDeleteEntryId] = useState<string | null>(null);

  const [stockMaterialId, setStockMaterialId] = useState("");
  const [stockQty, setStockQty] = useState("");
  const [stockDate, setStockDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [stockLot, setStockLot] = useState("");
  const [stockSupplier, setStockSupplier] = useState("");
  const [stockPackType, setStockPackType] = useState<"pallet" | "roll">("pallet");
  const [stockPackCount, setStockPackCount] = useState("");
  const [stockThickness, setStockThickness] = useState("");
  const [stockGsm, setStockGsm] = useState("");
  const [stockNotes, setStockNotes] = useState("");

  // Issue Material state
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueMaterialId, setIssueMaterialId] = useState("");
  const [issueUnit, setIssueUnit] = useState<"kg" | "sqm">("kg");
  const [issueQty, setIssueQty] = useState("");
  const [issueGsm, setIssueGsm] = useState("");
  const [issueThickness, setIssueThickness] = useState("");
  const [issueLot, setIssueLot] = useState("");
  const [issueVariantKey, setIssueVariantKey] = useState("");
  const [issueDate, setIssueDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [issueRecipientId, setIssueRecipientId] = useState("");
  const [issueNotes, setIssueNotes] = useState("");
  const [recipients, setRecipients] = useState<RecipientOption[]>([]);

  const fetchData = async () => {
    const [matRes, entryRes, saleRes, recipRes, issueRes] = await Promise.all([
      supabase.from("raw_materials").select("*").order("name"),
      supabase.from("raw_material_stock_entries").select("*").order("created_at", { ascending: false }).limit(2000),
      supabase
        .from("sales")
        .select("id, raw_material_id, quantity, date, notes, thickness_mm, sold_by, client_name, client_id, created_at")
        .eq("item_type", "raw_material")
        .order("created_at", { ascending: false })
        .limit(2000),
      supabase.rpc("list_production_manager_recipients"),
      // Raw material issues live in stock_issues — fetch them directly.
      supabase
        .from("stock_issues")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(2000),
    ]);
    if (issueRes.error) {
      console.error("stock_issues fetch error", issueRes.error);
      toast({ title: "Could not load stock issues", description: issueRes.error.message, variant: "destructive" });
    }
    setMaterials(matRes.data ?? []);
    setRecipients((recipRes.data as RecipientOption[]) ?? []);

    const rawEntries = (entryRes.data ?? []) as any[];
    const inwardEntries: StockEntry[] = rawEntries.map((e) => {
      const isOut = e.entry_type === "out" || e.entry_type === "issue" || e.entry_kind === "out";
      return {
        ...e,
        kind: (isOut ? "issue" : "in") as "in" | "issue",
        source: "rmse" as const,
        source_id: e.id,
      };
    });

    const salesRows = (saleRes.data ?? []) as any[];

    // Convert stock_issues (raw_material) → "out" entries in kg.
    const stockIssueRows = ((issueRes.data ?? []) as any[])
      .filter((r) => {
        const t = r.issue_type ?? (r.raw_material_id ? "raw_material" : "finished_stock");
        return t === "raw_material" && r.raw_material_id;
      });
    // eslint-disable-next-line no-console
    console.log("Raw material stock_issues rows", stockIssueRows.length, stockIssueRows);
    const issueOutEntries: StockEntry[] = stockIssueRows.map((r) => {
      const unit = r.issue_unit ?? r.unit ?? "kg";
      const qty = Number(r.issue_quantity ?? r.quantity ?? 0);
      const gsm = r.gsm != null ? Number(r.gsm) : null;
      let kg = 0;
      if (r.issue_quantity_kg != null) kg = Number(r.issue_quantity_kg);
      else if (unit === "kg") kg = qty;
      else if (unit === "sqm" && gsm && gsm > 0) kg = (qty * gsm) / 1000;
      else kg = qty; // best-effort fallback
      return {
        id: `si-${r.id}`,
        raw_material_id: r.raw_material_id,
        quantity: kg,
        date: r.date ?? r.created_at,
        lot_number: r.lot_number ?? null,
        supplier: null,
        pallets: null,
        thickness_mm: r.thickness_mm,
        gsm,
        notes: r.notes ?? null,
        added_by: r.issued_by,
        created_at: r.created_at,
        entry_type: "issue",
        issue_unit: unit,
        issue_quantity: qty,
        issued_to_user_id: r.issued_to_user_id ?? r.recipient_user_id ?? null,
        kind: "issue",
        source: "stock_issue",
        source_id: r.id,
      };
    });

    // De-duplicate: if a raw_material_stock_entries row already exists for the same issue
    // (legacy double-write), avoid double-counting. Match by issued_to_user_id + date + qty.
    const dedupKey = (e: StockEntry) => `${e.raw_material_id}|${e.date}|${e.issued_to_user_id ?? ""}|${Number(e.quantity).toFixed(2)}`;
    const inwardOutKeys = new Set(
      inwardEntries.filter((e) => e.kind === "issue").map(dedupKey),
    );

    const issueOutDeduped = issueOutEntries.filter((e) => !inwardOutKeys.has(dedupKey(e)));

    // Resolve client names for sales (some sales reference company_clients by id)
    const clientIds = [...new Set(salesRows.map((s) => s.client_id).filter(Boolean))];
    let clientMap = new Map<string, string>();
    if (clientIds.length > 0) {
      const { data: clients } = await supabase.from("company_clients").select("id, name").in("id", clientIds);
      clientMap = new Map((clients ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));
    }

    const outwardEntries: StockEntry[] = salesRows
      .filter((s) => s.raw_material_id)
      .map((s) => ({
        id: `sale-${s.id}`,
        raw_material_id: s.raw_material_id,
        quantity: Number(s.quantity) || 0,
        date: s.date,
        lot_number: null,
        supplier: clientMap.get(s.client_id) ?? s.client_name ?? null,
        pallets: null,
        thickness_mm: s.thickness_mm,
        gsm: null,
        notes: s.notes ? `Sale: ${s.notes}` : "Sale",
        added_by: s.sold_by,
        created_at: s.created_at,
        kind: "out",
      }));

    const allEntries = [...inwardEntries, ...issueOutDeduped, ...outwardEntries]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // Debug: per-material Out totals (kg)
    const outTotals = new Map<string, number>();
    for (const e of allEntries) {
      if (e.kind === "out" || e.kind === "issue") {
        outTotals.set(e.raw_material_id, (outTotals.get(e.raw_material_id) ?? 0) + Number(e.quantity || 0));
      }
    }
    // eslint-disable-next-line no-console
    console.log("Out for raw materials", Object.fromEntries(outTotals));

    // Resolve names
    const materialMap = new Map((matRes.data ?? []).map((m: RawMaterial) => [m.id, m]));
    const userIds = [...new Set([
      ...allEntries.map((e) => e.added_by).filter(Boolean),
      ...allEntries.map((e) => e.issued_to_user_id).filter(Boolean) as string[],
    ])];
    let profileMap = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await supabase.from("profiles").select("user_id, name").in("user_id", userIds);
      profileMap = new Map((profiles ?? []).map((p: { user_id: string; name: string }) => [p.user_id, p.name]));
    }
    setStockEntries(allEntries.map((e) => ({
      ...e,
      material_name: materialMap.get(e.raw_material_id)?.name ?? "Unknown",
      material_unit: materialMap.get(e.raw_material_id)?.unit ?? "",
      person_name: profileMap.get(e.added_by) ?? "Unknown",
      // For "issue" rows, prefer showing recipient as the supplier/from column
      supplier: (e.kind === "issue" || e.kind === "out") && e.issued_to_user_id
        ? `→ ${profileMap.get(e.issued_to_user_id) ?? "Recipient"}`
        : e.supplier,
    })));
  };


  useEffect(() => { fetchData(); }, []);

  const q = search.trim().toLowerCase();
  const filtered = materials.filter((m) => m.name.toLowerCase().includes(q));

  const filteredEntries = stockEntries.filter((e) => {
    if (dateFrom && e.date < dateFrom) return false;
    if (dateTo && e.date > dateTo) return false;
    if (!q) return true;
    return (
      (e.material_name ?? "").toLowerCase().includes(q) ||
      (e.supplier ?? "").toLowerCase().includes(q) ||
      (e.lot_number ?? "").toLowerCase().includes(q) ||
      (e.notes ?? "").toLowerCase().includes(q) ||
      (e.person_name ?? "").toLowerCase().includes(q)
    );
  });

  const addMaterial = async () => {
    if (!newName.trim()) return;
    const { error } = await supabase.from("raw_materials").insert({ name: newName.trim(), unit: newUnit });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Raw material added" });
    setAddOpen(false);
    setNewName("");
    setNewUnit("kg");
    fetchData();
  };

  const saveEdit = async () => {
    if (!editMaterial || !editName.trim()) return;
    const { error } = await supabase.from("raw_materials").update({ name: editName.trim(), unit: editUnit }).eq("id", editMaterial.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Updated" });
    setEditOpen(false);
    setEditMaterial(null);
    fetchData();
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    // Check dependencies
    const { count } = await supabase.from("product_recipes").select("id", { count: "exact", head: true }).eq("raw_material_id", deleteId);
    if ((count ?? 0) > 0) {
      toast({ title: "Cannot delete", description: "This material is used in product recipes.", variant: "destructive" });
      setDeleteId(null);
      return;
    }
    const { error } = await supabase.from("raw_materials").delete().eq("id", deleteId);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Deleted" });
    setDeleteId(null);
    fetchData();
  };

  const addStockEntry = async () => {
    if (!stockMaterialId || !stockQty || !user) return;
    const packNum = stockPackCount ? Number(stockPackCount) : null;
    const { error } = await supabase.from("raw_material_stock_entries").insert({
      raw_material_id: stockMaterialId,
      quantity: Number(stockQty),
      date: stockDate,
      lot_number: stockLot.trim() || null,
      supplier: stockSupplier.trim() || null,
      pallets: packNum,
      pallet_count: stockPackType === "pallet" ? packNum : null,
      roll_count: stockPackType === "roll" ? packNum : null,
      thickness_mm: stockThickness ? Number(stockThickness) : null,
      gsm: stockGsm ? Number(stockGsm) : null,
      notes: stockNotes || null,
      added_by: user.id,
    } as any);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Stock added" });
    setStockOpen(false);
    setStockMaterialId("");
    setStockQty("");
    setStockLot("");
    setStockSupplier("");
    setStockPackType("pallet");
    setStockPackCount("");
    setStockThickness("");
    setStockGsm("");
    setStockNotes("");
    fetchData();
  };

  // Auto-fill GSM from latest stock entry for selected material (GSM is fixed by raw material entry).
  // Reset variant selection when material changes.
  useEffect(() => {
    if (!issueMaterialId) {
      setIssueGsm(""); setIssueThickness(""); setIssueLot(""); setIssueVariantKey("");
      return;
    }
    const latest = stockEntries
      .filter((e) => e.raw_material_id === issueMaterialId && e.kind === "in")
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
    setIssueGsm(latest?.gsm != null ? String(latest.gsm) : "");
    setIssueThickness("");
    setIssueLot("");
    setIssueVariantKey("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueMaterialId]);

  // Build available variants for the selected material: group inward by (lot, thickness, gsm)
  // and subtract issued/sales attributable to that exact lot. Issue rows with null lot are
  // attributed only when a single inward lot matches their (thickness, gsm).
  type Variant = {
    key: string;
    lot: string | null;
    thickness: number | null;
    gsm: number | null;
    inKg: number;
    outKg: number;
    balanceKg: number;
    packCount: number;
    packType: "pallet" | "roll" | null;
  };
  const availableVariants = ((): Variant[] => {
    if (!issueMaterialId) return [];
    const mat = stockEntries.filter((e) => e.raw_material_id === issueMaterialId);
    const ins = mat.filter((e) => e.kind === "in");
    const outs = mat.filter((e) => e.kind === "out" || e.kind === "issue");
    const map = new Map<string, Variant>();
    const keyOf = (lot: string | null, t: number | null, g: number | null) =>
      `${lot ?? "-"}|${t ?? "-"}|${g ?? "-"}`;
    ins.forEach((e) => {
      const lot = e.lot_number?.trim() || null;
      const t = e.thickness_mm != null ? Number(e.thickness_mm) : null;
      const g = e.gsm != null ? Number(e.gsm) : null;
      const k = keyOf(lot, t, g);
      const v = map.get(k) ?? { key: k, lot, thickness: t, gsm: g, inKg: 0, outKg: 0, balanceKg: 0, packCount: 0, packType: null };
      v.inKg += Number(e.quantity) || 0;
      const pc = (e as any).pallet_count != null ? Number((e as any).pallet_count) : null;
      const rc = (e as any).roll_count != null ? Number((e as any).roll_count) : null;
      if (pc != null && pc > 0) { v.packCount += pc; v.packType = v.packType ?? "pallet"; }
      else if (rc != null && rc > 0) { v.packCount += rc; v.packType = v.packType ?? "roll"; }
      else if (e.pallets != null && Number(e.pallets) > 0) { v.packCount += Number(e.pallets); v.packType = v.packType ?? "pallet"; }
      map.set(k, v);
    });
    // Attribute outs
    outs.forEach((e) => {
      const lot = e.lot_number?.trim() || null;
      const t = e.thickness_mm != null ? Number(e.thickness_mm) : null;
      const g = e.gsm != null ? Number(e.gsm) : null;
      const qty = Number(e.quantity) || 0;
      if (lot) {
        const k = keyOf(lot, t, g);
        const v = map.get(k);
        if (v) { v.outKg += qty; return; }
      }
      // Backward-compat: match by (thickness, gsm) when exactly one inward lot fits
      const candidates = Array.from(map.values()).filter((v) =>
        (t == null || v.thickness === t) && (g == null || v.gsm === g),
      );
      if (candidates.length === 1) {
        candidates[0].outKg += qty;
      } else {
        const k = keyOf(null, t, g);
        const v = map.get(k) ?? { key: k, lot: null, thickness: t, gsm: g, inKg: 0, outKg: 0, balanceKg: 0, packCount: 0, packType: null };
        v.outKg += qty;
        map.set(k, v);
      }
    });
    return Array.from(map.values())
      .map((v) => ({ ...v, balanceKg: v.inKg - v.outKg }))
      .filter((v) => v.inKg > 0)
      .sort((a, b) => (a.thickness ?? Infinity) - (b.thickness ?? Infinity));
  })();

  const selectedVariant = availableVariants.find((v) => v.key === issueVariantKey) || null;

  const resetIssueForm = () => {
    setIssueMaterialId("");
    setIssueUnit("kg");
    setIssueQty("");
    setIssueGsm("");
    setIssueThickness("");
    setIssueLot("");
    setIssueVariantKey("");
    setIssueDate(format(new Date(), "yyyy-MM-dd"));
    setIssueRecipientId("");
    setIssueNotes("");
  };

  const issueMaterial = async () => {
    if (!user) return;
    if (!issueMaterialId || !issueQty) {
      toast({ title: "Missing fields", description: "Pick a material and enter a quantity.", variant: "destructive" });
      return;
    }
    const qty = Number(issueQty);
    if (!isFinite(qty) || qty <= 0) {
      toast({ title: "Invalid quantity", variant: "destructive" });
      return;
    }
    let qtyKg = qty;
    let gsmNum: number | null = issueGsm ? Number(issueGsm) : null;
    if (issueUnit === "sqm") {
      if (!gsmNum || gsmNum <= 0) {
        toast({ title: "GSM required", description: "GSM is required to issue in sqm.", variant: "destructive" });
        return;
      }
      qtyKg = (qty * gsmNum) / 1000;
    }
    if (availableVariants.length > 0 && !selectedVariant) {
      toast({ title: "Select variant", description: "Pick the exact lot/variant to issue from.", variant: "destructive" });
      return;
    }
    if (selectedVariant && qtyKg > selectedVariant.balanceKg + 1e-6) {
      toast({
        title: "Exceeds lot balance",
        description: `Lot ${selectedVariant.lot ?? "—"} has only ${selectedVariant.balanceKg.toFixed(2)} kg available.`,
        variant: "destructive",
      });
      return;
    }
    const material = materials.find((m) => m.id === issueMaterialId);
    if (material && Number(material.current_stock) < qtyKg) {
      toast({
        title: "Insufficient stock",
        description: `Only ${Number(material.current_stock).toLocaleString()} ${material.unit} available; trying to deduct ${qtyKg.toFixed(2)} kg.`,
        variant: "destructive",
      });
      return;
    }
    const lotToSave = selectedVariant?.lot ?? (issueLot.trim() || null);
    const thicknessToSave = selectedVariant?.thickness ?? (issueThickness ? Number(issueThickness) : null);
    const gsmToSave = selectedVariant?.gsm ?? gsmNum;
    const sqmValue = issueUnit === "sqm" ? qty : (gsmToSave && gsmToSave > 0 ? (qtyKg * 1000) / gsmToSave : null);
    const { error } = await supabase.from("raw_material_stock_entries").insert({
      raw_material_id: issueMaterialId,
      quantity: qtyKg,
      issue_quantity: qty,
      issue_unit: issueUnit,
      date: issueDate,
      lot_number: lotToSave,
      thickness_mm: thicknessToSave,
      gsm: gsmToSave,
      notes: issueNotes || null,
      added_by: user.id,
      entry_type: "issue",
      entry_kind: "out",
      issued_to_user_id: issueRecipientId || null,
    } as any);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    // Also record in stock_issues so the Issued panel and reports can read it.
    if (issueRecipientId) {
      const { error: siErr } = await supabase.from("stock_issues").insert({
        raw_material_id: issueMaterialId,
        issue_type: "raw_material",
        recipient_type: "production_manager",
        recipient_user_id: issueRecipientId,
        issued_to_user_id: issueRecipientId,
        quantity: qtyKg,
        unit: "kg",
        issue_quantity: qty,
        issue_unit: issueUnit,
        issue_quantity_kg: qtyKg,
        issue_quantity_sqm: sqmValue,
        gsm: gsmToSave,
        thickness_mm: thicknessToSave,
        lot_number: lotToSave,
        notes: issueNotes || null,
        issued_by: user.id,
        date: issueDate,
      } as any);
      if (siErr) {
        // eslint-disable-next-line no-console
        console.error("stock_issues mirror insert failed", siErr);
        toast({
          title: "Issued but not mirrored",
          description: `Stock decremented, but Issued panel mirror failed: ${siErr.message}`,
          variant: "destructive",
        });
      }
    }
    try {
      Object.keys(localStorage)
        .filter((k) => /inventory|stock|issued/i.test(k))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      // ignore
    }
    toast({ title: "Material issued", description: `Deducted ${qtyKg.toFixed(2)} kg from inventory.` });
    setIssueOpen(false);
    resetIssueForm();
    fetchData();
  };

  const openEdit = (m: RawMaterial) => {
    setEditMaterial(m);
    setEditName(m.name);
    setEditUnit(m.unit);
    setEditOpen(true);
  };

  const openEditEntry = (e: StockEntry) => {
    setEditEntry(e);
    setEMaterialId(e.raw_material_id);
    setEQty(String(e.quantity));
    setEDate(e.date);
    setELot(e.lot_number ?? "");
    setESupplier(e.supplier ?? "");
    setEPallets(e.pallets != null ? String(e.pallets) : "");
    setEThickness(e.thickness_mm != null ? String(e.thickness_mm) : "");
    setEGsm(e.gsm != null ? String(e.gsm) : "");
    setENotes(e.notes ?? "");
    setEditEntryOpen(true);
  };

  const saveEntryEdit = async () => {
    if (!editEntry || !eMaterialId || !eQty) return;
    const { error } = await supabase.from("raw_material_stock_entries").update({
      raw_material_id: eMaterialId,
      quantity: Number(eQty),
      date: eDate,
      lot_number: eLot.trim() || null,
      supplier: eSupplier.trim() || null,
      pallets: ePallets ? Number(ePallets) : null,
      thickness_mm: eThickness ? Number(eThickness) : null,
      gsm: eGsm ? Number(eGsm) : null,
      notes: eNotes || null,
    } as any).eq("id", editEntry.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Stock entry updated" });
    setEditEntryOpen(false);
    setEditEntry(null);
    fetchData();
  };

  const confirmDeleteEntry = async () => {
    if (!deleteEntryId) return;
    const { error } = await supabase.from("raw_material_stock_entries").delete().eq("id", deleteEntryId);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Stock entry deleted" });
    setDeleteEntryId(null);
    fetchData();
  };

  const actionButtons = !readOnly ? (
    <div className="flex flex-wrap gap-2">
      <Dialog open={stockOpen} onOpenChange={setStockOpen}>
        <DialogTrigger asChild>
          <Button variant="outline"><ArrowDownToLine className="h-4 w-4 mr-2" />Add Stock</Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Stock (Purchase)</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Raw Material</Label>
              <Select value={stockMaterialId} onValueChange={setStockMaterialId}>
                <SelectTrigger><SelectValue placeholder="Select material" /></SelectTrigger>
                <SelectContent>{materials.filter(m => m.status === "active").map((m) => <SelectItem key={m.id} value={m.id}>{m.name} ({m.unit})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Quantity ({materials.find(m => m.id === stockMaterialId)?.unit ?? 'kg'})</Label>
              <Input type="number" min="0" step="0.01" value={stockQty} onChange={(e) => setStockQty(e.target.value)} placeholder="0" />
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={stockDate} onChange={(e) => setStockDate(e.target.value)} />
            </div>
            <div>
              <Label>Lot Number</Label>
              <Input value={stockLot} onChange={(e) => setStockLot(e.target.value)} placeholder="e.g. LOT-2025-001" />
            </div>
            <div>
              <Label>Supplier / From</Label>
              <Input value={stockSupplier} onChange={(e) => setStockSupplier(e.target.value)} placeholder="e.g. Combined Origins Ltd" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Pack Type</Label>
                <Select value={stockPackType} onValueChange={(v) => setStockPackType(v as "pallet" | "roll")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pallet">Pallet</SelectItem>
                    <SelectItem value="roll">Roll</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Total {stockPackType === "pallet" ? "Pallets" : "Rolls"}</Label>
                <Input type="number" min="0" step="1" value={stockPackCount} onChange={(e) => setStockPackCount(e.target.value)} placeholder="e.g. 12" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Thickness (mm)</Label>
                <Input type="number" min="0" step="0.001" value={stockThickness} onChange={(e) => setStockThickness(e.target.value)} placeholder="e.g. 0.13" />
              </div>
              <div>
                <Label>GSM</Label>
                <Input type="number" min="0" step="0.01" value={stockGsm} onChange={(e) => setStockGsm(e.target.value)} placeholder="e.g. 80" />
              </div>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input value={stockNotes} onChange={(e) => setStockNotes(e.target.value)} placeholder="e.g. invoice #" />
            </div>
            <Button onClick={addStockEntry} className="w-full bg-secondary hover:bg-secondary/90">Add Stock</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={issueOpen} onOpenChange={(o) => { setIssueOpen(o); if (!o) resetIssueForm(); }}>
        <DialogTrigger asChild>
          <Button variant="outline"><ArrowUpFromLine className="h-4 w-4 mr-2" />Issue Material</Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Issue Raw Material</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Raw Material</Label>
              <Select value={issueMaterialId} onValueChange={setIssueMaterialId}>
                <SelectTrigger><SelectValue placeholder="Select material" /></SelectTrigger>
                <SelectContent>{materials.filter(m => m.status === "active").map((m) => <SelectItem key={m.id} value={m.id}>{m.name} — {Number(m.current_stock).toLocaleString()} {m.unit} in stock</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Issue Unit</Label>
                <Select value={issueUnit} onValueChange={(v) => setIssueUnit(v as "kg" | "sqm")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="kg">Kilograms (kg)</SelectItem>
                    <SelectItem value="sqm">Square Meters (sqm)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Quantity ({issueUnit})</Label>
                <Input type="number" min="0" step="0.01" value={issueQty} onChange={(e) => setIssueQty(e.target.value)} placeholder="0" />
              </div>
            </div>
            <div>
              <Label>Variant (Lot · Thickness · GSM)</Label>
              <Select
                value={issueVariantKey}
                onValueChange={(v) => {
                  setIssueVariantKey(v);
                  const variant = availableVariants.find((x) => x.key === v);
                  if (variant) {
                    setIssueThickness(variant.thickness != null ? String(variant.thickness) : "");
                    setIssueLot(variant.lot ?? "");
                    if (variant.gsm != null) setIssueGsm(String(variant.gsm));
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={availableVariants.length ? "Select variant" : "No inward stock available"} />
                </SelectTrigger>
                <SelectContent>
                  {availableVariants.map((v) => (
                    <SelectItem key={v.key} value={v.key}>
                      {v.thickness != null ? `${v.thickness} mm` : "— mm"} | Lot {v.lot ?? "—"} | {v.balanceKg.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg available
                      {v.packCount > 0 ? ` | ${v.packCount} ${v.packType === "roll" ? "rolls" : "pallets"}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedVariant && (
                <p className="text-xs text-muted-foreground mt-1">
                  Lot {selectedVariant.lot ?? "—"} balance: {selectedVariant.balanceKg.toFixed(2)} kg
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>GSM</Label>
                <Input value={issueGsm || "—"} readOnly disabled className="bg-muted" />
                {issueUnit === "sqm" && !issueGsm && (
                  <p className="text-xs text-destructive mt-1">No GSM on file. Cannot issue in sqm.</p>
                )}
              </div>
              <div>
                <Label>Thickness</Label>
                <Input value={issueThickness ? `${issueThickness} mm` : "—"} readOnly disabled className="bg-muted" />
              </div>
            </div>
            {issueUnit === "sqm" && issueQty && issueGsm && Number(issueGsm) > 0 && (
              <div className="text-xs rounded bg-muted px-3 py-2">
                Will deduct <span className="font-semibold">{((Number(issueQty) * Number(issueGsm)) / 1000).toFixed(2)} kg</span>
                {" "}from inventory ({issueQty} sqm × {issueGsm} gsm ÷ 1000)
              </div>
            )}
            <div>
              <Label>Date</Label>
              <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </div>
            <div>
              <Label>Issued To (Production / Slitting Manager)</Label>
              <Select value={issueRecipientId} onValueChange={setIssueRecipientId}>
                <SelectTrigger><SelectValue placeholder="Select recipient (optional)" /></SelectTrigger>
                <SelectContent>{recipients.map((r) => <SelectItem key={r.user_id} value={r.user_id}>{r.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input value={issueNotes} onChange={(e) => setIssueNotes(e.target.value)} placeholder="e.g. PO# or job ref" />
            </div>
            <Button onClick={issueMaterial} className="w-full bg-secondary hover:bg-secondary/90">Issue Material</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogTrigger asChild>
          <Button className="bg-secondary hover:bg-secondary/90"><Plus className="h-4 w-4 mr-2" />Add Material</Button>
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
  ) : null;

  return (
    <div className="space-y-6">
      {!embedded ? (
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Raw Materials</h1>
          {actionButtons}
        </div>
      ) : (
        !readOnly && <div className="flex justify-end">{actionButtons}</div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by material, supplier, lot, notes…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">From</Label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-[150px]" />
          <Label className="text-xs text-muted-foreground whitespace-nowrap">To</Label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-[150px]" />
          {(dateFrom || dateTo || search) && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setDateFrom(""); setDateTo(""); }}>Clear</Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Package className="h-5 w-5" />Inventory ({filtered.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Current Stock</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No raw materials found</TableCell></TableRow>
              ) : filtered.map((m) => {
                const isExpanded = expandedMaterials.has(m.id);
                // Build lot-aware variants: group by thickness · gsm · lot_no
                const matEntries = stockEntries.filter((e) => e.raw_material_id === m.id);
                type Group = {
                  thickness: number | null;
                  gsm: number | null;
                  lot: string | null;
                  packType: "pallet" | "roll" | null;
                  packCount: number;
                  in: number;
                  out: number;
                };
                const groupMap = new Map<string, Group>();
                // First pass: build inward groups (keyed by lot+thickness+gsm)
                matEntries.filter((e) => !(e.kind === "out" || e.kind === "issue")).forEach((e) => {
                  const t = e.thickness_mm != null ? Number(e.thickness_mm) : null;
                  const g = e.gsm != null ? Number(e.gsm) : null;
                  const lot = e.lot_number?.trim() || null;
                  const key = `${t ?? "-"}|${g ?? "-"}|${lot ?? "-"}`;
                  const grp = groupMap.get(key) ?? {
                    thickness: t, gsm: g, lot, packType: null, packCount: 0, in: 0, out: 0,
                  };
                  grp.in += Number(e.quantity) || 0;
                  const pc = e.pallet_count != null ? Number(e.pallet_count) : null;
                  const rc = e.roll_count != null ? Number(e.roll_count) : null;
                  if (pc != null && pc > 0) { grp.packCount += pc; grp.packType = grp.packType ?? "pallet"; }
                  else if (rc != null && rc > 0) { grp.packCount += rc; grp.packType = grp.packType ?? "roll"; }
                  else if (e.pallets != null && Number(e.pallets) > 0) { grp.packCount += Number(e.pallets); grp.packType = grp.packType ?? "pallet"; }
                  groupMap.set(key, grp);
                });
                // Second pass: attribute outs. Exact lot match preferred; else if exactly one
                // inward lot matches (thickness, gsm) attach there; else show as "Unassigned issue".
                matEntries.filter((e) => e.kind === "out" || e.kind === "issue").forEach((e) => {
                  const t = e.thickness_mm != null ? Number(e.thickness_mm) : null;
                  const g = e.gsm != null ? Number(e.gsm) : null;
                  const lot = e.lot_number?.trim() || null;
                  const qty = Number(e.quantity) || 0;
                  if (lot) {
                    const key = `${t ?? "-"}|${g ?? "-"}|${lot}`;
                    const grp = groupMap.get(key);
                    if (grp) { grp.out += qty; return; }
                  }
                  // Backward-compat fallback by (thickness, gsm)
                  const candidates = Array.from(groupMap.values()).filter((v) =>
                    (t == null || v.thickness === t) && (g == null || v.gsm === g) && v.lot != null,
                  );
                  if (candidates.length === 1) {
                    candidates[0].out += qty;
                    return;
                  }
                  const key = `${t ?? "-"}|${g ?? "-"}|unassigned`;
                  const grp = groupMap.get(key) ?? {
                    thickness: t, gsm: g, lot: "Unassigned issue", packType: null, packCount: 0, in: 0, out: 0,
                  };
                  grp.out += qty;
                  groupMap.set(key, grp);
                });
                const variants = Array.from(groupMap.values())
                  .map((v) => ({ ...v, net: v.in - v.out }))
                  .sort((a, b) => {
                    const at = a.thickness ?? Infinity, bt = b.thickness ?? Infinity;
                    if (at !== bt) return at - bt;
                    const ag = a.gsm ?? Infinity, bg = b.gsm ?? Infinity;
                    if (ag !== bg) return ag - bg;
                    return (a.lot ?? "").localeCompare(b.lot ?? "");
                  });
                const toggle = () => {
                  setExpandedMaterials((prev) => {
                    const next = new Set(prev);
                    if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
                    return next;
                  });
                };
                return (
                  <Fragment key={m.id}>
                    <TableRow key={m.id} className="cursor-pointer hover:bg-muted/50" onClick={toggle}>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(ev) => { ev.stopPropagation(); toggle(); }}>
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                      <TableCell className="font-medium">{m.name}</TableCell>
                      <TableCell>{m.unit}</TableCell>
                      <TableCell className="text-right font-mono">
                        {(() => {
                          const matEntriesAll = stockEntries.filter((e) => e.raw_material_id === m.id);
                          const inSum = matEntriesAll.filter((e) => e.kind === "in").reduce((s, e) => s + Number(e.quantity || 0), 0);
                          const outSum = matEntriesAll.filter((e) => e.kind === "out" || e.kind === "issue").reduce((s, e) => s + Number(e.quantity || 0), 0);
                          const balance = inSum - outSum;
                          return `${balance.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${m.unit}`;
                        })()}
                      </TableCell>
                      <TableCell><Badge variant={m.status === "active" ? "default" : "secondary"}>{m.status}</Badge></TableCell>
                      <TableCell className="text-right" onClick={(ev) => ev.stopPropagation()}>
                        {!readOnly && (
                          <>
                            <Button variant="ghost" size="icon" onClick={() => openEdit(m)}><Pencil className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => setDeleteId(m.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow key={`${m.id}-variants`} className="bg-muted/30 hover:bg-muted/30">
                        <TableCell></TableCell>
                        <TableCell colSpan={5}>
                          {variants.length === 0 ? (
                            <div className="text-sm text-muted-foreground py-2">No variant data yet — add stock entries with thickness to see breakdown.</div>
                          ) : (
                            <div className="py-2">
                              <div className="text-xs font-semibold text-muted-foreground mb-2">Variants by Thickness / GSM / Lot</div>
                              <div className="overflow-x-auto">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="whitespace-nowrap">Lot No</TableHead>
                                      <TableHead className="text-right whitespace-nowrap">Thickness</TableHead>
                                      <TableHead className="text-right whitespace-nowrap">GSM</TableHead>
                                      <TableHead className="text-right whitespace-nowrap">Pallet / Roll</TableHead>
                                      <TableHead className="text-right whitespace-nowrap">In</TableHead>
                                      <TableHead className="text-right whitespace-nowrap">Out</TableHead>
                                      <TableHead className="text-right whitespace-nowrap">Balance</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {variants.map((v, idx) => (
                                      <TableRow key={`${v.thickness ?? "-"}|${v.gsm ?? "-"}|${v.lot ?? "-"}|${idx}`}>
                                        <TableCell className="font-mono text-xs break-all">{v.lot ?? "—"}</TableCell>
                                        <TableCell className="text-right font-mono whitespace-nowrap">{v.thickness != null ? `${v.thickness} mm` : "—"}</TableCell>
                                        <TableCell className="text-right font-mono whitespace-nowrap">{v.gsm != null ? `${v.gsm} gsm` : "—"}</TableCell>
                                        <TableCell className="text-right font-mono whitespace-nowrap">
                                          {v.packCount > 0 ? `${v.packCount.toLocaleString()} ${v.packType === "roll" ? "rolls" : "pallets"}` : "—"}
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-secondary whitespace-nowrap">+{v.in.toLocaleString()} {m.unit}</TableCell>
                                        <TableCell className="text-right font-mono text-destructive whitespace-nowrap">−{v.out.toLocaleString()} {m.unit}</TableCell>
                                        <TableCell className="text-right font-mono font-semibold whitespace-nowrap">{v.net.toLocaleString()} {m.unit}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent Stock Entries ({filteredEntries.length})</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Material</TableHead>
                <TableHead>Supplier / Client</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Pallets</TableHead>
                <TableHead className="text-right">Thickness</TableHead>
                <TableHead className="text-right">GSM</TableHead>
                <TableHead>Lot No.</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>By</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEntries.length === 0 ? (
                <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground py-8">No stock entries match your filters</TableCell></TableRow>
              ) : filteredEntries.map((e) => {
                const isSale = e.kind === "out";
                const isIssue = e.kind === "issue";
                const isOut = isSale || isIssue;
                const typeLabel = isSale ? "Sale" : isIssue ? "Issued" : "In";
                const qtyDisplay = isIssue && e.issue_quantity != null && e.issue_unit
                  ? `${Number(e.issue_quantity).toLocaleString()} ${e.issue_unit} → ${Number(e.quantity).toLocaleString()} kg`
                  : `${Number(e.quantity).toLocaleString()} ${e.material_unit}`;
                const canEditRow = !readOnly && canManageEntries && !isSale;
                if (!canEditRow) {
                  console.log("raw material row action check", {
                    currentUserRole,
                    isAdmin,
                    isInventoryManager,
                    isSuperAdmin,
                    rowEntryType: (e as any).entry_type,
                    rowEntryKind: (e as any).entry_kind,
                    rowAddedBy: e.added_by,
                    currentUserId: user?.id,
                    canEditDelete: canEditRow,
                  });
                }
                return (
                <TableRow key={e.id}>
                  <TableCell>{format(new Date(e.date), "dd/MM/yy")}</TableCell>
                  <TableCell>
                    <Badge variant={isOut ? "destructive" : "default"}>{typeLabel}</Badge>
                  </TableCell>
                  <TableCell>{e.material_name}</TableCell>
                  <TableCell>{e.supplier ?? "—"}</TableCell>
                  <TableCell className={`text-right font-mono ${isOut ? "text-destructive" : ""}`}>
                    {isOut ? "−" : "+"}{qtyDisplay}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{isIssue ? (e.issue_unit ?? "kg") : e.material_unit}</TableCell>
                  <TableCell className="text-right font-mono">{e.pallets ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{e.thickness_mm != null ? `${e.thickness_mm} mm` : "—"}</TableCell>
                  <TableCell className="text-right font-mono">{e.gsm != null ? `${e.gsm}` : "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{e.lot_number ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{e.notes ?? "—"}</TableCell>
                  <TableCell>{e.person_name}</TableCell>
                  <TableCell className="text-right">
                    {!canEditRow ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <>
                        <Button variant="ghost" size="icon" onClick={() => openEditEntry(e)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteEntryId(e.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
                );
              })}

            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Raw Material</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Name</Label><Input value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
            <div>
              <Label>Unit</Label>
              <Select value={editUnit} onValueChange={setEditUnit}>
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
            <Button onClick={saveEdit} className="w-full bg-secondary hover:bg-secondary/90">Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Raw Material?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Stock Entry Dialog */}
      <Dialog open={editEntryOpen} onOpenChange={setEditEntryOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Stock Entry</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Raw Material</Label>
              <Select value={eMaterialId} onValueChange={setEMaterialId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{materials.map((m) => <SelectItem key={m.id} value={m.id}>{m.name} ({m.unit})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Quantity</Label><Input type="number" min="0" step="0.01" value={eQty} onChange={(e) => setEQty(e.target.value)} /></div>
            <div><Label>Date</Label><Input type="date" value={eDate} onChange={(e) => setEDate(e.target.value)} /></div>
            <div><Label>Lot Number</Label><Input value={eLot} onChange={(e) => setELot(e.target.value)} /></div>
            <div><Label>Supplier / From</Label><Input value={eSupplier} onChange={(e) => setESupplier(e.target.value)} /></div>
            <div><Label>Pallets / Pieces</Label><Input type="number" min="0" step="1" value={ePallets} onChange={(e) => setEPallets(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Thickness (mm)</Label><Input type="number" min="0" step="0.001" value={eThickness} onChange={(e) => setEThickness(e.target.value)} /></div>
              <div><Label>GSM</Label><Input type="number" min="0" step="0.01" value={eGsm} onChange={(e) => setEGsm(e.target.value)} /></div>
            </div>
            <div><Label>Notes</Label><Input value={eNotes} onChange={(e) => setENotes(e.target.value)} /></div>
            <Button onClick={saveEntryEdit} className="w-full bg-secondary hover:bg-secondary/90">Save Changes</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Stock Entry Confirm */}
      <AlertDialog open={!!deleteEntryId} onOpenChange={(open) => !open && setDeleteEntryId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Stock Entry?</AlertDialogTitle>
            <AlertDialogDescription>This will remove the inward record. The raw material's current stock will not be auto-adjusted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteEntry} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
