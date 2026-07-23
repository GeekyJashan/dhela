import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createLogger } from "./logger";

const log = createLogger("eway.functions");

/** Consignment value at/above which an e-way bill is required (standard rule). */
export const EWAY_THRESHOLD = 50_000;

/** NIC transport-mode codes. */
const TRANS_MODE: Record<string, string> = { road: "1", rail: "2", air: "3", ship: "4" };

/** Does this invoice need an e-way bill? (value-based; movement of goods.) */
export function ewayNeeded(grandTotal: number | null | undefined): boolean {
  return Number(grandTotal ?? 0) >= EWAY_THRESHOLD;
}

/** dd/mm/yyyy for NIC. */
function nicDate(d: string | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
}
const stateNum = (s: string | null | undefined) => Number(String(s ?? "").trim()) || 0;
const asNum = (n: unknown) => Number(n ?? 0) || 0;

/** Persist Part B (transport) details and/or the EBN returned by the portal. */
export const saveEwayBill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      invoiceId: z.string().uuid(),
      ewb_no: z.string().nullish(),
      ewb_date: z.string().nullish(),
      ewb_valid_upto: z.string().nullish(),
      ewb_vehicle_no: z.string().nullish(),
      ewb_transport_mode: z.string().nullish(),
      ewb_distance_km: z.number().nullish(),
      ewb_transporter_id: z.string().nullish(),
      ewb_transporter_name: z.string().nullish(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { invoiceId, ...f } = data;
    // Partial update — only touch what was sent (undefined = leave, "" = clear).
    const patch: {
      ewb_no?: string | null; ewb_date?: string | null; ewb_valid_upto?: string | null;
      ewb_vehicle_no?: string | null; ewb_transport_mode?: string | null; ewb_distance_km?: number | null;
      ewb_transporter_id?: string | null; ewb_transporter_name?: string | null;
    } = {};
    const str = (v: string | null | undefined) => (v === "" ? null : v);
    if (f.ewb_no !== undefined) patch.ewb_no = str(f.ewb_no);
    if (f.ewb_date !== undefined) patch.ewb_date = str(f.ewb_date);
    if (f.ewb_valid_upto !== undefined) patch.ewb_valid_upto = str(f.ewb_valid_upto);
    if (f.ewb_vehicle_no !== undefined) patch.ewb_vehicle_no = str(f.ewb_vehicle_no);
    if (f.ewb_transport_mode !== undefined) patch.ewb_transport_mode = str(f.ewb_transport_mode);
    if (f.ewb_distance_km !== undefined) patch.ewb_distance_km = f.ewb_distance_km ?? null;
    if (f.ewb_transporter_id !== undefined) patch.ewb_transporter_id = str(f.ewb_transporter_id);
    if (f.ewb_transporter_name !== undefined) patch.ewb_transporter_name = str(f.ewb_transporter_name);
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await context.supabase.from("sales_invoices").update(patch).eq("id", invoiceId);
    if (error) throw new Error(error.message);
    log.info("saveEwayBill:ok", { invoiceId, fields: Object.keys(patch) });
    return { ok: true };
  });

/**
 * Build the NIC "Bulk Generation Tool" JSON for one or more invoices. The user
 * uploads this on ewaybillgst.gov.in to generate the e-way bills for free (no
 * GSP). Part A is filled from the invoice; Part B from the saved vehicle no.
 */
export const buildEwayBillJson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ invoiceIds: z.array(z.string().uuid()).min(1).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: invoices, error } = await supabase.from("sales_invoices")
      .select("*, retailer:retailers(name, gstin, address, city, state_code, pincode), org:organizations(name, gstin, address, state_code)")
      .in("id", data.invoiceIds);
    if (error) throw new Error(error.message);
    if (!invoices?.length) throw new Error("No invoices found");

    const ids = invoices.map(i => i.id);
    const { data: allLines } = await supabase.from("sales_invoice_lines")
      .select("sales_invoice_id, description, hsn, quantity, unit, taxable_value, gst_rate, cgst_amount, sgst_amount, igst_amount")
      .in("sales_invoice_id", ids);
    const linesByInv = new Map<string, typeof allLines>();
    for (const l of allLines ?? []) {
      const arr = linesByInv.get(l.sales_invoice_id) ?? [];
      arr.push(l); linesByInv.set(l.sales_invoice_id, arr as never);
    }

    const skipped: string[] = [];
    const bills = invoices.flatMap((inv) => {
      const org = inv.org as { name?: string; gstin?: string; address?: string; state_code?: string } | null;
      const r = inv.retailer as { name?: string; gstin?: string; address?: string; city?: string; state_code?: string; pincode?: string } | null;
      if (!org?.gstin) { skipped.push(`${inv.invoice_number}: your GSTIN missing`); return []; }
      const lines = (linesByInv.get(inv.id) ?? []) as NonNullable<typeof allLines>;
      return [{
        userGstin: org.gstin,
        supplyType: "O", subSupplyType: "1", docType: "INV",
        docNo: inv.invoice_number, docDate: nicDate(inv.invoice_date),
        fromGstin: org.gstin, fromTrdName: org.name ?? "", fromAddr1: org.address ?? "",
        fromPlace: "", fromPincode: 0,
        fromStateCode: stateNum(org.state_code), actFromStateCode: stateNum(org.state_code),
        toGstin: r?.gstin || "URP", toTrdName: r?.name ?? "", toAddr1: r?.address ?? "",
        toPlace: r?.city ?? "", toPincode: Number(r?.pincode ?? 0) || 0,
        toStateCode: stateNum(inv.place_of_supply ?? r?.state_code), actToStateCode: stateNum(inv.place_of_supply ?? r?.state_code),
        transactionType: 1,
        totalValue: asNum(inv.subtotal),
        cgstValue: asNum(inv.cgst_total), sgstValue: asNum(inv.sgst_total),
        igstValue: asNum(inv.igst_total), cessValue: 0,
        totInvValue: asNum(inv.grand_total),
        transMode: TRANS_MODE[inv.ewb_transport_mode ?? "road"] ?? "1",
        transDistance: String(inv.ewb_distance_km ?? 0),
        transporterName: inv.ewb_transporter_name ?? "",
        transporterId: inv.ewb_transporter_id ?? "",
        transDocNo: "", transDocDate: "",
        vehicleNo: (inv.ewb_vehicle_no ?? "").replace(/\s/g, "").toUpperCase(),
        vehicleType: "R",
        itemList: lines.map((l, i) => ({
          itemNo: i + 1,
          productName: (l.description ?? "").slice(0, 100),
          productDesc: (l.description ?? "").slice(0, 100),
          hsnCode: Number(String(l.hsn ?? "").replace(/\D/g, "")) || 0,
          quantity: asNum(l.quantity),
          qtyUnit: (l.unit ?? "NOS").slice(0, 3).toUpperCase(),
          taxableAmount: asNum(l.taxable_value),
          sgstRate: asNum(l.sgst_amount) > 0 ? asNum(l.gst_rate) / 2 : 0,
          cgstRate: asNum(l.cgst_amount) > 0 ? asNum(l.gst_rate) / 2 : 0,
          igstRate: asNum(l.igst_amount) > 0 ? asNum(l.gst_rate) : 0,
          cessRate: 0,
        })),
      }];
    });

    log.info("buildEwayBillJson:ok", { count: bills.length, skipped: skipped.length });
    return { json: JSON.stringify(bills, null, 2), count: bills.length, skipped };
  });
