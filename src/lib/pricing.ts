/**
 * Compute suggested selling rate for a product for a given retailer.
 * Priority:
 *   1. Override for (product, retailer) — dealer-specific price
 *   2. Override for (product, retailer = NULL) — product default custom rate
 *   3. product.selling_rate (manually set)
 *   4. last_purchase_rate * (1 + margin%)   margin resolved from
 *        product.default_margin_pct ?? org.default_margin_pct ?? 15
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
  default_margin_pct: number | null;
  mrp: number | null;
  gst_rate: number | null;
};

export function suggestPrice(
  product: ProductForPricing,
  retailerId: string | null,
  overrides: PriceOverride[],
  orgDefaultMarginPct: number | null,
): { rate: number; discountPct: number; source: string } {
  const dealer = overrides.find(o => o.product_id === product.id && o.retailer_id === retailerId);
  if (dealer) return { rate: Number(dealer.selling_rate), discountPct: Number(dealer.discount_pct ?? 0), source: "dealer-override" };

  const global = overrides.find(o => o.product_id === product.id && o.retailer_id === null);
  if (global) return { rate: Number(global.selling_rate), discountPct: Number(global.discount_pct ?? 0), source: "product-override" };

  if (product.selling_rate && Number(product.selling_rate) > 0) {
    return { rate: Number(product.selling_rate), discountPct: 0, source: "product-default" };
  }

  const cost = Number(product.last_purchase_rate ?? product.purchase_rate ?? 0);
  const margin = Number(product.default_margin_pct ?? orgDefaultMarginPct ?? 15);
  const rate = cost > 0 ? +(cost * (1 + margin / 100)).toFixed(2) : 0;
  return { rate, discountPct: 0, source: `margin ${margin}%` };
}

/** Split GST by supplier vs buyer state code. */
export function splitGst(supplierState: string | null | undefined, buyerState: string | null | undefined) {
  const isInterstate =
    !!supplierState && !!buyerState && supplierState.trim() !== buyerState.trim();
  return { isInterstate };
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
  const cost = (line.cost_price ?? 0) * line.quantity;
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
