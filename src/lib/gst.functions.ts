import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createLogger } from "./logger";

const log = createLogger("gst.functions");

/**
 * GSTR-1 / GSTR-3B working papers, derived from issued sales invoices and
 * approved purchases.
 *
 * This produces a *draft for review*, not a filing. Dhela has no GSP licence,
 * so nothing is submitted to the portal — the same shape as the e-way bill
 * flow, where we prepare the data and the taxpayer files it themselves.
 *
 * Known limits, surfaced in the UI rather than hidden:
 * - Purchase lines don't carry a CGST/SGST/IGST split, only a total tax
 *   amount, so ITC is reported as a single figure.
 * - Reverse charge and invoice type (SEZ / deemed export) aren't modelled;
 *   everything is treated as a regular forward-charge supply.
 * - `unit` is free text, so UQC is best-effort mapped with OTH as fallback.
 */

/** Interstate B2C invoices above this go in B2CL. Cut from ₹2.5L by Notification 12/2024. */
export const B2CL_THRESHOLD = 100_000;
/** Above this annual turnover Table 12 needs 6-digit HSN, otherwise 4. */
const AATO_6_DIGIT_THRESHOLD = 50_000_000;

/** Free-text units mapped onto the portal's UQC list; anything else is OTH. */
const UQC_MAP: Record<string, string> = {
  pcs: "PCS", pc: "PCS", piece: "PCS", pieces: "PCS", nos: "NOS", no: "NOS", unit: "UNT",
  kg: "KGS", kgs: "KGS", kilogram: "KGS", g: "GMS", gm: "GMS", gms: "GMS", gram: "GMS",
  l: "LTR", ltr: "LTR", litre: "LTR", liter: "LTR", ml: "MLT",
  box: "BOX", bag: "BAG", bottle: "BTL", btl: "BTL", can: "CAN", ctn: "CTN", carton: "CTN",
  doz: "DOZ", dozen: "DOZ", pkt: "PAC", pack: "PAC", packet: "PAC", set: "SET",
  mtr: "MTR", meter: "MTR", metre: "MTR", ton: "TON", tonne: "TON", roll: "ROL",
};
const toUqc = (u: string | null | undefined) =>
  UQC_MAP[(u ?? "").trim().toLowerCase()] ?? "OTH";

