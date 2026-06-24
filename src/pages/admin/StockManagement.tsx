import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Search, PackagePlus, ArrowDownCircle, ArrowUpCircle, Package, ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import { format } from "date-fns";
import { toast } from "@/hooks/use-toast";

interface ThicknessBreakdown {
  thickness_mm: number | null;
  produced: number;
}

type UnitKey = "meters" | "sqm" | "kg";
type Buckets = Partial<Record<UnitKey, number>>;

interface StockSummary {
  product_code_id: string;
  code: string;
  unit: string;
  produced: number;
  issued: number;
  available: number;
  producedBuckets: Buckets;
  issuedBuckets: Buckets;
  thicknessBreakdown: ThicknessBreakdown[];
  debugMatchedStockIssues: any[];
}

interface LedgerEntry {
  id: string;
  date: string;
  type: "IN" | "OUT";
  product_code: string;
  thickness_mm: number | null;
  client_name: string | null;
  quantity: number;
  unit: string;
  notes: string | null;
  person: string | null;
  source: "Production" | "Stock Issue" | "Sale";
}

interface Client {
  id: string;
  name: string;
}

interface ProductCode {
  id: string;
  code: string;
}

interface ProductionManager {
  user_id: string;
  name: string;
}


interface StockManagementProps {
  embedded?: boolean;
  readOnly?: boolean;
}

