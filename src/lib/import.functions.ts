import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLogger } from "./logger";
import { aiProvider, anthropicModel, geminiModel } from "./ai-provider";
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
  products: "name",
  suppliers: "name",
  retailers: "name",
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
  raw: Record<string, string>,
  rowNo: number,
  problems: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  let dropped = 0;
  let bytes = 2; // the enclosing {}
  for (const [k, v] of Object.entries(raw)) {
    const value = v.length > MAX_EXTRA_VALUE_CHARS ? v.slice(0, MAX_EXTRA_VALUE_CHARS) : v;
    const cost = k.length + value.length + 6; // quotes, colon, comma
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

/**
 * What accounting software in India actually calls these columns.
 *
 * This is the floor the screen stands on when the model cannot be reached —
 * out of quota, rate limited, network gone. It used to fall back to comparing
 * a heading against our own field names, which matches almost nothing real:
 * no export in the country has a column called "current_stock". The operator
 * was left with every row reading "do not import", the Check button disabled
 * because no column was the name, and a toast that had already faded. That
 * looks like a verdict on their file rather than a service being down.
 */
const HEADER_SYNONYMS: Record<string, string[]> = {
  name: [
    "itemname",
    "itemdescription",
    "productname",
    "prodname",
    "description",
    "particulars",
    "item",
    "product",
    "partyname",
    "ledgername",
    "ledger",
    "party",
    "customername",
    "suppliername",
    "accountname",
    "nameofitem",
    "shopname",
    "firmname",
  ],
  sku: [
    "barcode",
    "itemcode",
    "prodcode",
    "productcode",
    "code",
    "partno",
    "partnumber",
    "sku",
    "alias",
    "aliascode",
    "itemalias",
  ],
  hsn: ["hsn", "hsncode", "hsnsac", "hsnsaccode", "tariff", "tariffcode", "sac"],
  gst_rate: [
    "gst",
    "gstrate",
    "gstpercent",
    "gstp",
    "tax",
    "taxrate",
    "taxpercent",
    "taxp",
    "igst",
    "gstslab",
  ],
  mrp: ["mrp", "maxretailprice", "retailprice", "printedprice", "listprice"],
  purchase_rate: [
    "purrate",
    "purchaserate",
    "purchprice",
    "purchaseprice",
    "buyingrate",
    "costrate",
    "purcrate",
    "prate",
  ],
  selling_rate: ["salerate", "sellingrate", "salesrate", "sellrate", "srate", "sellingprice"],
  avg_cost: [
    "landingcost",
    "avgcost",
    "averagecost",
    "wtdavgcost",
    "weightedavgcost",
    "landedcost",
    "costprice",
    "cost",
  ],
  current_stock: [
    "closingqty",
    "closingstock",
    "balqty",
    "balancequantity",
    "balanceqty",
    "stock",
    "qty",
    "quantity",
    "instock",
    "onhand",
    "closingbal",
  ],
  unit: ["unit", "uom", "units", "measure", "unitofmeasure"],
  pack_size: ["packing", "pack", "packsize", "packof", "conversion"],
  brand: ["company", "brand", "make", "mfr", "manufacturer", "mfg", "supplier"],
  category: ["group", "category", "stockgroup", "itemgroup", "class", "segment"],
  gstin: ["gstin", "gstno", "gstnumber", "gstinno", "gstregno", "gstidentification"],
  contact: [
    "mobile",
    "mobileno",
    "phone",
    "phoneno",
    "contact",
    "contactno",
    "cell",
    "telephone",
    "tel",
  ],
  phone: [
    "mobile",
    "mobileno",
    "phone",
    "phoneno",
    "contact",
    "contactno",
    "cell",
    "telephone",
    "tel",
  ],
  email: ["email", "emailid", "mail", "mailid"],
  city: ["city", "place", "station", "town", "location"],
  address: ["address", "addr", "add", "street", "addressline"],
  pincode: ["pin", "pincode", "zip", "zipcode", "postcode", "postalcode"],
  opening_balance: [
    "opbal",
    "openingbalance",
    "openingbal",
    "obal",
    "balance",
    "outstanding",
    "closingbalance",
    "duesamount",
    "due",
  ],
  credit_limit: ["creditlimit", "crlimit", "climit", "creditlimitamount"],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Best-effort mapping from column headings alone. Never guesses twice. */
export function guessByHeader(kind: ImportKind, headers: string[]): Record<string, string | null> {
  const fields = Object.keys(IMPORT_FIELDS[kind]);
  const out: Record<string, string | null> = {};
  const used = new Set<string>();
  // Exact first, so "Sale Rate" takes selling_rate before a looser rule can
  // hand it to something else.
  for (const pass of ["exact", "loose"] as const) {
    for (const h of headers) {
      if (out[h]) continue;
      const n = norm(h);
      const hit = fields.find((f) => {
        if (used.has(f)) return false;
        const syns = HEADER_SYNONYMS[f] ?? [norm(f)];
        return pass === "exact"
          ? syns.includes(n) || n === norm(f)
          : // Only the other way round: a heading that contains a synonym.
            // Matching a synonym that contains the heading turns "s" into
            // anything.
            syns.some((s) => s.length >= 4 && n.includes(s));
      });
      if (hit) {
        out[h] = hit;
        used.add(hit);
      }
    }
  }
  for (const h of headers) if (!(h in out)) out[h] = null;
  return out;
}

/**
 * One prompt in, the model's text out, per provider. Both are asked for JSON
 * and nothing else; the caller parses and validates, because neither can be
 * trusted to return only what was asked for.
 */
async function askClaude(apiKey: string, prompt: string): Promise<string> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resp: any = await client.messages.create({
    model: anthropicModel(),
    max_tokens: 2048,
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
  });
  const text = (resp.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("")
    .trim();
  // Claude has no JSON response mode here, so it may wrap the object in a
  // fenced block. Take the outermost object rather than failing on the fence.
  const m = text.match(/\{[\s\S]*\}/);
  return m ? m[0] : text;
}

async function askGemini(apiKey: string, prompt: string): Promise<string> {
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
  if (!resp.ok) throw new Error(`${resp.status} ${(await resp.text()).slice(0, 160)}`);
  const json = await resp.json();
  return (json.candidates?.[0]?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? "")
    .join("");
}

export const proposeImportMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        kind: z.enum(["products", "suppliers", "retailers"]),
        headers: z.array(z.string()).min(1).max(60),
        // A handful of rows is enough to tell a rate column from an MRP column,
        // and keeps someone's whole catalogue out of a prompt.
        sampleRows: z.array(z.array(z.string())).max(5),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    /*
     * Follows AI_PROVIDER like the assistant and the extraction backend do.
     * This used to call Gemini directly whatever the setting said, which is why
     * it was the one feature that broke on the Gemini free tier's twenty a day
     * while bills, read by Claude, carried on fine.
     *
     * Preference, not insistence: if the chosen provider has no key but the
     * other one does, use it. Otherwise flipping AI_PROVIDER, or deploying with
     * only one key set, silently turns the column reader off and the operator
     * is left wondering why the mapping got worse.
     */
    const claudeKey = process.env.ANTHROPIC_API_KEY;
    const geminiKey = process.env.GOOGLE_API_KEY;
    const preferred = aiProvider();
    const provider: "anthropic" | "gemini" =
      preferred === "anthropic"
        ? claudeKey
          ? "anthropic"
          : geminiKey
            ? "gemini"
            : "anthropic"
        : geminiKey
          ? "gemini"
          : claudeKey
            ? "anthropic"
            : "gemini";
    const apiKey = provider === "anthropic" ? claudeKey : geminiKey;
    const fields = IMPORT_FIELDS[data.kind as ImportKind];
    const fieldList = Object.entries(fields)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join("\n");

    const kind = data.kind as ImportKind;
    /** The screen must always get a usable mapping back, never an exception. */
    const byHeader = (why: string) => ({
      mapping: guessByHeader(kind, data.headers),
      notes: null,
      automatic: false as const,
      reason: why,
    });

    if (!apiKey) return byHeader("No AI key is configured on the server.");

    const prompt = `A distributor is moving to new software and has exported their ${data.kind} from
whatever they were using — Tally, Marg, Busy, Vyapar, a spreadsheet, anything.
Work out which of their columns corresponds to which of our fields.

Our fields:
${fieldList}

Their columns, with sample values:
${data.headers
  .map((h, i) => {
    const vals = data.sampleRows
      .map((r) => r[i])
      .filter(Boolean)
      .slice(0, 3);
    return `  "${h}" — examples: ${vals.length ? vals.map((v) => JSON.stringify(v)).join(", ") : "(empty)"}`;
  })
  .join("\n")}

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

    // Every failure below falls back rather than throwing. A rate limit or a
    // bad minute upstream is not a reason to hand someone a screen where every
    // column reads "do not import" and the Import button will not light up.
    let replyText: string;
    try {
      replyText =
        provider === "anthropic"
          ? await askClaude(apiKey, prompt)
          : await askGemini(apiKey, prompt);
    } catch (e) {
      const msg = (e as Error).message;
      log.error("import:mapping_failed", { provider, err: msg.slice(0, 200) });
      return byHeader(
        /\b429\b/.test(msg)
          ? "The AI allowance is used up for now, so the columns were matched on their names."
          : "The column reader is unavailable, so the columns were matched on their names.",
      );
    }
    let parsed: { mapping?: Record<string, string | null>; notes?: string } = {};
    try {
      parsed = JSON.parse(replyText);
    } catch {
      log.error("import:mapping_unreadable", {});
      return byHeader(
        "The column reader replied with something unreadable, so the columns were matched on their names.",
      );
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
    // A reply that placed nothing is not better than the header rules, and on
    // a file whose columns are ordinary it is plainly worse.
    if (used.size === 0) {
      log.error("import:mapping_empty", { of: data.headers.length });
      return byHeader(
        "The column reader placed nothing, so the columns were matched on their names.",
      );
    }
    log.info("import:mapped", { kind: data.kind, mapped: used.size, of: data.headers.length });
    return { mapping, notes: parsed.notes ?? null, automatic: true as const, reason: null };
  });

const RowSchema = z.record(z.string(), z.string());

export const commitImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        kind: z.enum(["products", "suppliers", "retailers"]),
        mapping: z.record(z.string(), z.string().nullable()),
        rows: z.array(RowSchema).min(1).max(5000),
        /** Preview mode: work out what would happen and write nothing. */
        dryRun: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // The table is chosen at runtime, which the generated per-table types
    // cannot express — every column becomes a union of three tables' columns
    // and nothing assigns. Same escape hatch runExtraction already uses.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = context.supabase as any;
    const { userId } = context;
    const { data: mem } = await supabase
      .from("memberships")
      .select("org_id")
      .eq("user_id", userId)
      .limit(1)
      .single();
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
    // Every column this import could write, so the value each row held
    // beforehand is known and undo has something to put back.
    const touchable = ["id", "extra", ...Object.keys(IMPORT_FIELDS[kind])].concat(
      kind === "products" ? [] : ["state_code"],
    );
    const { data: existing } = await supabase
      .from(kind)
      .select(touchable.join(", "))
      .eq("org_id", orgId);
    const byName = new Map<string, string>();
    const byGstin = new Map<string, string>();
    // Kept so a second import adds to what a party already carries instead of
    // replacing it — two exports from two systems can each contribute a field.
    const extraById = new Map<string, Record<string, string>>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rowById = new Map<string, any>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const e of (existing ?? []) as any[]) {
      if (!e.id) continue;
      if (e.name) byName.set(key(e.name), e.id);
      if (e.gstin) byGstin.set(String(e.gstin).toUpperCase(), e.id);
      if (e.sku) byName.set(`sku:${key(e.sku)}`, e.id);
      if (e.extra && typeof e.extra === "object") extraById.set(e.id, e.extra);
      rowById.set(e.id, e);
    }

    type Cell = string | number | Record<string, string>;
    const toInsert: Record<string, Cell>[] = [];
    const toUpdate: {
      id: string;
      values: Record<string, Cell>;
      /** What those same fields held before, for undo. */
      before: Record<string, unknown>;
    }[] = [];
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
        if (field === KEEP_AS_EXTRA) {
          extras[col] = raw;
          continue;
        }
        if (numeric.has(field)) {
          const n = parseAmount(raw);
          if (n === null) {
            problems.push(`Row ${i + 2}: "${raw}" in ${col} is not a number, left blank`);
            continue;
          }
          values[field] = n;
        } else {
          values[field] = field === "gstin" ? raw.toUpperCase() : raw;
        }
      }
      const name = values[required] as string | undefined;
      if (!name) {
        problems.push(`Row ${i + 2}: no ${required}, skipped`);
        return;
      }

      // A file that lists the same party twice would otherwise insert it twice.
      const dedupe = typeof values.gstin === "string" ? values.gstin : key(name);
      if (seen.has(dedupe)) {
        problems.push(`Row ${i + 2}: "${name}" appears more than once in the file, kept the first`);
        return;
      }
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
        : ((sku ? byName.get(`sku:${key(sku)}`) : undefined) ?? byName.get(key(name)));

      const kept = capExtra(extras, i + 2, problems);
      if (id) {
        // Merged, not replaced: a field this file does not carry stays put.
        const merged = { ...(extraById.get(id) ?? {}), ...kept };
        const next = Object.keys(merged).length ? { ...values, extra: merged } : values;
        const was = rowById.get(id) ?? {};
        const before: Record<string, unknown> = {};
        for (const f of Object.keys(next)) before[f] = was[f] ?? null;
        toUpdate.push({ id, values: next, before });
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
      extraFields: Object.values(mapping).filter((f) => f === KEEP_AS_EXTRA).length,
    };
    if (data.dryRun) return { ...summary, committed: false };

    // Chunked: one 5,000-row statement is a request nobody can retry usefully.
    // Ids come back from the insert because they are the whole of undo for a
    // created row — without them a bad import can only be cleaned up by hand.
    const createdIds: string[] = [];
    for (let i = 0; i < toInsert.length; i += 200) {
      const { data: made, error } = await supabase
        .from(kind)
        .insert(toInsert.slice(i, i + 200))
        .select("id");
      if (error) throw new Error(`Insert failed around row ${i + 2}: ${error.message}`);
      for (const r of (made ?? []) as { id: string }[]) createdIds.push(r.id);
    }
    for (const u of toUpdate) {
      const { error } = await supabase
        .from(kind)
        .update(u.values)
        .eq("id", u.id)
        .eq("org_id", orgId);
      if (error) throw new Error(`Update failed: ${error.message}`);
    }

    // Recorded after the writes, not before: a run that half-failed should not
    // leave a history entry claiming it did something it did not.
    const { data: run, error: runErr } = await supabase
      .from("import_runs")
      .insert({
        org_id: orgId,
        kind,
        created_by: userId,
        mapping,
        created_count: createdIds.length,
        updated_count: toUpdate.length,
        created_ids: createdIds,
        updated_rows: toUpdate.map((u) => ({ id: u.id, before: u.before, after: u.values })),
      })
      .select("id")
      .single();
    // A missing history entry is not worth failing an import that has already
    // landed — but it does mean this one cannot be undone, so say so.
    if (runErr) log.error("import:run_not_recorded", { err: runErr.message });

    log.info("import:committed", { kind, created: createdIds.length, updated: toUpdate.length });
    return { ...summary, willCreate: createdIds.length, committed: true, runId: run?.id ?? null };
  });

/** What has been brought in, newest first. */
export const listImportRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: mem } = await supabase
      .from("memberships")
      .select("org_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    if (!mem?.org_id) return [];
    const { data } = await supabase
      .from("import_runs")
      // Not the row payloads — this is a list, and updated_rows can run to a
      // megabyte on a big import. Undo reads them one run at a time.
      .select("id, kind, created_count, updated_count, mapping, created_at, undone_at, undo_note")
      .eq("org_id", mem.org_id)
      .order("created_at", { ascending: false })
      .limit(20);
    return data ?? [];
  });

/** True when a and b are the same value, allowing for how the driver types it. */
function same(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  // numeric(10,4) comes back as "218.9300" where the import sent 218.93, and
  // those are the same number however differently they print.
  const na = Number(a),
    nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && String(a).trim() && String(b).trim()) {
    return na === nb;
  }
  return String(a) === String(b);
}

/**
 * Put an import back.
 *
 * Two halves, and neither is unconditional. A row this run created is deleted
 * — unless something has been billed against it since, in which case the
 * database refuses and it stays, because a product referenced by an invoice
 * line is not the importer's to remove. A row this run changed is put back
 * only field by field, and only where the value is still the one the import
 * left; anything edited since is somebody's work and is not thrown away.
 *
 * What could not be done is written on the run and shown, rather than an undo
 * that quietly did three quarters of the job and reported success.
 */
export const undoImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ runId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = context.supabase as any;
    const { userId } = context;
    const { data: mem } = await supabase
      .from("memberships")
      .select("org_id")
      .eq("user_id", userId)
      .limit(1)
      .single();
    if (!mem?.org_id) throw new Error("No organization");
    const orgId = mem.org_id;

    const { data: run } = await supabase
      .from("import_runs")
      .select("*")
      .eq("id", data.runId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!run) throw new Error("That import is not in this workspace.");
    if (run.undone_at) throw new Error("That import has already been undone.");

    const kind = run.kind as ImportKind;
    const createdIds: string[] = run.created_ids ?? [];
    const updates: {
      id: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }[] = run.updated_rows ?? [];

    // Delete in chunks; when a chunk is refused, go row by row so that one
    // product that has been sold does not save the other ninety-nine.
    let deleted = 0;
    const blocked: string[] = [];
    for (let i = 0; i < createdIds.length; i += 100) {
      const chunk = createdIds.slice(i, i + 100);
      const { error } = await supabase.from(kind).delete().in("id", chunk).eq("org_id", orgId);
      if (!error) {
        deleted += chunk.length;
        continue;
      }
      for (const id of chunk) {
        const { error: one } = await supabase.from(kind).delete().eq("id", id).eq("org_id", orgId);
        if (one) blocked.push(id);
        else deleted++;
      }
    }

    let restored = 0;
    let keptEdits = 0;
    for (const u of updates) {
      const { data: current } = await supabase
        .from(kind)
        .select("*")
        .eq("id", u.id)
        .eq("org_id", orgId)
        .maybeSingle();
      if (!current) continue; // already gone; nothing to put back
      const patch: Record<string, unknown> = {};
      for (const [field, after] of Object.entries(u.after)) {
        if (same(current[field], after)) patch[field] = u.before[field] ?? null;
        else keptEdits++; // changed since — leave it alone
      }
      if (!Object.keys(patch).length) continue;
      const { error } = await supabase.from(kind).update(patch).eq("id", u.id).eq("org_id", orgId);
      if (!error) restored++;
    }

    const notes: string[] = [];
    if (blocked.length) {
      notes.push(`${blocked.length} kept because they are already used on a bill or order`);
    }
    if (keptEdits) notes.push(`${keptEdits} field(s) left as they are, edited since the import`);
    const note = notes.join("; ") || null;

    await supabase
      .from("import_runs")
      .update({ undone_at: new Date().toISOString(), undo_note: note })
      .eq("id", run.id)
      .eq("org_id", orgId);

    log.info("import:undone", { runId: run.id, kind, deleted, blocked: blocked.length, restored });
    return { deleted, blocked: blocked.length, restored, keptEdits, note };
  });
