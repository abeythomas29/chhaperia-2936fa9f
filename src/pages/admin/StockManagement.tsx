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

type UnitKey = "meters" | "sqm" | "kg";
type Buckets = Partial<Record<UnitKey, number>>;

interface ConversionInfo {
  widthMm: number | null;
  widthSource: string | null;
  gsm: number | null;
  gsmSource: string | null;
  missingData: string;
}

// Anything narrower than this is treated as a slit/tape cut width and is
// NOT used as the source-roll width for finished stock conversion.
const MIN_FULL_ROLL_WIDTH_MM = 500;

const getMissingUnitReason = (unit: UnitKey, conversion: ConversionInfo) => {
  if (unit === "meters") return null;
  if (unit === "sqm") return conversion.widthMm ? null : "Missing width";
  const missing = [!conversion.widthMm ? "width" : null, !conversion.gsm ? "GSM" : null].filter(Boolean);
  return missing.length ? `Missing ${missing.join(" + ")}` : null;
};

const formatConversionData = (conversion: ConversionInfo) => {
  const width = conversion.widthMm ? `Width = ${conversion.widthMm.toLocaleString(undefined, { maximumFractionDigits: 4 })} mm from ${conversion.widthSource}` : null;
  const gsm = conversion.gsm ? `GSM = ${conversion.gsm.toLocaleString(undefined, { maximumFractionDigits: 4 })} from ${conversion.gsmSource}` : null;
  const warn = conversion.widthMm != null && conversion.widthMm < MIN_FULL_ROLL_WIDTH_MM
    ? ` ⚠ Possible wrong width source: ${conversion.widthMm}mm looks like a slit/cut width, not the source roll width.`
    : "";
  if (width || gsm) {
    const missing = conversion.missingData !== "Complete" ? ` (${conversion.missingData})` : "";
    return `Conversion data: ${[width, gsm].filter(Boolean).join(", ")}${missing}.${warn}`;
  }
  return "Conversion data missing: source width / GSM not found.";
};

interface ThicknessBreakdown {
  thickness_mm: number | null;
  produced: number;
  producedBuckets: Buckets;
  issuedBuckets: Buckets;
  conversion: ConversionInfo;
}

interface StockSummary {
  product_code_id: string;
  code: string;
  unit: string;
  produced: number;
  issued: number;
  available: number;
  producedBuckets: Buckets;
  issuedBuckets: Buckets;
  conversion: ConversionInfo;
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
  const [issueGsmAuto, setIssueGsmAuto] = useState(false);
  const [productGsmByCode, setProductGsmByCode] = useState<Record<string, number>>({});
  const [productGsmByCodeThickness, setProductGsmByCodeThickness] = useState<Record<string, number>>({});
  const [issuing, setIssuing] = useState(false);


  // Edit thickness dialog
  const [editThicknessOpen, setEditThicknessOpen] = useState(false);
  const [editEntryId, setEditEntryId] = useState("");
  const [editThicknessValue, setEditThicknessValue] = useState("");
  const [editingThickness, setEditingThickness] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    // Clear any stale finished-stock caches so display always reflects DB.
    try {
      Object.keys(localStorage)
        .filter((k) => /inventory|stock|issued|finished/i.test(k))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      // ignore
    }

    // Fetch production entries (IN) — include gsm for unit conversion
    const { data: prodData, error: prodErr } = await supabase
      .from("production_entries")
      .select("id, date, product_code_id, total_quantity, quantity_per_roll, rolls_count, unit, thickness_mm, gsm, notes, product_codes(code), profiles:worker_id(name)")
      .order("date", { ascending: false })
      .limit(2000);
    if (prodErr) console.error("production_entries fetch error", prodErr);

