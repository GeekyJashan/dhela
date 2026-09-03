/**
 * Compute suggested selling rate for a product for a given retailer.
 * Priority:
 *   1. Override for (product, retailer) — dealer-specific price
 *   2. Override for (product, retailer = NULL) — product default custom rate
 *   3. product.selling_rate (manually set)
 *   4. product.mrp — billing basis; the stock-group A/B/C discount does the pricing
 *   5. last_purchase_rate * (1 + margin%) — only when no MRP is known
 */
export type PriceOverride = {
  product_id: string;
  retailer_id: string | null;
  selling_rate: number;
  discount_pct: number | null;
};

export type ProductForPricing = {
  id: string;
  selling_rate: number | null;
  last_purchase_rate: number | null;
  purchase_rate: number | null;
  avg_cost: number | null;
  default_margin_pct: number | null;
  mrp: number | null;
  gst_rate: number | null;
};

export type RetailerCategory = "A" | "B" | "C";

export type StockGroup = {
  id: string;
  name: string;
  hsn_code: string | null;
  discount_a: number | null;
  discount_b: number | null;
  discount_c: number | null;
};

/** Discount % for a retailer category from the product's stock group. */
export function stockGroupDiscount(group: StockGroup | null | undefined, category: RetailerCategory | null | undefined): number | null {
  if (!group) return null;
  switch (category ?? "C") {
    case "A": return Number(group.discount_a ?? 0);
    case "B": return Number(group.discount_b ?? 0);
    default: return Number(group.discount_c ?? 0);
  }
}

export function suggestPrice(
  product: ProductForPricing,
  retailerId: string | null,
  overrides: PriceOverride[],
  orgDefaultMarginPct: number | null,
): { rate: number; discountPct: number | null; source: string } {
  const dealer = overrides.find(o => o.product_id === product.id && o.retailer_id === retailerId);
  if (dealer) return { rate: Number(dealer.selling_rate), discountPct: Number(dealer.discount_pct ?? 0), source: "dealer-override" };

  const global = overrides.find(o => o.product_id === product.id && o.retailer_id === null);
  if (global) return { rate: Number(global.selling_rate), discountPct: Number(global.discount_pct ?? 0), source: "product-override" };

  // discountPct: null means "no override — resolve from stock group / retailer".
  if (product.selling_rate && Number(product.selling_rate) > 0) {
    return { rate: Number(product.selling_rate), discountPct: null, source: "product-default" };
  }

  // Bill on MRP; the stock-group A/B/C discount carries the pricing.
  if (product.mrp && Number(product.mrp) > 0) {
    return { rate: Number(product.mrp), discountPct: null, source: "mrp" };
  }

  // No MRP known — fall back to cost plus margin so the rate isn't zero.
  const cost = Number(product.last_purchase_rate ?? product.purchase_rate ?? 0);
  const margin = Number(product.default_margin_pct ?? orgDefaultMarginPct ?? 15);
  if (cost > 0) {
    return { rate: +(cost * (1 + margin / 100)).toFixed(2), discountPct: null, source: `margin ${margin}%` };
  }
  return { rate: 0, discountPct: null, source: "none" };
}

/**
 * Split GST by supplier vs buyer state code.
 *
 * `known` is the important half. Two state codes decide whether a supply is
 * IGST or CGST plus SGST, and with either one missing there is no answer, only
 * a guess. This used to return isInterstate:false in that case, which is not a
 * neutral default: it charges CGST and SGST, so an out-of-state buyer whose
 * state code was blank got the wrong tax head on a real invoice, frozen at
 * issue time. Callers must check `known` before letting an invoice be issued
 * with tax on it.
 */
export function splitGst(supplierState: string | null | undefined, buyerState: string | null | undefined) {
  const a = supplierState?.trim() ?? "";
  const b = buyerState?.trim() ?? "";
  const known = a !== "" && b !== "";
  return { isInterstate: known && a !== b, known };
}

