import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLogger } from "./logger";
import { geminiModel } from "./ai-provider";
import { parseAmount } from "./csv";

/**
 * Bringing a distributor's existing data in, from whatever they are on now.
 *
 * The temptation is a parser per vendor — one for Tally, one for Marg, one for
 * Busy. That is a trap. Every one of them exports to CSV or Excel, every one
 * names its columns differently, and the names change between versions and
 * between two users of the same version who customised their report. A parser
 * per vendor is a permanent maintenance bill that still fails on the file in
 * front of you.
 *
 * So there is one importer, and the model reads the header row and a few
 * sample values and proposes which column is which. The operator confirms it
 * before anything is written — the same shape as reading a multi-page bill,
 * and for the same reason: a wrong guess about which column is the rate is
 * silent and expensive, and a person looking at their own data catches it in
 * two seconds.
 *
 * What is deliberately NOT imported is history. Years of past invoices would
 * double-count GST already filed and restate stock that has already moved.
 * What a distributor needs on day one is masters and opening balances, and
 * that is what this takes.
 */

const log = createLogger("import");

/** The fields worth asking for, per kind, with what they mean in plain words. */
export const IMPORT_FIELDS = {
  products: {
    name: "Product name as it appears on bills",
    sku: "Internal code or item code",
    hsn: "HSN or SAC code",
    gst_rate: "GST percentage, a number like 18",
    mrp: "Maximum retail price per unit",
    purchase_rate: "What it is bought at, per unit",
    selling_rate: "What it is sold at, per unit",
    avg_cost: "Current cost per unit in stock, after discount",
    current_stock: "Units in hand right now",
    unit: "PCS, BOX, KG and so on",
    pack_size: "Units per pack, like 10x10",
    brand: "Brand or company name",
    category: "Group or category",
  },
  suppliers: {
    name: "Supplier or company name",
    gstin: "15-character GSTIN",
    contact: "Phone number",
    city: "City",
    address: "Street address",
    pincode: "6-digit PIN",
    opening_balance: "What is owed to them today, positive",
  },
  retailers: {
    name: "Retailer, shop or customer name",
    gstin: "15-character GSTIN",
    phone: "Phone number",
    email: "Email",
    city: "City",
    address: "Street address",
    pincode: "6-digit PIN",
    credit_limit: "Credit limit allowed",
    opening_balance: "What they owe you today, positive",
  },
} as const;

export type ImportKind = keyof typeof IMPORT_FIELDS;

const NUMERIC: Record<ImportKind, string[]> = {
  products: ["gst_rate", "mrp", "purchase_rate", "selling_rate", "avg_cost", "current_stock"],
  suppliers: ["opening_balance"],
  retailers: ["credit_limit", "opening_balance"],
};

/** Every import needs something to call the row. */
const REQUIRED: Record<ImportKind, string> = {
  products: "name", suppliers: "name", retailers: "name",
};

/**
 * Chosen instead of one of our fields to say "keep this column, we just have
 * nowhere named to put it". It lands in the row's `extra` jsonb.
 *
 * Deliberately not something the model can propose — only the operator picks
 * it. Left to a machine, every leftover column would be swept in here,
 * including derived totals like a "Closing Value", and a stale total stored
 * next to the live figures it was computed from is worse than no total at all.
 *
 * What lands here is reference data a person reads. It is never used in any
 * pricing, stock or tax calculation — anything that feeds a sum needs a real
 * typed column with constraints, and pharma batch numbers and expiry dates
 * arriving here would be a bug rather than a feature.
 */
export const KEEP_AS_EXTRA = "__extra__";

/**
 * Caps on `extra`, so a row stays small enough that Postgres keeps it inline
 * rather than pushing it out to TOAST, and so no screen can be surprised by a
 * record carrying a novel. Reference data a human reads is short by nature; a
 * column that isn't is a column that wanted a real field.
 */
const MAX_EXTRA_KEYS = 20;
const MAX_EXTRA_VALUE_CHARS = 200;
const MAX_EXTRA_BYTES = 2000;

/** Exported so the caps can be tested as the rule they are, not inferred. */
export function capExtra(
  raw: Record<string, string>, rowNo: number, problems: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  let dropped = 0;
  let bytes = 2;                                   // the enclosing {}
  for (const [k, v] of Object.entries(raw)) {
    const value = v.length > MAX_EXTRA_VALUE_CHARS ? v.slice(0, MAX_EXTRA_VALUE_CHARS) : v;
    const cost = k.length + value.length + 6;      // quotes, colon, comma
    if (Object.keys(out).length >= MAX_EXTRA_KEYS || bytes + cost > MAX_EXTRA_BYTES) {
      dropped++;
      continue;
    }
    bytes += cost;
    out[k] = value;
  }
  if (dropped) {
    problems.push(`Row ${rowNo}: ${dropped} extra field(s) did not fit and were left out`);
  }
  return out;
}

