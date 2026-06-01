import { supabase } from "@/integrations/supabase/client";

/**
 * Returns currently available finished-product stock for a given product_code_id.
 * available = sum(production_entries.total_quantity)
 *           + sum(slitting_entries.cut_quantity_produced)
 *           + sum(head36_entries.total_quantity)
 *           - sum(stock_issues.quantity)
 *           - sum(sales.quantity where item_type='finished_product')
 */
export async function getFinishedProductAvailable(productCodeId: string): Promise<number> {
  const [prodRes, slitRes, head36Res, issueRes, saleRes] = await Promise.all([
    supabase
      .from("production_entries")
      .select("total_quantity, rolls_count, quantity_per_roll")
      .eq("product_code_id", productCodeId)
      .limit(5000),
    supabase
      .from("slitting_entries")
      .select("cut_quantity_produced")
      .eq("product_code_id", productCodeId)
      .limit(5000),
    supabase
      .from("head36_entries")
      .select("total_quantity, rolls_produced, length_per_tape_mtr")
      .eq("product_code_id", productCodeId)
      .limit(5000),
    supabase
      .from("stock_issues")
      .select("quantity")
      .eq("product_code_id", productCodeId)
      .limit(5000),
    supabase
      .from("sales")
      .select("quantity")
      .eq("item_type", "finished_product")
      .eq("product_code_id", productCodeId)
      .limit(5000),
  ]);

  const produced = (prodRes.data ?? []).reduce((sum: number, p: any) => {
    const qty = Number(p.total_quantity ?? Number(p.rolls_count) * Number(p.quantity_per_roll));
    return sum + (Number.isFinite(qty) ? qty : 0);
  }, 0);
  const slit = (slitRes.data ?? []).reduce(
    (s: number, r: any) => s + Number(r.cut_quantity_produced ?? 0),
    0,
  );
  const head36 = (head36Res.data ?? []).reduce((s: number, r: any) => {
    const qty = Number(
      r.total_quantity ?? Number(r.rolls_produced) * Number(r.length_per_tape_mtr ?? 0),
    );
    return s + (Number.isFinite(qty) ? qty : 0);
  }, 0);
  const issued = (issueRes.data ?? []).reduce((s: number, i: any) => s + Number(i.quantity ?? 0), 0);
  const sold = (saleRes.data ?? []).reduce((s: number, i: any) => s + Number(i.quantity ?? 0), 0);

  return produced + slit + head36 - issued - sold;
}
