/**
 * What a sales bill prints, and in what order.
 *
 * Three rules shape everything here.
 *
 * A tax invoice is not a free-for-all. CGST Rule 46 puts description, HSN,
 * quantity with its unit, taxable value, rate of tax and amount of tax on the
 * face of the invoice. Those columns are `locked` and no setting removes them
 * — a layout picker that lets someone switch off HSN hands them a bill that
 * fails a GST audit, and they would have no way to know.
 *
 * A bill is a document somebody is holding. The layout is copied onto the
 * invoice when it saves, so a reprint matches the copy the retailer has, and
 * an invoice with no layout stored (everything issued before this existed)
 * renders LEGACY — the eleven columns Dhela always printed. No bill that
 * already exists changes because the workspace changed a setting.
 *
 * Custom columns are for a person to read. Nothing computes with them. The
 * real fields already exist for the things that matter: quantity, rate, tax,
 * batch and expiry are typed columns with constraints, and a date typed into
 * a custom field is a date nothing will ever warn on or sort by.
 */

export type CustomColumn = { id: string; label: string };

export type BillLayout = {
  /** Ordered column keys. A custom column is "custom:<id>". */
  columns: string[];
  /** Definitions for the custom:<id> keys above. */
  custom: CustomColumn[];
  /** Default bill-level field labels (transport, LR number…). */
  fields: string[];
};

export type Align = "left" | "right";

type BuiltIn = {
  key: string;
  /** English label; the screens pass it through t(). */
  label: string;
  align: Align;
  /** Required on a tax invoice — cannot be switched off. */
  locked?: boolean;
  /**
   * Required by Rule 46 but off in LEGACY, so switching it on is the
   * workspace's call rather than something a migration did to their bills.
   */
  advised?: string;
  /** Can be typed on the line-entry screen when the column is on. */
  input?: "text" | "number" | "date";
  hint?: string;
};

export const BUILT_IN: BuiltIn[] = [
  { key: "line_no", label: "#", align: "left" },
  { key: "description", label: "Description", align: "left", locked: true },
  { key: "hsn", label: "HSN", align: "left", locked: true, input: "text" },
  { key: "batch", label: "Batch", align: "left", input: "text" },
  { key: "expiry_date", label: "Expiry", align: "left", input: "date",
    hint: "Already stored on every line — pharma and FMCG bills usually print it." },
  { key: "mrp", label: "MRP", align: "right", input: "number",
    hint: "Fills in from the product. Printed for reference only." },
  { key: "quantity", label: "Qty", align: "right", locked: true, input: "number" },
  { key: "unit", label: "Unit", align: "left", input: "text",
    advised: "GST rules require quantity to be shown with its unit.",
    hint: "Fills in from the product." },
  { key: "free_quantity", label: "Free", align: "right", input: "number",
    hint: "Free scheme units. They carry no price but do count into cost and profit." },
  { key: "rate", label: "Rate", align: "right" },
  { key: "discount_pct", label: "Disc%", align: "right", input: "number" },
  { key: "discount_amount", label: "Disc ₹", align: "right" },
  { key: "taxable_value", label: "Taxable", align: "right", locked: true },
  { key: "gst_rate", label: "GST%", align: "right", locked: true, input: "number" },
  { key: "tax_amount", label: "Tax", align: "right", locked: true },
  { key: "line_total", label: "Total", align: "right", locked: true },
];

const BY_KEY = new Map(BUILT_IN.map(c => [c.key, c]));
export const builtIn = (key: string) => BY_KEY.get(key);
export const LOCKED = BUILT_IN.filter(c => c.locked).map(c => c.key);

/**
 * Exactly what Dhela printed before this feature. Every invoice with no stored
 * layout renders this, which is what keeps old bills looking like themselves.
 */
export const LEGACY: BillLayout = {
  columns: ["line_no", "description", "hsn", "batch", "quantity", "rate",
            "discount_pct", "taxable_value", "gst_rate", "tax_amount", "line_total"],
  custom: [],
  fields: [],
};

/**
 * What a workspace that has never touched the setting gets on a new bill.
 * Deliberately identical to LEGACY: a distributor who never asked for this
 * should not discover their bill format changed under them.
 */
export const DEFAULT_LAYOUT: BillLayout = LEGACY;

/** Past this the table stops fitting A4 portrait and starts wrapping. */
export const MAX_COLUMNS = 14;
export const CROWDED_AT = 12;
export const MAX_CUSTOM_COLUMNS = 4;
export const MAX_BILL_FIELDS = 6;
export const MAX_LABEL_LEN = 24;
export const MAX_VALUE_LEN = 80;

export const isCustom = (key: string) => key.startsWith("custom:");
export const customId = (key: string) => key.slice("custom:".length);

/**
 * Make any stored or posted layout safe to render and safe to save.
 *
 * Runs on the server against whatever a client posted, and on the client
 * against whatever is in the database — a layout written by an older build, or
 * a custom column somebody deleted while a draft referenced it. Anything it
 * cannot vouch for is dropped rather than rendered, and the locked columns are
 * put back whatever the input said.
 */