const n = (v: unknown) => (v == null ? 0 : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100;

type Party = { name: string | null; gstin: string | null; state_code: string | null } | null;

// Explicit row shapes: the joined selects and the conditional line query both
// widen into error unions otherwise, which hides real mistakes behind casts.
type InvRow = {
  id: string; invoice_number: string | null; invoice_date: string | null;
  place_of_supply: string | null; is_interstate: boolean | null; subtotal: number | null;
  cgst_total: number | null; sgst_total: number | null; igst_total: number | null;
  grand_total: number | null; retailer: Party;
};
type LineRow = {
  sales_invoice_id: string; hsn: string | null; description: string | null; unit: string | null;
  quantity: number | null; gst_rate: number | null; taxable_value: number | null;
  cgst_amount: number | null; sgst_amount: number | null; igst_amount: number | null;
};
type NoteRow = {
  id: string; credit_note_number: string | null; credit_date: string | null;
  subtotal: number | null; tax_total: number | null; grand_total: number | null;
  sales_invoice: { invoice_number: string | null; invoice_date: string | null;
    place_of_supply: string | null; is_interstate: boolean | null;
    grand_total: number | null } | null;
  retailer: Party;
};
type NoteLineRow = {
  credit_note_id: string; hsn: string | null; gst_rate: number | null;
  taxable_value: number | null; tax_amount: number | null;
};

export type Gstr1Row = Record<string, string | number>;

export type GstReturns = {
  period: string;
  orgGstin: string | null;
  hsnDigits: 4 | 6;
  counts: { invoices: number; creditNotes: number; skippedNoGstin: number };
  b2b: Gstr1Row[];
  b2cl: Gstr1Row[];
  b2cs: Gstr1Row[];
  cdnr: Gstr1Row[];
  cdnur: Gstr1Row[];
  hsnB2b: Gstr1Row[];
  hsnB2c: Gstr1Row[];
  docs: Gstr1Row[];
  gstr3b: {
    outwardTaxable: number; outwardIgst: number; outwardCgst: number; outwardSgst: number;
    creditNoteTaxable: number; creditNoteTax: number;
    inwardTaxable: number; itcTotal: number; itcSplitAvailable: boolean;
  };
  warnings: string[];
};

export const getGstReturns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<GstReturns> => {
    const { supabase } = context;
    const [y, m] = data.period.split("-").map(Number);
    const from = `${data.period}-01`;
    const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // last day of month

    const { data: org } = await supabase.from("organizations")
      .select("gstin, state_code").limit(1).single();

    const { data: invRaw, error: invErr } = await supabase.from("sales_invoices")
      .select("id, invoice_number, invoice_date, place_of_supply, is_interstate, subtotal, "
        + "cgst_total, sgst_total, igst_total, grand_total, "
        + "retailer:retailers(name, gstin, state_code)")
      .in("status", ["issued", "paid"])
      .gte("invoice_date", from).lte("invoice_date", to)
      .order("invoice_date");
    if (invErr) throw new Error(invErr.message);
    const invoices = (invRaw ?? []) as unknown as InvRow[];

    const ids = invoices.map(i => i.id);
    let lines: LineRow[] = [];
    if (ids.length) {
      const { data: lineRaw, error: lineErr } = await supabase.from("sales_invoice_lines")
        .select("sales_invoice_id, hsn, description, unit, quantity, gst_rate, taxable_value, "
          + "cgst_amount, sgst_amount, igst_amount")
        .in("sales_invoice_id", ids);
      if (lineErr) throw new Error(lineErr.message);
      lines = (lineRaw ?? []) as unknown as LineRow[];
    }

    const { data: noteRaw } = await supabase.from("credit_notes")
      .select("id, credit_note_number, credit_date, subtotal, tax_total, grand_total, "
        + "sales_invoice:sales_invoices(invoice_number, invoice_date, place_of_supply, is_interstate, grand_total), "
        + "retailer:retailers(name, gstin, state_code)")
      .gte("credit_date", from).lte("credit_date", to)
      .order("credit_date");
    const notes = (noteRaw ?? []) as unknown as NoteRow[];

    let noteLines: NoteLineRow[] = [];
    if (notes.length) {
      const { data: nlRaw } = await supabase.from("credit_note_lines")
        .select("credit_note_id, hsn, gst_rate, taxable_value, tax_amount")
        .in("credit_note_id", notes.map(n => n.id));
      noteLines = (nlRaw ?? []) as unknown as NoteLineRow[];
    }
    const noteLinesById = new Map<string, NoteLineRow[]>();
    for (const l of noteLines) {
      const arr = noteLinesById.get(l.credit_note_id) ?? [];
      arr.push(l);
      noteLinesById.set(l.credit_note_id, arr);
    }

    // Purchases give the ITC figure for 3B. Only approved ones have hit stock.
    const { data: purchases } = await supabase.from("invoices")
      .select("subtotal, tax_total")
      .eq("status", "approved")
      .gte("invoice_date", from).lte("invoice_date", to);

    const linesByInvoice = new Map<string, LineRow[]>();
    for (const l of lines) {
      const arr = linesByInvoice.get(l.sales_invoice_id) ?? [];
      arr.push(l);
      linesByInvoice.set(l.sales_invoice_id, arr);
    }

    const warnings: string[] = [];
    const b2b: Gstr1Row[] = [], b2cl: Gstr1Row[] = [], docs: Gstr1Row[] = [];
    const b2csMap = new Map<string, Gstr1Row>();
    let skippedNoGstin = 0;
    let outwardTaxable = 0, outwardIgst = 0, outwardCgst = 0, outwardSgst = 0;

    for (const inv of invoices) {
      const party = inv.retailer;
      const invLines = linesByInvoice.get(inv.id) ?? [];
      const pos = inv.place_of_supply ?? party?.state_code ?? org?.state_code ?? "";

      outwardTaxable += n(inv.subtotal);
      outwardIgst += n(inv.igst_total);
      outwardCgst += n(inv.cgst_total);
      outwardSgst += n(inv.sgst_total);

      // One row per rate, which is how the portal wants B2B and B2CL.
      const byRate = new Map<number, { taxable: number; igst: number; cgst: number; sgst: number }>();
      for (const l of invLines) {
        const rate = n(l.gst_rate);
        const cur = byRate.get(rate) ?? { taxable: 0, igst: 0, cgst: 0, sgst: 0 };
        cur.taxable += n(l.taxable_value);
        cur.igst += n(l.igst_amount);
        cur.cgst += n(l.cgst_amount);
        cur.sgst += n(l.sgst_amount);
        byRate.set(rate, cur);
      }
      if (!byRate.size) {
        warnings.push(`Invoice ${inv.invoice_number} has no line items — excluded from rate-wise tables.`);
      }

      if (party?.gstin) {
        for (const [rate, v] of byRate) {
          b2b.push({
            "GSTIN/UIN of Recipient": party.gstin,
            "Receiver Name": party.name ?? "",
            "Invoice Number": inv.invoice_number ?? "",
            "Invoice date": inv.invoice_date ?? "",
            "Invoice Value": r2(n(inv.grand_total)),
            "Place Of Supply": pos,
            "Reverse Charge": "N",
            "Invoice Type": "Regular B2B",
            "Rate": rate,
            "Taxable Value": r2(v.taxable),
            "Integrated Tax": r2(v.igst),
            "Central Tax": r2(v.cgst),
            "State/UT Tax": r2(v.sgst),
            "Cess": 0,
          });
        }
      } else if (inv.is_interstate && n(inv.grand_total) > B2CL_THRESHOLD) {
        skippedNoGstin++;
        for (const [rate, v] of byRate) {
          b2cl.push({
            "Invoice Number": inv.invoice_number ?? "",
            "Invoice date": inv.invoice_date ?? "",
            "Invoice Value": r2(n(inv.grand_total)),
            "Place Of Supply": pos,
            "Rate": rate,
            "Taxable Value": r2(v.taxable),
            "Integrated Tax": r2(v.igst),
            "Cess": 0,
          });
        }
      } else {
        skippedNoGstin++;
        for (const [rate, v] of byRate) {
          // "Type" is OE (other than e-commerce) or E — not the supply's
          // inter/intra nature, which is carried by Place Of Supply.
          const key = `${pos}|${rate}`;
          const cur = b2csMap.get(key) ?? {
            "Type": "OE", "Place Of Supply": pos, "Rate": rate,
            "Taxable Value": 0, "Integrated Tax": 0, "Central Tax": 0, "State/UT Tax": 0,
            "Cess": 0, "E-Commerce GSTIN": "",
          };
          cur["Taxable Value"] = r2(Number(cur["Taxable Value"]) + v.taxable);
          cur["Integrated Tax"] = r2(Number(cur["Integrated Tax"]) + v.igst);
          cur["Central Tax"] = r2(Number(cur["Central Tax"]) + v.cgst);
          cur["State/UT Tax"] = r2(Number(cur["State/UT Tax"]) + v.sgst);
          b2csMap.set(key, cur);
        }
      }
    }

    // Document series — the portal wants issued/cancelled counts per range.
    const numbers = invoices.map(i => i.invoice_number).filter(Boolean).sort();
    if (numbers.length) {
      docs.push({
        "Nature of Document": "Invoices for outward supply",
        "Sr. No. From": numbers[0] ?? "",
        "Sr. No. To": numbers[numbers.length - 1] ?? "",
        "Total Number": numbers.length,
        "Cancelled": 0,
      });
    }

    const cdnr: Gstr1Row[] = [], cdnur: Gstr1Row[] = [];
    let creditNoteTaxable = 0, creditNoteTax = 0;
    for (const cn of notes) {
      const party = cn.retailer;
      const src = cn.sales_invoice;
      const pos = src?.place_of_supply ?? party?.state_code ?? org?.state_code ?? "";
      creditNoteTaxable += n(cn.subtotal);
      creditNoteTax += n(cn.tax_total);
      const base = {
        "Note Number": cn.credit_note_number ?? "",
        "Note Date": cn.credit_date ?? "",
        "Note Type": "C",
        "Place Of Supply": pos,
        "Note Value": r2(n(cn.grand_total)),
        "Taxable Value": r2(n(cn.subtotal)),
      };

      if (party?.gstin) {
        cdnr.push({
          "GSTIN/UIN of Recipient": party.gstin,
          "Receiver Name": party.name ?? "",
          "Invoice/Advance Receipt Number": src?.invoice_number ?? "",
          "Invoice/Advance Receipt date": src?.invoice_date ?? "",
          ...base,
        });
        continue;
      }

      // CDNUR accepts only B2CL, EXPWP and EXPWOP. A note against an
      // unregistered buyer therefore belongs there only when the original
      // supply itself was B2CL — interstate and over the threshold. Everything
      // else is a negative adjustment inside B2CS, not a CDNUR row.
      const wasB2cl = !!src?.is_interstate && n(src?.grand_total) > B2CL_THRESHOLD;
      if (wasB2cl) {
        cdnur.push({ "UR Type": "B2CL", ...base });
        continue;
      }

      for (const l of noteLinesById.get(cn.id) ?? []) {
        const rate = n(l.gst_rate);
        const taxable = n(l.taxable_value);
        const tax = n(l.tax_amount);
        const key = `${pos}|${rate}`;
        const cur = b2csMap.get(key) ?? {
          "Type": "OE", "Place Of Supply": pos, "Rate": rate,
          "Taxable Value": 0, "Integrated Tax": 0, "Central Tax": 0, "State/UT Tax": 0,
          "Cess": 0, "E-Commerce GSTIN": "",
        };
        cur["Taxable Value"] = r2(Number(cur["Taxable Value"]) - taxable);
        if (src?.is_interstate) {
          cur["Integrated Tax"] = r2(Number(cur["Integrated Tax"]) - tax);
        } else {
          cur["Central Tax"] = r2(Number(cur["Central Tax"]) - tax / 2);
          cur["State/UT Tax"] = r2(Number(cur["State/UT Tax"]) - tax / 2);
        }
        b2csMap.set(key, cur);
      }
    }

    // Table 12 has separate B2B and B2C tabs since Phase 3 (May 2025), so a
    // line is bucketed by whether its invoice went to a GSTIN holder.
    const b2bInvoiceIds = new Set(
      invoices.filter(i => i.retailer?.gstin).map(i => i.id),
    );
    const hsnB2bMap = new Map<string, Gstr1Row>();
    const hsnB2cMap = new Map<string, Gstr1Row>();
    for (const l of lines) {
      const hsnMap = b2bInvoiceIds.has(l.sales_invoice_id) ? hsnB2bMap : hsnB2cMap;
      const uqc = toUqc(l.unit);
      const rate = n(l.gst_rate);
      const code = (l.hsn ?? "").trim();
      if (!code) {
        warnings.push("Some line items have no HSN — Table 12 will be incomplete until they're filled in.");
      }
      const key = `${code}|${uqc}|${rate}`;
      const cur = hsnMap.get(key) ?? {
        "HSN": code, "Description": l.description ?? "", "UQC": uqc, "Rate": rate,
        "Total Quantity": 0, "Total Taxable Value": 0,
        "Integrated Tax Amount": 0, "Central Tax Amount": 0, "State/UT Tax Amount": 0, "Cess Amount": 0,
      };
      cur["Total Quantity"] = r2(Number(cur["Total Quantity"]) + n(l.quantity));
      cur["Total Taxable Value"] = r2(Number(cur["Total Taxable Value"]) + n(l.taxable_value));
      cur["Integrated Tax Amount"] = r2(Number(cur["Integrated Tax Amount"]) + n(l.igst_amount));
      cur["Central Tax Amount"] = r2(Number(cur["Central Tax Amount"]) + n(l.cgst_amount));
      cur["State/UT Tax Amount"] = r2(Number(cur["State/UT Tax Amount"]) + n(l.sgst_amount));
      hsnMap.set(key, cur);
    }

    const inwardTaxable = (purchases ?? []).reduce((a, p) => a + n(p.subtotal), 0);
    const itcTotal = (purchases ?? []).reduce((a, p) => a + n(p.tax_total), 0);

    // Turnover decides 4- vs 6-digit HSN. No AATO field exists, so estimate
    // from this month annualised — deliberately crude, and flagged as such.
    const annualised = outwardTaxable * 12;
    const hsnDigits: 4 | 6 = annualised > AATO_6_DIGIT_THRESHOLD ? 6 : 4;

    if (!org?.gstin) warnings.push("Your workspace has no GSTIN set — add it before filing.");

    log.info("getGstReturns:done", {
      period: data.period, invoices: invoices.length, b2b: b2b.length, b2cs: b2csMap.size,
    });

    return {
      period: data.period,
      orgGstin: org?.gstin ?? null,
      hsnDigits,
      counts: {
        invoices: invoices.length,
        creditNotes: notes.length,
        skippedNoGstin,
      },
      b2b, b2cl, b2cs: [...b2csMap.values()], cdnr, cdnur,
      hsnB2b: [...hsnB2bMap.values()], hsnB2c: [...hsnB2cMap.values()], docs,
      gstr3b: {
        outwardTaxable: r2(outwardTaxable),
        outwardIgst: r2(outwardIgst),
        outwardCgst: r2(outwardCgst),
        outwardSgst: r2(outwardSgst),
        creditNoteTaxable: r2(creditNoteTaxable),
        creditNoteTax: r2(creditNoteTax),
        inwardTaxable: r2(inwardTaxable),
        itcTotal: r2(itcTotal),
        itcSplitAvailable: false,
      },
      warnings: [...new Set(warnings)],
    };
  });