export type SalesLineDraft = {
  product_id: string | null;
  description: string;
  hsn: string | null;
  batch: string | null;
  expiry_date: string | null;
  quantity: number;
  free_quantity: number;
  unit: string | null;
  mrp: number | null;
  rate: number;
  discount_pct: number;
  gst_rate: number;
  cost_price: number | null;
};

export type LineTotals = {
  discount_amount: number;
  taxable_value: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  tax_amount: number;
  line_total: number;
  profit: number;
};

export function computeLine(line: SalesLineDraft, isInterstate: boolean): LineTotals {
  const gross = line.quantity * line.rate;
  const discount_amount = +((gross * (line.discount_pct || 0)) / 100).toFixed(2);
  const taxable_value = +(gross - discount_amount).toFixed(2);
  const tax_amount = +((taxable_value * (line.gst_rate || 0)) / 100).toFixed(2);
  const cgst_amount = isInterstate ? 0 : +(tax_amount / 2).toFixed(2);
  const sgst_amount = isInterstate ? 0 : +(tax_amount - cgst_amount).toFixed(2);
  const igst_amount = isInterstate ? tax_amount : 0;
  const line_total = +(taxable_value + tax_amount).toFixed(2);
  // COGS covers every unit shipped, billed + free (free goods are a real cost
  // with no revenue), matching stock deduction and the server-locked profit.
  const cost = (line.cost_price ?? 0) * (line.quantity + (line.free_quantity || 0));
  const profit = +(taxable_value - cost).toFixed(2);
  return { discount_amount, taxable_value, cgst_amount, sgst_amount, igst_amount, tax_amount, line_total, profit };
}

export function computeInvoiceTotals(lines: (SalesLineDraft & LineTotals)[]) {
  const subtotal = +lines.reduce((s, l) => s + l.taxable_value, 0).toFixed(2);
  const discount_total = +lines.reduce((s, l) => s + l.discount_amount, 0).toFixed(2);
  const cgst_total = +lines.reduce((s, l) => s + l.cgst_amount, 0).toFixed(2);
  const sgst_total = +lines.reduce((s, l) => s + l.sgst_amount, 0).toFixed(2);
  const igst_total = +lines.reduce((s, l) => s + l.igst_amount, 0).toFixed(2);
  const tax_total = +(cgst_total + sgst_total + igst_total).toFixed(2);
  const total_cost = +lines.reduce((s, l) => s + (l.cost_price ?? 0) * l.quantity, 0).toFixed(2);
  const total_profit = +lines.reduce((s, l) => s + l.profit, 0).toFixed(2);
  const raw_total = subtotal + tax_total;
  const grand_total = Math.round(raw_total);
  const round_off = +(grand_total - raw_total).toFixed(2);
  return { subtotal, discount_total, cgst_total, sgst_total, igst_total, tax_total, total_cost, total_profit, grand_total, round_off };
}

/** English rupees in words for tax invoice footer. */
export function amountInWords(n: number): string {
  const num = Math.round(n);
  if (num === 0) return "Zero Rupees Only";
  const ones = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  const tens = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
  const two = (n: number): string => n < 20 ? ones[n] : `${tens[Math.floor(n/10)]}${n%10 ? " " + ones[n%10] : ""}`;
  const three = (n: number): string => n >= 100 ? `${ones[Math.floor(n/100)]} Hundred${n%100 ? " " + two(n%100) : ""}` : two(n);
  let x = num, out = "";
  const cr = Math.floor(x / 10000000); x %= 10000000;
  const lk = Math.floor(x / 100000); x %= 100000;
  const th = Math.floor(x / 1000); x %= 1000;
  if (cr) out += `${three(cr)} Crore `;
  if (lk) out += `${three(lk)} Lakh `;
  if (th) out += `${three(th)} Thousand `;
  if (x) out += three(x);
  return `${out.trim()} Rupees Only`;
}