    // Slitting + Head36 also produce finished stock under their own product_code_id.
    const [{ data: slitProd, error: slitErr }, { data: head36Prod, error: head36Err }] = await Promise.all([
      (supabase as any)
        .from("slitting_entries")
        .select("id, date, product_code_id, cut_quantity_produced, cut_width_mm, unit, thickness_mm, gsm")
        .order("date", { ascending: false })
        .limit(2000),
      (supabase as any)
        .from("head36_entries")
        .select("id, date, product_code_id, total_quantity, rolls_produced, roll_width_mm, length_per_tape_mtr, unit, thickness_mm, gsm")
        .order("date", { ascending: false })
        .limit(2000),
    ]);
    if (slitErr) console.warn("slitting_entries fetch error", slitErr);
    if (head36Err) console.warn("head36_entries fetch error", head36Err);

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
      if (!q || !isFinite(q)) return;
      b[u] = (b[u] ?? 0) + q;
    };
    const mergeBuckets = (target: Buckets, src: Buckets) => {
      (["meters", "sqm", "kg"] as UnitKey[]).forEach((u) => {
        const v = src[u];
        if (v != null && isFinite(v)) addBucket(target, u, v);
      });
    };
    // Compute meters/sqm/kg for a single entry given its raw qty, unit, width, gsm.
    // Width is only used when it is plausibly a full-width source roll. Narrow
    // slit cut widths must NOT be used to cross-convert meters↔sqm or we end up
    // with values like "2000 sqm = 5000 meters" using a 400mm cut width.
    const computeAllUnits = (rawQty: number, unitRaw: any, widthMm: number | null, gsm: number | null): Buckets => {
      const out: Buckets = {};
      if (!isFinite(rawQty) || rawQty === 0) return out;
      const u = normUnit(unitRaw);
      const safeWidth = widthMm != null && isFinite(widthMm) && widthMm >= MIN_FULL_ROLL_WIDTH_MM ? widthMm : null;
      const safeGsm = gsm != null && isFinite(gsm) && gsm > 0 ? gsm : null;
      let meters: number | null = null;
      let sqm: number | null = null;
      let kg: number | null = null;
      if (u === "meters") {
        meters = rawQty;
        if (safeWidth) sqm = (safeWidth / 1000) * rawQty;
        if (sqm != null && safeGsm) kg = (sqm * safeGsm) / 1000;
      } else if (u === "sqm") {
        sqm = rawQty;
        if (safeGsm) kg = (rawQty * safeGsm) / 1000;
        if (safeWidth) meters = rawQty / (safeWidth / 1000);
      } else if (u === "kg") {
        kg = rawQty;
        if (safeGsm) sqm = (rawQty * 1000) / safeGsm;
        if (sqm != null && safeWidth) meters = sqm / (safeWidth / 1000);
      } else {
        // unknown unit — assume meters as best-effort default
        meters = rawQty;
        if (safeWidth) sqm = (safeWidth / 1000) * rawQty;
        if (sqm != null && safeGsm) kg = (sqm * safeGsm) / 1000;
      }
      if (meters != null) out.meters = meters;
      if (sqm != null) out.sqm = sqm;
      if (kg != null) out.kg = kg;
      return out;
    };
    const parseNotesMeta = (notes: string | null | undefined) => {
      const text = String(notes ?? "");
      const firstNumber = (patterns: RegExp[]) => {
        for (const pattern of patterns) {
          const match = text.match(pattern);
          if (match) {
            const value = Number(match[1]);
            if (isFinite(value) && value > 0) return value;
          }
        }
        return null;
      };
      return {
        sqm: firstNumber([/\bsqm\s*[=:]\s*([\d.]+)/i, /square\s*meters?\s*[=:]\s*([\d.]+)/i]),
        kg: firstNumber([/\bkg\s*[=:]\s*([\d.]+)/i, /kilograms?\s*[=:]\s*([\d.]+)/i]),
        gsm: firstNumber([/\bgsm\s*[=:]\s*([\d.]+)/i, /\bGSM:\s*([\d.]+)/]),
        width_mm: firstNumber([
          /width[_\s-]?mm\s*[=:]\s*([\d.]+)/i,
          /width[_\s-]?per[_\s-]?roll\s*[=:]\s*([\d.]+)/i,
          /\bwidth\s*[=:]\s*([\d.]+)/i,
        ]),
      };
    };
    const isFinishedStockIssue = (i: any) => {
      const issueType = i.issue_type ?? null;
      return Boolean(i.product_code_id) && (issueType === null || issueType === "" || issueType === "finished_stock");
    };
    const getIssueBuckets = (i: any): Buckets => {
      const meta = parseNotesMeta(i.notes);
      const rawQty = Number(i.issue_quantity ?? i.quantity ?? 0);
      const gsm = i.gsm != null ? Number(i.gsm) : meta.gsm;
      const widthMmRaw = i.width_mm ?? i.roll_width_mm ?? i.product_width_mm ?? meta.width_mm;
      const widthMm = widthMmRaw != null ? Number(widthMmRaw) : null;
      const unit = i.issue_unit ?? i.unit;

      const buckets = computeAllUnits(rawQty, unit, widthMm, gsm);

      // Honor explicit stored sqm/kg if present (override computed)
      if (i.issue_quantity_sqm != null) buckets.sqm = Number(i.issue_quantity_sqm);
      else if (meta.sqm != null) buckets.sqm = meta.sqm;
      if (i.issue_quantity_kg != null) buckets.kg = Number(i.issue_quantity_kg);
      else if (meta.kg != null) buckets.kg = meta.kg;

      // Backfill meters from sqm+width if not yet set
      if (buckets.meters == null && buckets.sqm != null && widthMm && widthMm > 0) {
        buckets.meters = buckets.sqm / (widthMm / 1000);
      }
      // Backfill kg from sqm+gsm if not yet set
      if (buckets.kg == null && buckets.sqm != null && gsm && gsm > 0) {
        buckets.kg = (buckets.sqm * gsm) / 1000;
      }
      // Backfill sqm from kg+gsm or meters+width
      if (buckets.sqm == null) {
        if (buckets.kg != null && gsm && gsm > 0) buckets.sqm = (buckets.kg * 1000) / gsm;
        else if (buckets.meters != null && widthMm && widthMm > 0) buckets.sqm = buckets.meters * (widthMm / 1000);
      }
      return buckets;
    };

    // Per-product-code aggregates
    const pcTotals = new Map<string, { code: string; unit: string; produced: number; buckets: Buckets }>();
    const thicknessMap = new Map<string, Map<number | null, { produced: number; producedBuckets: Buckets; issuedBuckets: Buckets }>>();
    const issueMap = new Map<string, number>();
    const issuedBucketsMap = new Map<string, Buckets>();
    // Fallback width/gsm dictionaries used to backfill rows missing per-entry data.
    type ConversionFact = { value: number; source: string; priority: number };
    const widthByCode: Record<string, ConversionFact> = {};
    const widthByCodeThickness: Record<string, ConversionFact> = {};
    const gsmByCode: Record<string, ConversionFact> = {};
    const gsmByCodeThickness: Record<string, ConversionFact> = {};
    const setFact = (target: Record<string, ConversionFact>, key: string, fact: ConversionFact) => {
      const existing = target[key];
      if (!existing || fact.priority < existing.priority) target[key] = fact;
    };
    const recordWidth = (pcId: string, thickness: number | null, w: number | null | undefined, source: string, priority: number) => {
      if (!pcId || w == null) return;
      const wn = Number(w);
      if (!isFinite(wn) || wn <= 0) return;
      const fact = { value: wn, source, priority };
      setFact(widthByCode, pcId, fact);
      setFact(widthByCodeThickness, `${pcId}__${thickness ?? ""}`, fact);
    };
    const recordGsm = (pcId: string, thickness: number | null, g: number | null | undefined, source: string, priority: number) => {
      if (!pcId || g == null) return;
      const gn = Number(g);
      if (!isFinite(gn) || gn <= 0) return;
      const fact = { value: gn, source, priority };
      setFact(gsmByCode, pcId, fact);
      setFact(gsmByCodeThickness, `${pcId}__${thickness ?? ""}`, fact);
    };
    const missingDataLabel = (widthFact: ConversionFact | null, gsmFact: ConversionFact | null) => {
      const missing = [!widthFact ? "width" : null, !gsmFact ? "GSM" : null].filter(Boolean);
      return missing.length ? `Missing ${missing.join(" + ")}` : "Complete";
    };
    const getConversionInfo = (pcId: string, thickness: number | null, productLevel = false): ConversionInfo => {
      const key = `${pcId}__${thickness ?? ""}`;
      const rowWidth = productLevel ? null : (widthByCodeThickness[key] ?? null);
      const rowGsm = productLevel ? null : (gsmByCodeThickness[key] ?? null);
      const productWidth = widthByCode[pcId] ?? null;
      const productGsm = gsmByCode[pcId] ?? null;
      const widthFact = rowWidth ?? productWidth;
      const gsmFact = rowGsm ?? productGsm;
      return {
        widthMm: widthFact?.value ?? null,
        widthSource: rowWidth?.source ?? (productWidth ? (productLevel ? productWidth.source : `product-level ${productWidth.source}`) : null),
        gsm: gsmFact?.value ?? null,
        gsmSource: rowGsm?.source ?? (productGsm ? (productLevel ? productGsm.source : `product-level ${productGsm.source}`) : null),
        missingData: missingDataLabel(widthFact, gsmFact),
      };
    };
    const ensureIssued = (pcId: string) => {
      let b = issuedBucketsMap.get(pcId);
      if (!b) { b = {}; issuedBucketsMap.set(pcId, b); }
      return b;
    };
    const ensureThickness = (pcId: string, thickness: number | null) => {
      if (!thicknessMap.has(pcId)) thicknessMap.set(pcId, new Map());
      const tMap = thicknessMap.get(pcId)!;
      let row = tMap.get(thickness);
      if (!row) {
        row = { produced: 0, producedBuckets: {}, issuedBuckets: {} };
        tMap.set(thickness, row);
      }
      return row;
    };
    for (const p of (prodData ?? []) as any[]) {
      const pcId = p.product_code_id;
      const thickness = p.thickness_mm != null ? Number(p.thickness_mm) : null;
      const qty = Number(p.total_quantity ?? (p.rolls_count * p.quantity_per_roll));
      const meta = parseNotesMeta(p.notes);
      const gsm = p.gsm != null ? Number(p.gsm) : meta.gsm;
      const widthMm = meta.width_mm;
      recordWidth(pcId, thickness, widthMm, "production entry notes width_mm", 3);
      recordGsm(pcId, thickness, gsm, p.gsm != null ? "production_entries.gsm" : "production entry notes GSM", 2);

      let entry = pcTotals.get(pcId);
      if (!entry) {
        entry = { code: p.product_codes?.code ?? "—", unit: p.unit, produced: 0, buckets: {} };
        pcTotals.set(pcId, entry);
      }
      entry.produced += qty;
      const entryBuckets = computeAllUnits(qty, p.unit, widthMm, gsm);
      mergeBuckets(entry.buckets, entryBuckets);

      const trow = ensureThickness(pcId, thickness);
      trow.produced += qty;
      mergeBuckets(trow.producedBuckets, entryBuckets);

      console.log("finished stock conversion audit", {
        productCode: p.product_codes?.code ?? "—",
        thickness,
        sourceRowId: p.id,
        source: "production_entries",
        originalQuantity: qty,
        originalUnit: p.unit,
        widthMm: widthMm ?? null,
        widthSource: widthMm != null ? "production entry notes width_mm" : null,
        gsm: gsm ?? null,
        gsmSource: gsm != null ? (p.gsm != null ? "production_entries.gsm" : "notes") : null,
        normalizedMeters: entryBuckets.meters ?? null,
        normalizedSqm: entryBuckets.sqm ?? null,
        normalizedKg: entryBuckets.kg ?? null,
      });
    }

    // Add slitting + head36 produced (these carry their own width).
    const addProduced = (
      pcId: string,
      qty: number,
      unitRaw: any,
      gsm: number | null,
      thickness: number | null,
      widthMm: number | null,
      code: string | null,
    ) => {
      if (!pcId || !isFinite(qty) || qty <= 0) return;
      let entry = pcTotals.get(pcId);
      if (!entry) {
        entry = { code: code ?? "—", unit: String(unitRaw ?? "meters"), produced: 0, buckets: {} };
        pcTotals.set(pcId, entry);
      }
      entry.produced += qty;
      const eb = computeAllUnits(qty, unitRaw, widthMm, gsm);
      mergeBuckets(entry.buckets, eb);
      const trow = ensureThickness(pcId, thickness);
      trow.produced += qty;
      mergeBuckets(trow.producedBuckets, eb);
    };
    // Narrow cut widths from slitting must NOT be used as the source-roll width
    // when converting production_entries meters → sqm. Slit cut widths often
    // describe a narrow tape (e.g. 24mm, 175mm, 250mm) and would dramatically
    // under-report sqm for a full-width finished stock roll (~1000mm). Only
    // register slitting cut_width_mm as a fallback when it is plausibly a
    // full-width roll (>= MIN_FULL_ROLL_WIDTH_MM).
    for (const s of (slitProd ?? []) as any[]) {
      const widthMm = s.cut_width_mm != null ? Number(s.cut_width_mm) : null;
      const thickness = s.thickness_mm != null ? Number(s.thickness_mm) : null;
      const gsm = s.gsm != null ? Number(s.gsm) : null;
      if (widthMm != null && widthMm >= MIN_FULL_ROLL_WIDTH_MM) {
        recordWidth(s.product_code_id, thickness, widthMm, "slitting_entries.cut_width_mm", 2);
      } else if (widthMm != null && widthMm > 0) {
        console.warn("[stock] skipping narrow slit cut_width as source-width fallback", {
          product_code_id: s.product_code_id, thickness_mm: thickness, cut_width_mm: widthMm,
        });
      }
      recordGsm(s.product_code_id, thickness, gsm, "slitting_entries.gsm", 1);
      addProduced(
        s.product_code_id,
        Number(s.cut_quantity_produced ?? 0),
        s.unit,
        gsm,
        thickness,
        widthMm,
        null,
      );
    }
    for (const h of (head36Prod ?? []) as any[]) {
      const qty = Number(h.total_quantity ?? (Number(h.rolls_produced ?? 0) * Number(h.length_per_tape_mtr ?? 0)));
      const widthMm = h.roll_width_mm != null ? Number(h.roll_width_mm) : null;
      const thickness = h.thickness_mm != null ? Number(h.thickness_mm) : null;
      const gsm = h.gsm != null ? Number(h.gsm) : null;
      if (widthMm != null && widthMm >= MIN_FULL_ROLL_WIDTH_MM) {
        recordWidth(h.product_code_id, thickness, widthMm, "head36_entries.roll_width_mm", 2);
      } else if (widthMm != null && widthMm > 0) {
        console.warn("[stock] skipping narrow head36 roll_width as source-width fallback", {
          product_code_id: h.product_code_id, thickness_mm: thickness, roll_width_mm: widthMm,
        });
      }
      recordGsm(h.product_code_id, thickness, gsm, "head36_entries.gsm", 1);
      addProduced(
        h.product_code_id,
        qty,
        h.unit,
        gsm,
        thickness,
        widthMm,
        null,
      );
    }

    const finishedStockIssues = stockIssueRows.filter(isFinishedStockIssue);
    for (const i of finishedStockIssues) {
      const pcId = i.product_code_id;
      const thickness = i.thickness_mm != null ? Number(i.thickness_mm) : null;
      // Capture fallbacks from issue rows.
      const meta = parseNotesMeta(i.notes);
      const issueGsm = i.gsm != null ? Number(i.gsm) : meta.gsm;
      const issueWidth = i.width_mm ?? i.roll_width_mm ?? i.product_width_mm ?? meta.width_mm;
      const issueWidthSource = i.width_mm != null ? "stock_issues.width_mm" : i.roll_width_mm != null ? "stock_issues.roll_width_mm" : i.product_width_mm != null ? "stock_issues.product_width_mm" : "stock issue notes width_mm";
      recordGsm(pcId, thickness, issueGsm, i.gsm != null ? "stock_issues.gsm" : "stock issue notes GSM", 3);
      recordWidth(pcId, thickness, issueWidth, issueWidthSource, 4);

      const b = ensureIssued(pcId);
      const rowBuckets = getIssueBuckets(i);
      mergeBuckets(b, rowBuckets);
      const primaryUnit = normUnit(pcTotals.get(pcId)?.unit) ?? normUnit(i.issue_unit ?? i.unit) ?? "sqm";
      const primaryIssued = Number(rowBuckets[primaryUnit] ?? i.issue_quantity ?? i.quantity ?? 0);
      issueMap.set(pcId, (issueMap.get(pcId) ?? 0) + primaryIssued);
      const trow = ensureThickness(pcId, thickness);
      mergeBuckets(trow.issuedBuckets, rowBuckets);
    }

    setProductGsmByCode(Object.fromEntries(Object.entries(gsmByCode).map(([key, fact]) => [key, fact.value])));
    setProductGsmByCodeThickness(Object.fromEntries(Object.entries(gsmByCodeThickness).map(([key, fact]) => [key, fact.value])));

    // Include finished-product sales in issued totals (they reduce finished stock)
    for (const s of (salesData ?? []) as any[]) {
      if (s.item_type === "finished_product" && s.product_code_id) {
        const pcId = s.product_code_id;
        const q = Number(s.quantity);
        issueMap.set(pcId, (issueMap.get(pcId) ?? 0) + q);
        const b = ensureIssued(pcId);
        const thickness = s.thickness_mm != null ? Number(s.thickness_mm) : null;
        const conversion = getConversionInfo(pcId, thickness);
        const saleBuckets = computeAllUnits(q, s.unit, conversion.widthMm, conversion.gsm);
        mergeBuckets(b, saleBuckets);
        const trow = ensureThickness(pcId, thickness);
        mergeBuckets(trow.issuedBuckets, saleBuckets);
      }
    }

    // ── Backfill pass: fill missing sqm/kg in every thickness row using
    // the best known width/gsm for the (product, thickness) group, then
    // recompute pcTotals/issued buckets from the resulting thickness rows.
    const backfillBuckets = (b: Buckets, width: number | null, gsm: number | null) => {
      if (b.sqm == null && b.meters != null && width && width > 0) {
        b.sqm = b.meters * (width / 1000);
      }
      if (b.meters == null && b.sqm != null && width && width > 0) {
        b.meters = b.sqm / (width / 1000);
      }
      if (b.kg == null && b.sqm != null && gsm && gsm > 0) {
        b.kg = (b.sqm * gsm) / 1000;
      }
      if (b.sqm == null && b.kg != null && gsm && gsm > 0) {
        b.sqm = (b.kg * 1000) / gsm;
        if (b.meters == null && width && width > 0) b.meters = b.sqm / (width / 1000);
      }
    };
    for (const [pcId, tMap] of thicknessMap.entries()) {
      for (const [t, row] of tMap.entries()) {
        const conversion = getConversionInfo(pcId, t);
        backfillBuckets(row.producedBuckets, conversion.widthMm, conversion.gsm);
        backfillBuckets(row.issuedBuckets, conversion.widthMm, conversion.gsm);
      }
      // Recompute top-card produced + issued buckets as sum of thickness rows.
      const pcEntry = pcTotals.get(pcId);
      const summedProduced: Buckets = {};
      const summedIssued: Buckets = {};
      for (const row of tMap.values()) {
        (["meters", "sqm", "kg"] as UnitKey[]).forEach((u) => {
          if (row.producedBuckets[u] != null) summedProduced[u] = (summedProduced[u] ?? 0) + (row.producedBuckets[u] as number);
          if (row.issuedBuckets[u] != null) summedIssued[u] = (summedIssued[u] ?? 0) + (row.issuedBuckets[u] as number);
        });
      }
      if (pcEntry) pcEntry.buckets = summedProduced;
      else pcTotals.set(pcId, { code: "—", unit: "meters", produced: 0, buckets: summedProduced });
      if (Object.keys(summedIssued).length) issuedBucketsMap.set(pcId, summedIssued);
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
        for (const [t, row] of Array.from(tMap.entries()).sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0))) {
          breakdown.push({
            thickness_mm: t,
            produced: row.produced,
            producedBuckets: row.producedBuckets,
            issuedBuckets: row.issuedBuckets,
            conversion: getConversionInfo(pcId, t),
          });
        }
      }
      const matchedStockIssues = finishedStockIssues.filter((i) => String(i.product_code_id) === String(pcId));
      const productConversion = getConversionInfo(pcId, null, true);
      // Debug: surface the width source actually chosen for this product.
      console.log("[stock] finished stock conversion", {
        product_code: prod?.code ?? issueProductCodeMap.get(pcId) ?? "—",
        product_code_id: pcId,
        meters: prod?.buckets?.meters ?? null,
        width_mm: productConversion.widthMm,
        width_source: productConversion.widthSource,
        gsm: productConversion.gsm,
        gsm_source: productConversion.gsmSource,
        sqm: prod?.buckets?.sqm ?? null,
        warn_narrow_width: productConversion.widthMm != null && productConversion.widthMm < 100,
      });
      summaryList.push({
        product_code_id: pcId,
        code: prod?.code ?? issueProductCodeMap.get(pcId) ?? "—",
        unit: prod?.unit ?? "meters",
        produced,
        issued,
        available: produced - issued,
        producedBuckets: prod?.buckets ?? {},
        issuedBuckets,
        conversion: productConversion,
        thicknessBreakdown: breakdown,
        debugMatchedStockIssues: matchedStockIssues,
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
    setIssueGsmAuto(false);
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
                  const label: Record<UnitKey, string> = { meters: "Meters", sqm: "SQM", kg: "KG" };
                  const rows = units.map((u) => {
                    const prodRaw = s.producedBuckets[u];
                    const issRaw = s.issuedBuckets[u];
                    const prod = prodRaw != null && isFinite(prodRaw) ? Number(prodRaw) : null;
                    const iss = issRaw != null && isFinite(issRaw) ? Number(issRaw) : (prod != null ? 0 : null);
                    const avail = prod != null && iss != null ? (prod - iss) : null;
                    const missing = getMissingUnitReason(u, s.conversion);
                    return { unit: u, prod, iss, avail, missing };
                  });
                  const renderValue = (value: number | null, missing: string | null, emphasisClass: string) => {
                    if (value != null) return <span className={emphasisClass}>{fmt(value)}</span>;
                    return <span className="text-[11px] leading-tight text-muted-foreground">{missing ?? "—"}</span>;
                  };
                  return (
                    <div className="space-y-2 mb-3">
                      <div className="grid grid-cols-[64px_1fr_1fr_1fr] gap-2 text-xs text-muted-foreground px-1">
                        <span>Unit</span>
                        <span className="text-right">Produced</span>
                        <span className="text-right">Issued</span>
                        <span className="text-right">Available</span>
                      </div>
                      {rows.map((r) => (
                        <div key={r.unit} className="grid grid-cols-[64px_1fr_1fr_1fr] gap-2 items-center px-1 text-sm">
                          <span className="font-medium text-xs">{label[r.unit]}</span>
                          <span className="text-right">{renderValue(r.prod, r.missing, "text-green-600 font-semibold")}</span>
                          <span className="text-right">{renderValue(r.iss, r.missing, "text-red-500 font-semibold")}</span>
                          <span className={`text-right font-bold ${r.avail == null ? "" : r.avail > 0 ? "text-primary" : "text-destructive"}`}>
                            {r.avail == null ? <span className="text-[11px] leading-tight text-muted-foreground font-normal">{r.missing ?? "—"}</span> : fmt(r.avail)}
                          </span>
                        </div>
                      ))}
                      <p className="px-1 pt-1 text-[11px] leading-snug text-muted-foreground">
                        {formatConversionData(s.conversion)}
                      </p>
                    </div>
                  );
                })()}

                {/* Thickness Breakdown — Produced | Issued | Available per unit */}
                {s.thicknessBreakdown.length > 0 && (() => {
                  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
                  const units: UnitKey[] = ["meters", "sqm", "kg"];
                  const label: Record<UnitKey, string> = { meters: "m", sqm: "sqm", kg: "kg" };
                  return (
                    <div className="mt-2 border rounded-md overflow-hidden">
                      <div className="bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
                        Thickness Breakdown
                      </div>
                      <div className="divide-y">
                        {s.thicknessBreakdown.map((t) => {
                          const missingReason: Record<UnitKey, string | null> = {
                            meters: null,
                            sqm: getMissingUnitReason("sqm", t.conversion),
                            kg: getMissingUnitReason("kg", t.conversion),
                          };
                          // Debug log per row
                          console.log("finished stock thickness calc", {
                            product_code_id: s.product_code_id,
                            code: s.code,
                            thickness_mm: t.thickness_mm,
                            produced: t.producedBuckets,
                            issued: t.issuedBuckets,
                            width_mm: t.conversion.widthMm,
                            gsm: t.conversion.gsm,
                          });
                          const rows = units.map((u) => {
                            const p = t.producedBuckets[u];
                            const i = t.issuedBuckets[u];
                            const prod = p != null && isFinite(p) ? Number(p) : null;
                            const iss = i != null && isFinite(i) ? Number(i) : null;
                            let avail: number | null = null;
                            if (prod != null && iss != null) avail = prod - iss;
                            else if (prod != null && iss == null) avail = prod;
                            return { unit: u, prod, iss, avail, missing: missingReason[u] };
                          });
                          const renderVal = (v: number | null, missing: string | null, cls: string) => {
                            if (v != null) return <span className={cls}>{fmt(v)}</span>;
                            return <span className="text-[10px] leading-tight text-muted-foreground">{missing ?? "—"}</span>;
                          };
                          return (
                            <div key={String(t.thickness_mm)} className="px-3 py-2 space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-semibold">{t.thickness_mm != null ? `${t.thickness_mm} mm` : "No thickness"}</span>
                                <span className="text-[10px] text-muted-foreground">{t.conversion.missingData}</span>
                              </div>
                              <div className="grid grid-cols-[40px_1fr_1fr_1fr] gap-2 text-[10px] text-muted-foreground">
                                <span>Unit</span>
                                <span className="text-right">Produced</span>
                                <span className="text-right">Issued</span>
                                <span className="text-right">Available</span>
                              </div>
                              {rows.map((r) => (
                                <div key={r.unit} className="grid grid-cols-[40px_1fr_1fr_1fr] gap-2 items-center text-xs">
                                  <span className="font-medium">{label[r.unit]}</span>
                                  <span className="text-right">{renderVal(r.prod, r.missing, "text-green-600 font-medium")}</span>
                                  <span className="text-right">{renderVal(r.iss, r.missing, "text-red-500 font-medium")}</span>
                                  <span className={`text-right font-bold ${r.avail == null ? "" : r.avail > 0 ? "text-primary" : "text-destructive"}`}>
                                    {r.avail == null ? <span className="text-[10px] font-normal text-muted-foreground">{r.missing ?? "—"}</span> : fmt(r.avail)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

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
                onValueChange={(v) => {
                  setIssueProductCodeId(v);
                  const key = `${v}__${issueThickness ? Number(issueThickness) : ""}`;
                  const g = productGsmByCodeThickness[key] ?? productGsmByCode[v];
                  if (g && g > 0) {
                    setIssueGsm(String(g));
                    setIssueGsmAuto(true);
                  } else {
                    setIssueGsmAuto(false);
                  }
                }}
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
                <Input type="number" min="0" step="0.01" value={issueThickness} onChange={(e) => {
                  const t = e.target.value;
                  setIssueThickness(t);
                  if (issueProductCodeId) {
                    const key = `${issueProductCodeId}__${t ? Number(t) : ""}`;
                    const g = productGsmByCodeThickness[key] ?? productGsmByCode[issueProductCodeId];
                    if (g && g > 0) { setIssueGsm(String(g)); setIssueGsmAuto(true); }
                  }
                }} placeholder="Optional" />
              </div>
              <div className="space-y-2">
                <Label>GSM{issueGsmAuto ? " (auto from product)" : ""}</Label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={issueGsm}
                  readOnly={issueGsmAuto}
                  className={issueGsmAuto ? "bg-muted cursor-not-allowed" : ""}
                  onChange={(e) => setIssueGsm(e.target.value)}
                  placeholder="for conversion"
                />
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