export function normaliseLayout(input: unknown): BillLayout {
  const raw = (input ?? {}) as Partial<BillLayout>;

  const custom: CustomColumn[] = [];
  const seenIds = new Set<string>();
  for (const c of Array.isArray(raw.custom) ? raw.custom : []) {
    const id = typeof c?.id === "string" ? c.id.trim() : "";
    const label = typeof c?.label === "string" ? c.label.trim().slice(0, MAX_LABEL_LEN) : "";
    // An unlabelled column prints a blank heading nobody can interpret, and an
    // id with a colon in it would not survive the "custom:<id>" key round-trip.
    if (!id || !label || id.includes(":") || seenIds.has(id)) continue;
    seenIds.add(id);
    custom.push({ id, label });
    if (custom.length >= MAX_CUSTOM_COLUMNS) break;
  }

  const columns: string[] = [];
  for (const key of Array.isArray(raw.columns) ? raw.columns : []) {
    if (typeof key !== "string" || columns.includes(key)) continue;
    if (isCustom(key)) {
      if (seenIds.has(customId(key))) columns.push(key);
    } else if (BY_KEY.has(key)) {
      columns.push(key);
    }
  }

  // Locked columns go back in even if the client dropped them. Appended in
  // catalogue order so the result is still a sensible left-to-right bill
  // rather than the mandatory ones piled on the end in posted order.
  for (const c of BUILT_IN) {
    if (c.locked && !columns.includes(c.key)) {
      const at = BUILT_IN.findIndex(b => b.key === c.key);
      const idx = columns.findIndex(k => !isCustom(k) && BUILT_IN.findIndex(b => b.key === k) > at);
      if (idx === -1) columns.push(c.key); else columns.splice(idx, 0, c.key);
    }
  }

  const fields: string[] = [];
  for (const f of Array.isArray(raw.fields) ? raw.fields : []) {
    const label = typeof f === "string" ? f.trim().slice(0, MAX_LABEL_LEN) : "";
    if (label && !fields.includes(label)) fields.push(label);
    if (fields.length >= MAX_BILL_FIELDS) break;
  }

  return { columns: columns.slice(0, MAX_COLUMNS), custom, fields };
}

/**
 * The layout a saved invoice prints with. Null means it predates the feature,
 * and the answer is the eleven columns it was issued with.
 */
export const layoutForInvoice = (stored: unknown): BillLayout =>
  stored == null ? LEGACY : normaliseLayout(stored);

/** The layout a new bill starts from. */
export const layoutForNewBill = (orgDefault: unknown): BillLayout =>
  orgDefault == null ? DEFAULT_LAYOUT : normaliseLayout(orgDefault);

/** Strip custom values down to the columns this layout actually prints. */
export function cleanExtra(
  extra: Record<string, unknown> | null | undefined,
  allowed: Set<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (!allowed.has(k)) continue;
    const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
    if (s) out[k] = s.slice(0, MAX_VALUE_LEN);
  }
  return out;
}

/** Bill-level fields are keyed by their own label, so they self-describe. */
export function cleanBillFields(
  extra: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(extra ?? {})) {
    const label = k.trim().slice(0, MAX_LABEL_LEN);
    const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
    if (!label || !s) continue;
    out[label] = s.slice(0, MAX_VALUE_LEN);
    if (Object.keys(out).length >= MAX_BILL_FIELDS) break;
  }
  return out;
}

export type PrintableLine = {
  line_no: number | null;
  description: string;
  hsn: string | null;
  batch: string | null;
  expiry_date: string | null;
  quantity: number | string | null;
  free_quantity: number | string | null;
  unit: string | null;
  mrp: number | string | null;
  rate: number | string | null;
  discount_pct: number | string | null;
  discount_amount: number | string | null;
  taxable_value: number | string | null;
  gst_rate: number | string | null;
  tax_amount: number | string | null;
  line_total: number | string | null;
  extra?: Record<string, string> | null;
};

const n2 = (v: unknown) => Number(v ?? 0).toFixed(2);
const n1 = (v: unknown) => Number(v ?? 0).toFixed(1);

/**
 * One cell, formatted exactly as the fixed table formatted it, so turning the
 * feature on does not quietly restyle a figure on anybody's bill.
 */
export function cellValue(key: string, l: PrintableLine, layout: BillLayout): string {
  if (isCustom(key)) return l.extra?.[customId(key)] ?? "—";
  switch (key) {
    case "line_no": return String(l.line_no ?? "");
    case "description": return l.description ?? "";
    case "hsn": return l.hsn ?? "—";
    case "batch": return l.batch ?? "—";
    case "expiry_date": return l.expiry_date ?? "—";
    case "unit": return l.unit ?? "—";
    case "quantity": return Number(l.quantity ?? 0).toString();
    case "free_quantity": return Number(l.free_quantity ?? 0).toString();
    case "mrp": return l.mrp == null ? "—" : n2(l.mrp);
    case "rate": return n2(l.rate);
    case "discount_pct": return n1(l.discount_pct);
    case "discount_amount": return n2(l.discount_amount);
    case "taxable_value": return n2(l.taxable_value);
    case "gst_rate": return n1(l.gst_rate);
    case "tax_amount": return n2(l.tax_amount);
    case "line_total": return n2(l.line_total);
    default: void layout; return "";
  }
}

export function headingFor(key: string, layout: BillLayout): string {
  if (isCustom(key)) {
    return layout.custom.find(c => c.id === customId(key))?.label ?? "";
  }
  return BY_KEY.get(key)?.label ?? key;
}

export function alignFor(key: string): Align {
  return isCustom(key) ? "left" : (BY_KEY.get(key)?.align ?? "left");
}