export const proposeImportMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    kind: z.enum(["products", "suppliers", "retailers"]),
    headers: z.array(z.string()).min(1).max(60),
    // A handful of rows is enough to tell a rate column from an MRP column,
    // and keeps someone's whole catalogue out of a prompt.
    sampleRows: z.array(z.array(z.string())).max(5),
  }).parse(d))
  .handler(async ({ data }) => {
    const apiKey = process.env.GOOGLE_API_KEY;
    const fields = IMPORT_FIELDS[data.kind as ImportKind];
    const fieldList = Object.entries(fields).map(([k, v]) => `  ${k}: ${v}`).join("\n");

    // Without a key, fall back to matching on the name. It gets the obvious
    // ones and the operator fixes the rest, which beats refusing to import.
    if (!apiKey) {
      const guess: Record<string, string | null> = {};
      for (const h of data.headers) {
        const norm = h.toLowerCase().replace(/[^a-z]/g, "");
        guess[h] = Object.keys(fields).find(f => f.replace(/_/g, "") === norm) ?? null;
      }
      return { mapping: guess, notes: "Matched on column names only — no AI key configured." };
    }

    const prompt = `A distributor is moving to new software and has exported their ${data.kind} from
whatever they were using — Tally, Marg, Busy, Vyapar, a spreadsheet, anything.
Work out which of their columns corresponds to which of our fields.

Our fields:
${fieldList}

Their columns, with sample values:
${data.headers.map((h, i) => {
  const vals = data.sampleRows.map(r => r[i]).filter(Boolean).slice(0, 3);
  return `  "${h}" — examples: ${vals.length ? vals.map(v => JSON.stringify(v)).join(", ") : "(empty)"}`;
}).join("\n")}

Rules:
- Judge by the sample values as much as the name. A column called "Rate" holding
  numbers near the MRP is more likely mrp; one holding smaller numbers is a rate.
- Indian exports use names like "Item Name", "Prod Name", "Party", "Ledger Name",
  "Closing Qty", "Op. Bal", "Tax %", "GST%", "Amt".
- A column you cannot confidently place gets null. A wrong mapping is worse than
  an unmapped column, because the operator will not notice it.
- Never map two of their columns to the same field. Pick the better one.
- Money and quantity columns may carry symbols, commas or brackets. That is fine.

Return JSON only: {"mapping": {"<their column>": "<our field or null>"}, "notes": "one short sentence about anything ambiguous"}`;

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel()}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json" },
        }),
      },
    );
    if (!resp.ok) throw new Error(`Mapping failed: ${resp.status} ${(await resp.text()).slice(0, 160)}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await resp.json();
    let parsed: { mapping?: Record<string, string | null>; notes?: string } = {};
    try {
      parsed = JSON.parse((json.candidates?.[0]?.content?.parts ?? [])
        .map((p: { text?: string }) => p.text ?? "").join(""));
    } catch {
      throw new Error("The mapping came back unreadable. Map the columns by hand.");
    }

    // Trust nothing: drop fields we do not have, and refuse a field claimed by
    // two columns rather than letting the last one silently win.
    const valid = new Set(Object.keys(fields));
    const used = new Set<string>();
    const mapping: Record<string, string | null> = {};
    for (const h of data.headers) {
      const f = parsed.mapping?.[h] ?? null;
      mapping[h] = f && valid.has(f) && !used.has(f) ? (used.add(f), f) : null;
    }
    log.info("import:mapped", { kind: data.kind, mapped: used.size, of: data.headers.length });
    return { mapping, notes: parsed.notes ?? null };
  });

const RowSchema = z.record(z.string(), z.string());

export const commitImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    kind: z.enum(["products", "suppliers", "retailers"]),
    mapping: z.record(z.string(), z.string().nullable()),
    rows: z.array(RowSchema).min(1).max(5000),
    /** Preview mode: work out what would happen and write nothing. */
    dryRun: z.boolean().default(true),
  }).parse(d))
  .handler(async ({ data, context }) => {
    // The table is chosen at runtime, which the generated per-table types
    // cannot express — every column becomes a union of three tables' columns
    // and nothing assigns. Same escape hatch runExtraction already uses.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = context.supabase as any;
    const { userId } = context;
    const { data: mem } = await supabase
      .from("memberships").select("org_id").eq("user_id", userId).limit(1).single();
    if (!mem?.org_id) throw new Error("No organization");
    const orgId = mem.org_id;
    const kind = data.kind as ImportKind;
    const numeric = new Set(NUMERIC[kind]);
    const required = REQUIRED[kind];

    // The mapping arrives from the browser, so every field name in it is
    // checked against what this kind actually offers before it becomes a
    // column to write. Without this, a crafted request could name any column
    // on the table — org_id included, and on the update path that would hand
    // one workspace's row to another.
    const allowed = new Set<string>(Object.keys(IMPORT_FIELDS[kind]));
    const mapping: Record<string, string | null> = {};
    for (const [col, field] of Object.entries(data.mapping)) {
      mapping[col] = field && (allowed.has(field) || field === KEEP_AS_EXTRA) ? field : null;
    }

    // Existing rows, so an import run twice updates rather than duplicates.
    // GSTIN identifies a party beyond doubt; a name is what is left when there
    // is no GSTIN, and is compared case- and space-insensitively because
    // "Anand Enterprises" and "ANAND  ENTERPRISES " are one supplier.
    const key = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const { data: existing } = await supabase
      .from(kind)
      .select(kind === "products" ? "id, name, sku, extra" : "id, name, gstin, extra")
      .eq("org_id", orgId);
    const byName = new Map<string, string>();
    const byGstin = new Map<string, string>();
    // Kept so a second import adds to what a party already carries instead of
    // replacing it — two exports from two systems can each contribute a field.
    const extraById = new Map<string, Record<string, string>>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const e of (existing ?? []) as any[]) {
      if (!e.id) continue;
      if (e.name) byName.set(key(e.name), e.id);
      if (e.gstin) byGstin.set(String(e.gstin).toUpperCase(), e.id);
      if (e.sku) byName.set(`sku:${key(e.sku)}`, e.id);
      if (e.extra && typeof e.extra === "object") extraById.set(e.id, e.extra);
    }

    type Cell = string | number | Record<string, string>;
    const toInsert: Record<string, Cell>[] = [];
    const toUpdate: { id: string; values: Record<string, Cell> }[] = [];
    const problems: string[] = [];
    const seen = new Set<string>();

    data.rows.forEach((row, i) => {
      const values: Record<string, Cell> = {};
      // Kept under the operator's own column heading — "Rack", "Bin No", "Old
      // Group" — because that is the word they will look for when they go
      // hunting for it later.
      const extras: Record<string, string> = {};
      for (const [col, field] of Object.entries(mapping)) {
        if (!field) continue;
        const raw = (row[col] ?? "").trim();
        if (!raw) continue;
        if (field === KEEP_AS_EXTRA) { extras[col] = raw; continue; }
        if (numeric.has(field)) {
          const n = parseAmount(raw);
          if (n === null) { problems.push(`Row ${i + 2}: "${raw}" in ${col} is not a number, left blank`); continue; }
          values[field] = n;
        } else {
          values[field] = field === "gstin" ? raw.toUpperCase() : raw;
        }
      }
      const name = values[required] as string | undefined;
      if (!name) { problems.push(`Row ${i + 2}: no ${required}, skipped`); return; }

      // A file that lists the same party twice would otherwise insert it twice.
      const dedupe = typeof values.gstin === "string" ? values.gstin : key(name);
      if (seen.has(dedupe)) { problems.push(`Row ${i + 2}: "${name}" appears more than once in the file, kept the first`); return; }
      seen.add(dedupe);

      const gstin = typeof values.gstin === "string" ? values.gstin : null;
      const sku = typeof values.sku === "string" ? values.sku : null;

      // The first two digits of a GSTIN are the state, by definition — there
      // is nothing to guess. Without this an imported party arrives with no
      // state code, and GSTR-1 falls back to the distributor's own state for
      // place of supply, so every out-of-state retailer silently books as
      // CGST/SGST where IGST belongs. The form derives this from the GSTIN
      // lookup; the importer was not.
      if (gstin && /^\d{2}/.test(gstin) && kind !== "products") {
        values.state_code = gstin.slice(0, 2);
      }
      // A GSTIN settles it. If the row carries one and it matches nothing here,
      // this is a party we do not have — NOT the existing one with the same
      // name, which would merge two separate registrations into one row and
      // overwrite a real GSTIN with someone else's. Two firms share a name
      // often; two registrations never share a GSTIN. Fall back to the name
      // only when there is no GSTIN to go on.
      const id = gstin
        ? byGstin.get(gstin)
        : (sku ? byName.get(`sku:${key(sku)}`) : undefined) ?? byName.get(key(name));

      const kept = capExtra(extras, i + 2, problems);
      if (id) {
        // Merged, not replaced: a field this file does not carry stays put.
        const merged = { ...(extraById.get(id) ?? {}), ...kept };
        toUpdate.push({
          id,
          values: Object.keys(merged).length ? { ...values, extra: merged } : values,
        });
      } else {
        // Left off entirely when empty so the column default applies rather
        // than writing an empty object over it.
        toInsert.push(
          Object.keys(kept).length
            ? { ...values, extra: kept, org_id: orgId }
            : { ...values, org_id: orgId },
        );
      }
    });

    const summary = {
      willCreate: toInsert.length,
      willUpdate: toUpdate.length,
      problems: problems.slice(0, 50),
      problemCount: problems.length,
      sample: toInsert.slice(0, 5),
      extraFields: Object.values(mapping).filter(f => f === KEEP_AS_EXTRA).length,
    };
    if (data.dryRun) return { ...summary, committed: false };

    // Chunked: one 5,000-row statement is a request nobody can retry usefully.
    for (let i = 0; i < toInsert.length; i += 200) {
      const { error } = await supabase.from(kind).insert(toInsert.slice(i, i + 200));
      if (error) throw new Error(`Insert failed around row ${i + 2}: ${error.message}`);
    }
    for (const u of toUpdate) {
      const { error } = await supabase.from(kind).update(u.values).eq("id", u.id).eq("org_id", orgId);
      if (error) throw new Error(`Update failed: ${error.message}`);
    }
    log.info("import:committed", { kind, created: toInsert.length, updated: toUpdate.length });
    return { ...summary, committed: true };
  });