export default function StockManagement({ embedded = false, readOnly = false }: StockManagementProps = {}) {
  const { user } = useAuth();
  const [summaries, setSummaries] = useState<StockSummary[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [productionManagers, setProductionManagers] = useState<ProductionManager[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [inPage, setInPage] = useState(1);
  const [outPage, setOutPage] = useState(1);
  const PAGE_SIZE = 20;

  // Issue dialog
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueProductCodeId, setIssueProductCodeId] = useState("");
  const [issueRecipientType, setIssueRecipientType] = useState<"client" | "production_manager">("client");
  const [issueClientId, setIssueClientId] = useState("");
  const [issueRecipientUserId, setIssueRecipientUserId] = useState("");
  const [issueQuantity, setIssueQuantity] = useState("");
  const [issueUnit, setIssueUnit] = useState<"sqm" | "kg">("sqm");
  const [issueNotes, setIssueNotes] = useState("");
  const [issueDate, setIssueDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [issueThickness, setIssueThickness] = useState("");
  const [issueGsm, setIssueGsm] = useState("");
  const [issuing, setIssuing] = useState(false);


  // Edit thickness dialog
  const [editThicknessOpen, setEditThicknessOpen] = useState(false);
  const [editEntryId, setEditEntryId] = useState("");
  const [editThicknessValue, setEditThicknessValue] = useState("");
  const [editingThickness, setEditingThickness] = useState(false);

  const fetchData = async () => {
    setLoading(true);

    // Fetch production entries (IN) — include gsm for unit conversion
    const { data: prodData, error: prodErr } = await supabase
      .from("production_entries")
      .select("id, date, product_code_id, total_quantity, quantity_per_roll, rolls_count, unit, thickness_mm, gsm, product_codes(code), profiles:worker_id(name)")
      .order("date", { ascending: false })
      .limit(2000);
    if (prodErr) console.error("production_entries fetch error", prodErr);

    // Fetch stock issues (OUT) from the same source used by Issued History.
    // Keep this flat: embedded relationship joins can fail independently and make
    // the card totals look like zero even when stock_issues rows exist.
    const { data: issueData, error: issueErr } = await supabase
      .from("stock_issues")
      .select("*")
      .order("date", { ascending: false })
      .limit(2000);
    if (issueErr) {
      console.error("stock_issues fetch error", issueErr);
      toast({ title: "Could not load stock issues", description: issueErr.message, variant: "destructive" });
    }
    const stockIssueRows = (issueData ?? []) as any[];
    // eslint-disable-next-line no-console
    console.log("Inventory stock_issues rows", stockIssueRows.length, stockIssueRows);
    stockIssueRows.forEach((row) => {
      // eslint-disable-next-line no-console
      console.log("Inventory stock_issues row", {
        id: row.id,
        product_code_id: row.product_code_id,
        issue_type: row.issue_type,
        issue_quantity: row.issue_quantity,
        issue_unit: row.issue_unit,
        issue_quantity_sqm: row.issue_quantity_sqm,
        issue_quantity_kg: row.issue_quantity_kg,
        quantity: row.quantity,
        unit: row.unit,
      });
    });



    // Fetch sales (OUT) – finished product sales also reduce stock and should appear in the ledger
    // Note: sales table has no FK constraints, so we cannot use embedded joins. Fetch flat and map locally.
    const { data: salesRaw, error: salesErr } = await supabase
      .from("sales")
      .select("id, date, product_code_id, item_type, quantity, unit, notes, thickness_mm, client_id, client_name, sold_by")
      .order("date", { ascending: false })
      .limit(1000);
    if (salesErr) console.error("sales fetch error", salesErr);

    // Resolve labels for sales rows
    const saleSellerIds = Array.from(new Set((salesRaw ?? []).map((s: any) => s.sold_by).filter(Boolean)));
    const saleClientIds = Array.from(new Set((salesRaw ?? []).map((s: any) => s.client_id).filter(Boolean)));
    const salePcIds = Array.from(new Set((salesRaw ?? []).map((s: any) => s.product_code_id).filter(Boolean)));
    const [{ data: sellerProfiles }, { data: saleClients }, { data: salePcs }] = await Promise.all([
      saleSellerIds.length ? supabase.from("profiles").select("user_id, name").in("user_id", saleSellerIds) : Promise.resolve({ data: [] as any[] }),
      saleClientIds.length ? supabase.from("company_clients").select("id, name").in("id", saleClientIds) : Promise.resolve({ data: [] as any[] }),
      salePcIds.length ? supabase.from("product_codes").select("id, code").in("id", salePcIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const sellerMap = new Map((sellerProfiles ?? []).map((p: any) => [p.user_id, p.name]));
    const saleClientMap = new Map((saleClients ?? []).map((c: any) => [c.id, c.name]));
    const salePcMap = new Map((salePcs ?? []).map((p: any) => [p.id, p.code]));
    const salesData = (salesRaw ?? []).map((s: any) => ({
      ...s,
      product_codes: s.product_code_id ? { code: salePcMap.get(s.product_code_id) } : null,
      company_clients: s.client_id ? { name: saleClientMap.get(s.client_id) } : null,
      profiles: s.sold_by ? { name: sellerMap.get(s.sold_by) } : null,
    }));

    const issueProductCodeIds = Array.from(new Set(stockIssueRows.map((i) => i.product_code_id).filter(Boolean)));
    const issueClientIds = Array.from(new Set(stockIssueRows.map((i) => i.client_id).filter(Boolean)));
    const issueUserIds = Array.from(new Set(stockIssueRows.flatMap((i) => [i.issued_by, i.issued_to_user_id, i.recipient_user_id]).filter(Boolean)));

    // Fetch dropdowns and labels — production managers via RPC (bypasses profile RLS)
    const [{ data: cl }, { data: pc }, { data: pmData }, { data: issuePcs }, { data: issueClients }, { data: issueProfiles }] = await Promise.all([
      supabase.from("company_clients").select("id, name").eq("status", "active").order("name"),
      supabase.from("product_codes").select("id, code").eq("status", "active").order("code"),
      supabase.rpc("list_production_manager_recipients"),
      issueProductCodeIds.length ? supabase.from("product_codes").select("id, code").in("id", issueProductCodeIds) : Promise.resolve({ data: [] as any[] }),
      issueClientIds.length ? supabase.from("company_clients").select("id, name").in("id", issueClientIds) : Promise.resolve({ data: [] as any[] }),
      issueUserIds.length ? supabase.from("profiles").select("user_id, name").in("user_id", issueUserIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    setClients(cl ?? []);
    setProductCodes(pc ?? []);
    const issueProductCodeMap = new Map<string, string>((issuePcs ?? []).map((p: any) => [p.id, p.code]));
    const issueClientMap = new Map<string, string>((issueClients ?? []).map((c: any) => [c.id, c.name]));
    const issueProfileMap = new Map<string, string>((issueProfiles ?? []).map((p: any) => [p.user_id, p.name]));

    const list: ProductionManager[] = ((pmData ?? []) as any[])
      .map((p) => ({ user_id: p.user_id, name: p.name }))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    setProductionManagers(list);


    const normUnit = (u: any): UnitKey | null => {
      const s = String(u ?? "").toLowerCase();
      if (s === "sqm" || s === "sqmtr" || s === "sq m" || s === "m2") return "sqm";
      if (s === "kg" || s === "kgs" || s === "kilogram") return "kg";
      if (s === "meters" || s === "meter" || s === "m" || s === "mtr") return "meters";
      return null;
    };
    const addBucket = (b: Buckets, u: UnitKey, q: number) => {
      if (!q) return;
      b[u] = (b[u] ?? 0) + q;
    };
    const parseNotesMeta = (notes: string | null | undefined) => {
      const value = (key: string) => {
        const match = String(notes ?? "").match(new RegExp(`${key}=([\\d.]+)`, "i"));
        return match ? Number(match[1]) : null;
      };
      return { sqm: value("sqm"), kg: value("kg"), gsm: value("gsm") };
    };
    const isFinishedStockIssue = (i: any) => {
      const issueType = i.issue_type ?? null;
      return Boolean(i.product_code_id) && (issueType === null || issueType === "" || issueType === "finished_stock");
    };
    const getIssueBuckets = (i: any): Buckets => {
      const buckets: Buckets = {};
      const rawQty = Number(i.issue_quantity ?? i.quantity ?? 0);
      const issueUnit = normUnit(i.issue_unit ?? i.unit) ?? "sqm";
      const meta = parseNotesMeta(i.notes);
      const gsm = i.gsm != null ? Number(i.gsm) : meta.gsm;
      const widthMmRaw = i.width_mm ?? i.roll_width_mm ?? i.product_width_mm;
      const widthMm = widthMmRaw != null ? Number(widthMmRaw) : null;

      const sqm = i.issue_quantity_sqm != null
        ? Number(i.issue_quantity_sqm)
        : meta.sqm != null
          ? meta.sqm
        : issueUnit === "sqm"
          ? rawQty
          : issueUnit === "meters" && widthMm && widthMm > 0
            ? rawQty * (widthMm / 1000)
            : issueUnit === "kg" && gsm && gsm > 0
              ? (rawQty * 1000) / gsm
              : null;
      const kg = i.issue_quantity_kg != null
        ? Number(i.issue_quantity_kg)
        : meta.kg != null
          ? meta.kg
        : issueUnit === "kg"
          ? rawQty
          : sqm != null && gsm && gsm > 0
            ? (sqm * gsm) / 1000
            : null;
      const meters = issueUnit === "meters"
        ? rawQty
        : sqm != null && widthMm && widthMm > 0
          ? sqm / (widthMm / 1000)
          : null;

      if (sqm != null) addBucket(buckets, "sqm", sqm);
      if (kg != null) addBucket(buckets, "kg", kg);
      if (meters != null) addBucket(buckets, "meters", meters);
      return buckets;
    };

    // Build per-product-code totals and thickness breakdowns
    const pcTotals = new Map<string, { code: string; unit: string; produced: number; buckets: Buckets }>();
    const thicknessMap = new Map<string, Map<number | null, number>>();
    const issueMap = new Map<string, number>();
    const issuedBucketsMap = new Map<string, Buckets>();
    const ensureIssued = (pcId: string) => {
      let b = issuedBucketsMap.get(pcId);
      if (!b) { b = {}; issuedBucketsMap.set(pcId, b); }
      return b;
    };

    for (const p of (prodData ?? []) as any[]) {
      const pcId = p.product_code_id;
      const thickness = p.thickness_mm != null ? Number(p.thickness_mm) : null;
      const qty = Number(p.total_quantity ?? (p.rolls_count * p.quantity_per_roll));
      const gsm = p.gsm != null ? Number(p.gsm) : null;
      const u = normUnit(p.unit) ?? "meters";

      let entry = pcTotals.get(pcId);
      if (!entry) {
        entry = { code: p.product_codes?.code ?? "—", unit: p.unit, produced: 0, buckets: {} };
        pcTotals.set(pcId, entry);
      }
      entry.produced += qty;
      addBucket(entry.buckets, u, qty);
      if (gsm && gsm > 0) {
        if (u === "sqm") addBucket(entry.buckets, "kg", (qty * gsm) / 1000);
        else if (u === "kg") addBucket(entry.buckets, "sqm", (qty * 1000) / gsm);
      }

      if (!thicknessMap.has(pcId)) thicknessMap.set(pcId, new Map());
      const tMap = thicknessMap.get(pcId)!;
      tMap.set(thickness, (tMap.get(thickness) ?? 0) + qty);
    }

    const finishedStockIssues = stockIssueRows.filter(isFinishedStockIssue);
    for (const i of finishedStockIssues) {
      const pcId = i.product_code_id;
      const b = ensureIssued(pcId);
      const rowBuckets = getIssueBuckets(i);
      for (const [unit, qty] of Object.entries(rowBuckets) as Array<[UnitKey, number]>) {
        addBucket(b, unit, qty);
      }
      const primaryUnit = normUnit(pcTotals.get(pcId)?.unit) ?? normUnit(i.issue_unit ?? i.unit) ?? "sqm";
      const primaryIssued = Number(rowBuckets[primaryUnit] ?? i.issue_quantity ?? i.quantity ?? 0);
      issueMap.set(pcId, (issueMap.get(pcId) ?? 0) + primaryIssued);
    }

    // Include finished-product sales in issued totals (they reduce finished stock)
    for (const s of (salesData ?? []) as any[]) {
      if (s.item_type === "finished_product" && s.product_code_id) {
        const pcId = s.product_code_id;
        const q = Number(s.quantity);
        issueMap.set(pcId, (issueMap.get(pcId) ?? 0) + q);
        const b = ensureIssued(pcId);
        const u = normUnit(s.unit) ?? "meters";
        addBucket(b, u, q);
      }
    }

    const allPcIds = new Set([...pcTotals.keys(), ...issuedBucketsMap.keys(), ...issueMap.keys()]);
    const summaryList: StockSummary[] = [];
    for (const pcId of allPcIds) {
      const prod = pcTotals.get(pcId);
      const produced = prod?.produced ?? 0;
      const productUnit = normUnit(prod?.unit) ?? "meters";
      const issuedBuckets = issuedBucketsMap.get(pcId) ?? {};
      const issued = Number(issuedBuckets[productUnit] ?? 0);
      const tMap = thicknessMap.get(pcId);
      const breakdown: ThicknessBreakdown[] = [];
      if (tMap) {
        for (const [t, q] of Array.from(tMap.entries()).sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0))) {
          breakdown.push({ thickness_mm: t, produced: q });
        }
      }
      summaryList.push({
        product_code_id: pcId,
        code: prod?.code ?? issueProductCodeMap.get(pcId) ?? "—",
        unit: prod?.unit ?? "meters",
        produced,
        issued,
        available: produced - issued,
        producedBuckets: prod?.buckets ?? {},
        issuedBuckets,
        thicknessBreakdown: breakdown,
        debugMatchedStockIssues: matchedStockIssues,
      });
      const matchedStockIssues = finishedStockIssues.filter((i) => String(i.product_code_id) === String(pcId));
      const computedIssuedTotals = issuedBuckets;
      // eslint-disable-next-line no-console
      console.log("Issued for product", pcId, prod?.code ?? issueProductCodeMap.get(pcId) ?? "—", {
        product_id: pcId,
        product_code: prod?.code ?? issueProductCodeMap.get(pcId) ?? "—",
        produced_quantity: produced,
        matched_stock_issues_rows: matchedStockIssues,
        computed_issued_totals: computedIssuedTotals,
        rendered_issued_value: computedIssuedTotals,
        producedBuckets: prod?.buckets ?? {},
        issuedBuckets,
      });
    }
    summaryList.sort((a, b) => a.code.localeCompare(b.code));
    setSummaries(summaryList);

    // Build ledger
    const ledgerEntries: LedgerEntry[] = [];
    for (const p of (prodData ?? []) as any[]) {
      ledgerEntries.push({
        id: p.id,
        date: p.date,
        type: "IN",
        product_code: p.product_codes?.code ?? "—",
        thickness_mm: p.thickness_mm != null ? Number(p.thickness_mm) : null,
        client_name: null,
        quantity: p.total_quantity ?? (p.rolls_count * p.quantity_per_roll),
        unit: p.unit,
        notes: null,
        person: p.profiles?.name ?? null,
        source: "Production",
      });
    }
    for (const i of finishedStockIssues) {
      ledgerEntries.push({
        id: i.id,
        date: i.date ?? i.created_at,
        type: "OUT",
        product_code: issueProductCodeMap.get(i.product_code_id) ?? "—",
        thickness_mm: i.thickness_mm != null ? Number(i.thickness_mm) : null,
        client_name: i.recipient_type === "production_manager"
          ? `Production Mgr: ${issueProfileMap.get(i.issued_to_user_id ?? i.recipient_user_id) ?? "Unknown"}`
          : (issueClientMap.get(i.client_id) ?? "—"),
        quantity: Number(i.issue_quantity ?? i.quantity ?? 0),
        unit: i.issue_unit ?? i.unit,
        notes: i.notes,
        person: issueProfileMap.get(i.issued_by) ?? null,
        source: "Stock Issue",
      });
    }
    for (const s of (salesData ?? []) as any[]) {
      const code = s.product_codes?.code ?? (s.item_type === "raw_material" ? "Raw Material" : "—");
      ledgerEntries.push({
        id: s.id,
        date: s.date,
        type: "OUT",
        product_code: code,
        thickness_mm: s.thickness_mm != null ? Number(s.thickness_mm) : null,
        client_name: s.company_clients?.name ?? s.client_name ?? "—",
        quantity: Number(s.quantity),
        unit: s.unit,
        notes: s.notes,
        person: s.profiles?.name ?? null,
        source: "Sale",
      });
    }
    ledgerEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    setLedger(ledgerEntries);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const filteredSummaries = summaries
    .filter((s) => {
      if (s.code === "—") return false;
      const units: UnitKey[] = ["meters", "sqm", "kg"];
      const anyProduced = units.some((u) => Number(s.producedBuckets[u] ?? 0) > 0);
      const anyIssued = units.some((u) => Number(s.issuedBuckets[u] ?? 0) > 0);
      const anyPositive = units.some((u) => (Number(s.producedBuckets[u] ?? 0) - Number(s.issuedBuckets[u] ?? 0)) > 0);
      return anyProduced || anyIssued || anyPositive || s.available > 0;
    })
    .filter((s) => !search || s.code.toLowerCase().includes(search.toLowerCase()));

  const filteredLedger = ledger.filter((e) => {
    const s = search.toLowerCase();
    return !s || e.product_code.toLowerCase().includes(s) || (e.client_name?.toLowerCase().includes(s) ?? false);
  });

  const handleIssue = async () => {
    if (!user || !issueProductCodeId || !issueQuantity) return;
    if (issueRecipientType === "client" && !issueClientId) {
      toast({ title: "Select a client", variant: "destructive" });
      return;
    }
    if (issueRecipientType === "production_manager" && !issueRecipientUserId) {
      toast({ title: "Select a production manager", variant: "destructive" });
      return;
    }

    // Block over-issue: validate against computed available stock
    const stock = summaries.find((s) => s.product_code_id === issueProductCodeId);
    const qtyNum = Number(issueQuantity);
    if (stock && qtyNum > stock.available) {
      toast({
        title: "Insufficient stock",
        description: `Only ${stock.available.toLocaleString()} ${stock.unit} available`,
        variant: "destructive",
      });
      return;
    }

    setIssuing(true);

    // Compute sqm/kg conversions for record-keeping (stored in notes since DB has no dedicated columns).
    const qty = Number(issueQuantity);
    const gsmNum = issueGsm ? Number(issueGsm) : null;
    let sqm: number | null = null;
    let kg: number | null = null;
    if (issueUnit === "sqm") {
      sqm = qty;
      if (gsmNum && gsmNum > 0) kg = (qty * gsmNum) / 1000;
    } else {
      kg = qty;
      if (gsmNum && gsmNum > 0) sqm = (qty * 1000) / gsmNum;
    }

    const metaParts: string[] = [];
    if (sqm != null) metaParts.push(`sqm=${sqm.toFixed(2)}`);
    if (kg != null) metaParts.push(`kg=${kg.toFixed(2)}`);
    if (gsmNum != null) metaParts.push(`gsm=${gsmNum}`);
    const metaStr = metaParts.length ? `[${metaParts.join(" ")}]` : "";
    const finalNotes = [issueNotes?.trim(), metaStr].filter(Boolean).join(" ").trim() || null;

    const { error } = await supabase.from("stock_issues").insert({
      product_code_id: issueProductCodeId,
      recipient_type: issueRecipientType,
      client_id: issueRecipientType === "client" ? issueClientId : null,
      recipient_user_id: issueRecipientType === "production_manager" ? issueRecipientUserId : null,
      issued_to_user_id: issueRecipientType === "production_manager" ? issueRecipientUserId : null,
      quantity: qty,
      unit: issueUnit,
      issue_type: "finished_stock",
      issue_quantity: qty,
      issue_unit: issueUnit,
      issue_quantity_kg: kg,
      issue_quantity_sqm: sqm,
      gsm: gsmNum,
      thickness_mm: issueThickness ? Number(issueThickness) : null,
      notes: finalNotes,
      issued_by: user.id,
      date: issueDate,
    } as any);

    setIssuing(false);
    if (error) {
      toast({ title: "Issue failed", description: error.message, variant: "destructive" });
    } else {
      try {
        Object.keys(localStorage)
          .filter((k) => /inventory|stock|issued/i.test(k))
          .forEach((k) => localStorage.removeItem(k));
      } catch {
        // ignore
      }
      toast({ title: "Stock issued successfully" });
      setIssueOpen(false);
      resetIssueForm();
      fetchData();
    }
  };

  const resetIssueForm = () => {
    setIssueProductCodeId("");
    setIssueRecipientType("client");
    setIssueClientId("");
    setIssueRecipientUserId("");
    setIssueQuantity("");
    setIssueUnit("sqm");
    setIssueThickness("");
    setIssueGsm("");
    setIssueNotes("");
    setIssueDate(format(new Date(), "yyyy-MM-dd"));
  };


  const openIssueForProduct = (pcId: string) => {
    setIssueProductCodeId(pcId);
    setIssueOpen(true);
  };

  return (
    <div className="space-y-6">
      {!embedded ? (
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Stock Management</h1>
          {!readOnly && (
            <Button onClick={() => setIssueOpen(true)} className="bg-secondary hover:bg-secondary/90">
              <PackagePlus className="h-4 w-4 mr-2" /> Issue Stock
            </Button>
          )}
        </div>
      ) : (
        !readOnly && (
          <div className="flex justify-end">
            <Button onClick={() => setIssueOpen(true)} className="bg-secondary hover:bg-secondary/90">
              <PackagePlus className="h-4 w-4 mr-2" /> Issue Stock
            </Button>
          </div>
        )
      )}

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by product code or client..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setInPage(1); setOutPage(1); }}
          className="pl-9"
        />
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
        {loading ? (
          <p className="text-muted-foreground col-span-full text-center py-8">Loading...</p>
        ) : filteredSummaries.length === 0 ? (
          <p className="text-muted-foreground col-span-full text-center py-8">No stock data found</p>
        ) : (
          filteredSummaries.map((s) => (
            <Card key={s.product_code_id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2 break-words">
                  <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="break-words">{s.code}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(() => {
                  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
                  const units: UnitKey[] = ["meters", "sqm", "kg"];
                  const rows = units
                    .map((u) => {
                      const prod = Number(s.producedBuckets[u] ?? 0);
                      const iss = Number(s.issuedBuckets[u] ?? 0);
                      if (prod === 0 && iss === 0) return null;
                      return { unit: u, prod, iss, avail: prod > 0 ? prod - iss : null };
                    })
                    .filter(Boolean) as Array<{ unit: UnitKey; prod: number; iss: number; avail: number | null }>;
                  // eslint-disable-next-line no-console
                  console.log("Rendered stock card", {
                    product_id: s.product_code_id,
                    product_code: s.code,
                    produced_quantity: s.produced,
                    matched_stock_issues_rows: s.debugMatchedStockIssues,
                    computed_issued_totals: s.issuedBuckets,
                    rendered_issued_value: rows.map((r) => ({ unit: r.unit, issued: r.iss, available: r.avail })),
                  });
                  if (rows.length === 0) {
                    return (
                      <div className="grid grid-cols-3 gap-2 text-center mb-3">
                        <div><p className="text-xs text-muted-foreground">Produced</p><p className="text-base font-semibold text-green-600">{fmt(s.produced)} {s.unit}</p></div>
                        <div><p className="text-xs text-muted-foreground">Issued</p><p className="text-base font-semibold text-red-500">{fmt(s.issued)} {s.unit}</p></div>
                        <div><p className="text-xs text-muted-foreground">Available</p><p className={`text-base font-bold ${s.available > 0 ? "text-primary" : "text-destructive"}`}>{fmt(s.available)} {s.unit}</p></div>
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-2 mb-3">
                      <div className="grid grid-cols-[60px_1fr_1fr_1fr] gap-2 text-xs text-muted-foreground px-1">
                        <span>Unit</span>
                        <span className="text-right">Produced</span>
                        <span className="text-right">Issued</span>
                        <span className="text-right">Available</span>
                      </div>
                      {rows.map((r) => (
                        <div key={r.unit} className="grid grid-cols-[60px_1fr_1fr_1fr] gap-2 items-center px-1 text-sm">
                          <span className="font-medium uppercase text-xs">{r.unit}</span>
                          <span className="text-right text-green-600 font-semibold">{fmt(r.prod)}</span>
                          <span className="text-right text-red-500 font-semibold">{fmt(r.iss)}</span>
                          <span className={`text-right font-bold ${r.avail == null || r.avail > 0 ? "text-primary" : "text-destructive"}`}>{r.avail == null ? "—" : fmt(r.avail)}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Thickness Breakdown */}
                {s.thicknessBreakdown.length > 0 && s.thicknessBreakdown.some(t => t.thickness_mm != null) && (
                  <div className="mt-2 border rounded-md overflow-hidden">
                    <div className="bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
                      Thickness Breakdown
                    </div>
                    <div className="divide-y">
                      {s.thicknessBreakdown.map((t) => (
                        <div key={String(t.thickness_mm)} className="flex items-center justify-between px-3 py-1.5 text-sm">
                          <span className="font-medium">
                            {t.thickness_mm != null ? `${t.thickness_mm} mm` : "No thickness"}
                          </span>
                          <span className="font-semibold">{t.produced.toLocaleString()} {s.unit}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Per-card Issue button removed — use top-level Issue Stock button */}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Inward & Outward Tables */}
      <div className="space-y-6">
        {/* Inward Supply */}
        {(() => {
          const inData = filteredLedger.filter(e => e.type === "IN");
          const inTotalPages = Math.max(1, Math.ceil(inData.length / PAGE_SIZE));
          const inPaged = inData.slice((inPage - 1) * PAGE_SIZE, inPage * PAGE_SIZE);
          return (
            <div>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <ArrowDownCircle className="h-5 w-5 text-green-600" />
                Inward Supply (Production)
                <span className="text-sm font-normal text-muted-foreground">({inData.length} entries)</span>
              </h2>
              <div className="border rounded-lg overflow-x-auto">

                <Table>
                  <TableHeader>
                    <TableRow>
                     <TableHead>Date</TableHead>
                      <TableHead>Product Code</TableHead>
                      <TableHead className="text-right">Thickness (mm)</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Worker</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading...</TableCell>
                      </TableRow>
                    ) : inPaged.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No inward entries found</TableCell>
                      </TableRow>
                    ) : (
                      inPaged.map((e) => (
                        <TableRow key={`IN-${e.id}`}>
                          <TableCell className="text-base font-medium whitespace-nowrap">
                            {format(new Date(e.date), "dd/MM/yy")}
                          </TableCell>
                          <TableCell className="font-medium">{e.product_code}</TableCell>
                          <TableCell className="text-right">{e.thickness_mm != null ? e.thickness_mm : <span className="text-muted-foreground italic">Not set</span>}</TableCell>
                          <TableCell className="text-right font-semibold text-green-600">{Number(e.quantity).toLocaleString()} {e.unit}</TableCell>
                          <TableCell>{e.unit}</TableCell>
                          <TableCell>{e.person ?? "—"}</TableCell>
                          <TableCell>
                            {e.thickness_mm == null && !readOnly && (
                              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => { setEditEntryId(e.id); setEditThicknessValue(""); setEditThicknessOpen(true); }}>
                                <Pencil className="h-3 w-3 mr-1" /> Add
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              {inTotalPages > 1 && (
                <div className="flex items-center justify-between mt-3">
                  <p className="text-sm text-muted-foreground">Page {inPage} of {inTotalPages}</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={inPage <= 1} onClick={() => setInPage(p => p - 1)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" disabled={inPage >= inTotalPages} onClick={() => setInPage(p => p + 1)}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Outward Supply */}
        {(() => {
          const outData = filteredLedger.filter(e => e.type === "OUT");
          const outTotalPages = Math.max(1, Math.ceil(outData.length / PAGE_SIZE));
          const outPaged = outData.slice((outPage - 1) * PAGE_SIZE, outPage * PAGE_SIZE);
          return (
            <div>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <ArrowUpCircle className="h-5 w-5 text-red-500" />
                Outward Supply (Issues & Sales)
                <span className="text-sm font-normal text-muted-foreground">({outData.length} entries)</span>
              </h2>
              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                     <TableHead>Date</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Product Code</TableHead>
                      <TableHead className="text-right">Thickness (mm)</TableHead>
                      <TableHead>Recipient</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>By</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                         <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading...</TableCell>
                      </TableRow>
                    ) : outPaged.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No outward entries found</TableCell>
                      </TableRow>
                    ) : (
                      outPaged.map((e) => (
                        <TableRow key={`OUT-${e.source}-${e.id}`}>
                          <TableCell className="text-base font-medium whitespace-nowrap">
                            {format(new Date(e.date), "dd/MM/yy")}
                          </TableCell>
                          <TableCell>
                            <Badge variant={e.source === "Sale" ? "default" : "secondary"}>
                              {e.source}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-medium">{e.product_code}</TableCell>
                          <TableCell className="text-right">{e.thickness_mm != null ? e.thickness_mm : "—"}</TableCell>
                          <TableCell>{e.client_name ?? "—"}</TableCell>
                          <TableCell className="text-right font-semibold text-red-500">{Number(e.quantity).toLocaleString()} {e.unit}</TableCell>
                          <TableCell>{e.unit}</TableCell>
                          <TableCell>{e.person ?? "—"}</TableCell>
                          <TableCell className="max-w-[200px] truncate">{e.notes ?? "—"}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              {outTotalPages > 1 && (
                <div className="flex items-center justify-between mt-3">
                  <p className="text-sm text-muted-foreground">Page {outPage} of {outTotalPages}</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={outPage <= 1} onClick={() => setOutPage(p => p - 1)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" disabled={outPage >= outTotalPages} onClick={() => setOutPage(p => p + 1)}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Issue Stock Dialog */}
      <Dialog open={issueOpen} onOpenChange={(open) => { if (!open) { setIssueOpen(false); resetIssueForm(); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Issue Stock</DialogTitle>
            <DialogDescription>Issue stock to a client or to a production manager.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Issue To</Label>
                <Select
                  value={issueRecipientType}
                  onValueChange={(v) => {
                    setIssueRecipientType(v as "client" | "production_manager");
                    setIssueClientId("");
                    setIssueRecipientUserId("");
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="client">Client</SelectItem>
                    <SelectItem value="production_manager">Internal Manager</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Product Code</Label>
              <SearchableSelect
                value={issueProductCodeId}
                onValueChange={(v) => { setIssueProductCodeId(v); }}
                placeholder="Select product"
                options={productCodes.map((p) => {
                  const stock = summaries.find(s => s.product_code_id === p.id);
                  return {
                    value: p.id,
                    label: `${p.code}${stock ? ` (Available: ${stock.available.toLocaleString()} ${stock.unit})` : ""}`,
                  };
                })}
              />
              {issueProductCodeId && (() => {
                const stock = summaries.find(s => s.product_code_id === issueProductCodeId);
                if (!stock) return null;
                return (
                  <div className="flex gap-4 text-sm p-2 rounded bg-muted">
                    <span>Produced: <strong className="text-green-600">{stock.produced.toLocaleString()} {stock.unit}</strong></span>
                    <span>Issued: <strong className="text-red-500">{stock.issued.toLocaleString()} {stock.unit}</strong></span>
                    <span>Available: <strong className={stock.available > 0 ? "text-primary" : "text-destructive"}>{stock.available.toLocaleString()} {stock.unit}</strong></span>
                  </div>
                );
              })()}
            </div>
            {issueRecipientType === "client" ? (
              <div className="space-y-2">
                <Label>Client</Label>
                <SearchableSelect
                  value={issueClientId}
                  onValueChange={setIssueClientId}
                  placeholder="Select client"
                  options={clients.map((c) => ({ value: c.id, label: c.name }))}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Production / Slitting Manager</Label>
                <SearchableSelect
                  value={issueRecipientUserId}
                  onValueChange={setIssueRecipientUserId}
                  placeholder={productionManagers.length ? "Select manager" : "No managers available"}
                  options={productionManagers.map((m) => ({
                    value: m.user_id,
                    label: m.name,
                  }))}
                />
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-2">
                <Label>Quantity ({issueUnit})</Label>
                <Input type="number" min="0" step="0.01" value={issueQuantity} onChange={(e) => setIssueQuantity(e.target.value)} placeholder="0" />
              </div>
              <div className="space-y-2">
                <Label>Unit</Label>
                <Select value={issueUnit} onValueChange={(v) => setIssueUnit(v as "sqm" | "kg")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sqm">Square Meters (sqm)</SelectItem>
                    <SelectItem value="kg">Kilograms (kg)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Thickness (mm)</Label>
                <Input type="number" min="0" step="0.01" value={issueThickness} onChange={(e) => setIssueThickness(e.target.value)} placeholder="Optional" />
              </div>
              <div className="space-y-2">
                <Label>GSM</Label>
                <Input type="number" min="0" step="1" value={issueGsm} onChange={(e) => setIssueGsm(e.target.value)} placeholder="for conversion" />
              </div>
            </div>
            {issueQuantity && (() => {
              const qty = Number(issueQuantity);
              const gsmNum = issueGsm ? Number(issueGsm) : 0;
              if (!qty || !gsmNum) return (
                <p className="text-xs text-muted-foreground">Enter GSM to auto-convert between sqm and kg.</p>
              );
              const sqm = issueUnit === "sqm" ? qty : (qty * 1000) / gsmNum;
              const kg = issueUnit === "kg" ? qty : (qty * gsmNum) / 1000;
              return (
                <div className="flex gap-4 text-sm p-2 rounded bg-muted">
                  <span>≈ <strong>{sqm.toFixed(2)} sqm</strong></span>
                  <span>≈ <strong>{kg.toFixed(2)} kg</strong></span>
                </div>
              );
            })()}
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={issueNotes} onChange={(e) => setIssueNotes(e.target.value)} placeholder="e.g. Delivery challan #123" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setIssueOpen(false); resetIssueForm(); }}>Cancel</Button>
            <Button onClick={handleIssue} disabled={issuing} className="bg-secondary hover:bg-secondary/90">
              {issuing ? "Issuing..." : "Issue Stock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Thickness Dialog */}
      <Dialog open={editThicknessOpen} onOpenChange={setEditThicknessOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Thickness</DialogTitle>
            <DialogDescription>Set the thickness for this production entry.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Thickness (mm)</Label>
              <Input type="number" min="0" step="0.01" value={editThicknessValue} onChange={(e) => setEditThicknessValue(e.target.value)} placeholder="e.g. 0.5" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditThicknessOpen(false)}>Cancel</Button>
            <Button disabled={editingThickness || !editThicknessValue} onClick={async () => {
              setEditingThickness(true);
              const { error } = await supabase.from("production_entries").update({ thickness_mm: Number(editThicknessValue) } as any).eq("id", editEntryId);
              setEditingThickness(false);
              if (error) {
                toast({ title: "Error", description: error.message, variant: "destructive" });
              } else {
                toast({ title: "Thickness updated" });
                setEditThicknessOpen(false);
                fetchData();
              }
            }}>
              {editingThickness ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
