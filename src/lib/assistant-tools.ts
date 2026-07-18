/**
 * Org-scoped data tools for the AI assistant. Executors run on the user's
 * RLS-scoped supabase client, so the model can only ever see the caller's
 * own organization. Results are compact JSON, row-capped to keep the
 * context small.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = { from: (t: string) => any };

const CAP = 20;
const num = (v: unknown) => (v == null ? 0 : Number(v));

export const TOOL_DECLARATIONS = [
  {
    name: "get_business_snapshot",
    description: "Overview of the business right now: counts of products/retailers/suppliers, total receivable from retailers, total payable to suppliers, open orders, and this month's sales totals.",
    parameters: { type: "OBJECT", properties: {}, },
  },
  {
    name: "search_retailers",
    description: "Find retailers (customers) by name. Returns category (A/B/C), city, phone and current outstanding balance (positive = they owe us).",
    parameters: {
      type: "OBJECT",
      properties: { query: { type: "STRING", description: "Part of the retailer name; empty string lists all (capped)" } },
      required: ["query"],
    },
  },
  {
    name: "search_products",
    description: "Find products by name or HSN. Returns MRP, purchase cost, current stock, GST rate and stock group.",
    parameters: {
      type: "OBJECT",
      properties: { query: { type: "STRING", description: "Part of the product name or HSN code; empty lists all (capped)" } },
      required: ["query"],
    },
  },
  {
    name: "sales_summary",
    description: "Aggregate sales between two dates from issued invoices: revenue (taxable value, before GST), tax, cost of goods, profit, quantity and invoice count. Optionally filter to one product and/or one retailer by name. Use this for questions like 'profit on product X from date A to date B'.",
    parameters: {
      type: "OBJECT",
      properties: {
        from_date: { type: "STRING", description: "YYYY-MM-DD inclusive" },
        to_date: { type: "STRING", description: "YYYY-MM-DD inclusive" },
        product_query: { type: "STRING", description: "Optional: part of a product name to filter lines" },
        retailer_query: { type: "STRING", description: "Optional: part of a retailer name to filter invoices" },
      },
      required: ["from_date", "to_date"],
    },
  },
  {
    name: "list_sales_invoices",
    description: "List issued sales invoices, newest first, with totals, profit and payment status. Optional date range and retailer name filter.",
    parameters: {
      type: "OBJECT",
      properties: {
        from_date: { type: "STRING" }, to_date: { type: "STRING" },
        retailer_query: { type: "STRING" },
        payment_status: { type: "STRING", description: "unpaid | partial | paid" },
      },
    },
  },
  {
    name: "get_sales_invoice",
    description: "Full details of one sales invoice by its number (e.g. INV-2026-0003): header, line items with rates/discounts/GST, amount paid.",
    parameters: {
      type: "OBJECT",
      properties: { invoice_number: { type: "STRING" } },
      required: ["invoice_number"],
    },
  },
  {
    name: "list_purchase_invoices",
    description: "List purchase (supplier) invoices, newest first: supplier, number, date, total, extraction/approval status. Optional date range and supplier name filter.",
    parameters: {
      type: "OBJECT",
      properties: { from_date: { type: "STRING" }, to_date: { type: "STRING" }, supplier_query: { type: "STRING" } },
    },
  },
  {
    name: "party_statement",
    description: "Account statement (ledger) for one retailer or supplier between two dates: every invoice, payment and credit note with running totals, plus opening and closing balance.",
    parameters: {
      type: "OBJECT",
      properties: {
        party_type: { type: "STRING", description: "retailer | supplier" },
        party_query: { type: "STRING", description: "Part of the party name" },
        from_date: { type: "STRING" }, to_date: { type: "STRING" },
      },
      required: ["party_type", "party_query", "from_date", "to_date"],
    },
  },
  {
    name: "receivables_ageing",
    description: "Outstanding (unpaid) sales invoice amounts per retailer, bucketed by age: 0-30, 31-60, 60+ days.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "list_orders",
    description: "Retailer orders with fulfillment progress. Optional status filter: pending | partial | fulfilled | cancelled.",
    parameters: { type: "OBJECT", properties: { status: { type: "STRING" } } },
  },
  {
    name: "list_payments",
    description: "Payments recorded (money received from retailers / paid to suppliers), newest first. Optional date range and party name filter.",
    parameters: {
      type: "OBJECT",
      properties: { from_date: { type: "STRING" }, to_date: { type: "STRING" }, party_query: { type: "STRING" } },
    },
  },
] as const;

export async function executeTool(db: Db, name: string, args: Record<string, any>): Promise<unknown> {
  switch (name) {
    case "get_business_snapshot": {
      const [prod, ret, sup, bal, orders, sales] = await Promise.all([
        db.from("products").select("id", { count: "exact", head: true }),
        db.from("retailers").select("id", { count: "exact", head: true }),
        db.from("suppliers").select("id", { count: "exact", head: true }),
        db.from("party_balances").select("party_type, balance"),
        db.from("orders").select("id", { count: "exact", head: true }).in("status", ["pending", "partial"]),
        db.from("sales_invoices").select("grand_total, total_profit")
          .in("status", ["issued", "paid"])
          .gte("invoice_date", new Date().toISOString().slice(0, 8) + "01"),
      ]);
      const rows = (bal.data ?? []) as { party_type: string; balance: number }[];
      return {
        products: prod.count ?? 0,
        retailers: ret.count ?? 0,
        suppliers: sup.count ?? 0,
        receivable_from_retailers: rows.filter(b => b.party_type === "retailer").reduce((s, b) => s + num(b.balance), 0),
        payable_to_suppliers: rows.filter(b => b.party_type === "supplier").reduce((s, b) => s + num(b.balance), 0),
        open_orders: orders.count ?? 0,
        this_month_sales_total: (sales.data ?? []).reduce((s: number, i: any) => s + num(i.grand_total), 0),
        this_month_profit: (sales.data ?? []).reduce((s: number, i: any) => s + num(i.total_profit), 0),
      };
    }

    case "search_retailers": {
      let q = db.from("retailers")
        .select("id, name, category, city, phone, opening_balance").order("name").limit(CAP);
      if (args.query) q = q.ilike("name", `%${args.query}%`);
      const { data } = await q;
      const { data: bal } = await db.from("party_balances")
        .select("party_id, balance").eq("party_type", "retailer");
      const balMap = new Map((bal ?? []).map((b: any) => [b.party_id, num(b.balance)]));
      return (data ?? []).map((r: any) => ({
        name: r.name, category: r.category, city: r.city, phone: r.phone,
        outstanding_balance: balMap.get(r.id) ?? 0,
      }));
    }

    case "search_products": {
      let q = db.from("products")
        .select("name, hsn, gst_rate, mrp, purchase_rate, last_purchase_rate, current_stock, stock_group:stock_groups(name)")
        .order("name").limit(CAP);
      if (args.query) q = q.or(`name.ilike.%${args.query}%,hsn.ilike.%${args.query}%`);
      const { data } = await q;
      return (data ?? []).map((p: any) => ({
        name: p.name, hsn: p.hsn, gst_rate: p.gst_rate, mrp: p.mrp,
        purchase_cost: p.last_purchase_rate ?? p.purchase_rate,
        current_stock: num(p.current_stock),
        stock_group: p.stock_group?.name ?? null,
      }));
    }

    case "sales_summary": {
      let q = db.from("sales_invoice_lines")
        .select("description, quantity, taxable_value, tax_amount, cost_price, profit, invoice:sales_invoices!inner(invoice_number, invoice_date, status, retailer:retailers(name))")
        .gte("invoice.invoice_date", args.from_date)
        .lte("invoice.invoice_date", args.to_date)
        .in("invoice.status", ["issued", "paid"])
        .limit(2000);
      if (args.product_query) q = q.ilike("description", `%${args.product_query}%`);
      const { data, error } = await q;
      if (error) return { error: error.message };
      let lines = (data ?? []) as any[];
      if (args.retailer_query) {
        const rq = String(args.retailer_query).toLowerCase();
        lines = lines.filter(l => (l.invoice?.retailer?.name ?? "").toLowerCase().includes(rq));
      }
      const invoices = new Set(lines.map(l => l.invoice?.invoice_number));
      return {
        from: args.from_date, to: args.to_date,
        product_filter: args.product_query ?? null,
        retailer_filter: args.retailer_query ?? null,
        line_count: lines.length,
        invoice_count: invoices.size,
        quantity: lines.reduce((s, l) => s + num(l.quantity), 0),
        revenue_taxable: +lines.reduce((s, l) => s + num(l.taxable_value), 0).toFixed(2),
        tax: +lines.reduce((s, l) => s + num(l.tax_amount), 0).toFixed(2),
        cost_of_goods: +lines.reduce((s, l) => s + num(l.cost_price) * num(l.quantity), 0).toFixed(2),
        profit: +lines.reduce((s, l) => s + num(l.profit), 0).toFixed(2),
      };
    }

    case "list_sales_invoices": {
      let q = db.from("sales_invoices")
        .select("invoice_number, invoice_date, grand_total, total_profit, status, payment_status, amount_paid, retailer:retailers(name)")
        .in("status", ["issued", "paid"])
        .order("invoice_date", { ascending: false }).limit(CAP);
      if (args.from_date) q = q.gte("invoice_date", args.from_date);
      if (args.to_date) q = q.lte("invoice_date", args.to_date);
      if (args.payment_status) q = q.eq("payment_status", args.payment_status);
      const { data } = await q;
      let rows = (data ?? []) as any[];
      if (args.retailer_query) {
        const rq = String(args.retailer_query).toLowerCase();
        rows = rows.filter(r => (r.retailer?.name ?? "").toLowerCase().includes(rq));
      }
      return rows.map(r => ({
        invoice_number: r.invoice_number, date: r.invoice_date,
        retailer: r.retailer?.name ?? null,
        total: num(r.grand_total), profit: num(r.total_profit),
        payment_status: r.payment_status, amount_paid: num(r.amount_paid),
      }));
    }

    case "get_sales_invoice": {
      const { data: inv } = await db.from("sales_invoices")
        .select("*, retailer:retailers(name, gstin)")
        .eq("invoice_number", args.invoice_number).maybeSingle();
      if (!inv) return { error: `No sales invoice ${args.invoice_number}` };
      const { data: lines } = await db.from("sales_invoice_lines")
        .select("description, hsn, quantity, rate, discount_pct, gst_rate, taxable_value, tax_amount, line_total, profit")
        .eq("sales_invoice_id", inv.id).order("line_no");
      return {
        invoice_number: inv.invoice_number, date: inv.invoice_date,
        retailer: inv.retailer?.name, retailer_gstin: inv.retailer?.gstin,
        status: inv.status, payment_status: inv.payment_status,
        subtotal: num(inv.subtotal), tax_total: num(inv.tax_total),
        grand_total: num(inv.grand_total), amount_paid: num(inv.amount_paid),
        total_profit: num(inv.total_profit),
        lines: (lines ?? []),
      };
    }

    case "list_purchase_invoices": {
      let q = db.from("invoices")
        .select("invoice_number, invoice_date, supplier_name, grand_total, status, extraction_engine")
        .order("created_at", { ascending: false }).limit(CAP);
      if (args.from_date) q = q.gte("invoice_date", args.from_date);
      if (args.to_date) q = q.lte("invoice_date", args.to_date);
      if (args.supplier_query) q = q.ilike("supplier_name", `%${args.supplier_query}%`);
      const { data } = await q;
      return data ?? [];
    }

    case "party_statement": {
      const table = args.party_type === "supplier" ? "suppliers" : "retailers";
      const { data: party } = await db.from(table)
        .select("id, name, opening_balance").ilike("name", `%${args.party_query}%`).limit(1).maybeSingle();
      if (!party) return { error: `No ${args.party_type} matching "${args.party_query}"` };
      const { data: ledger } = await db.from("party_ledger")
        .select("tx_date, kind, ref, debit, credit")
        .eq("party_type", args.party_type === "supplier" ? "supplier" : "retailer")
        .eq("party_id", party.id).order("tx_date").order("created_at");
      const rows = ((ledger ?? []) as any[]).map(r =>
        args.party_type === "supplier" ? { ...r, debit: num(r.credit), credit: num(r.debit) } : r);
      const opening = num(party.opening_balance) +
        rows.filter(r => r.tx_date < args.from_date).reduce((s, r) => s + num(r.debit) - num(r.credit), 0);
      const inRange = rows.filter(r => r.tx_date >= args.from_date && r.tx_date <= args.to_date);
      const closing = opening + inRange.reduce((s, r) => s + num(r.debit) - num(r.credit), 0);
      return {
        party: party.name, party_type: args.party_type,
        from: args.from_date, to: args.to_date,
        opening_balance: +opening.toFixed(2),
        closing_balance: +closing.toFixed(2),
        note: "positive balance = " + (args.party_type === "supplier" ? "we owe them" : "they owe us"),
        entries: inRange.slice(0, 60),
      };
    }

    case "receivables_ageing": {
      const { data } = await db.from("sales_invoices")
        .select("invoice_number, invoice_date, grand_total, amount_paid, retailer:retailers(name)")
        .in("status", ["issued", "paid"]).neq("payment_status", "paid");
      const today = Date.now();
      const out = ((data ?? []) as any[])
        .map(i => ({
          retailer: i.retailer?.name ?? null,
          invoice_number: i.invoice_number,
          due: +(num(i.grand_total) - num(i.amount_paid)).toFixed(2),
          days_outstanding: Math.floor((today - new Date(i.invoice_date).getTime()) / 86_400_000),
        }))
        .filter(x => x.due > 0)
        .sort((a, b) => b.days_outstanding - a.days_outstanding);
      return out.slice(0, 60);
    }

    case "list_orders": {
      let q = db.from("orders")
        .select("order_number, order_date, status, retailer:retailers(name), order_lines(quantity, fulfilled_quantity, product:products(name))")
        .order("order_date", { ascending: false }).limit(CAP);
      if (args.status) q = q.eq("status", args.status);
      const { data } = await q;
      return ((data ?? []) as any[]).map(o => ({
        order_number: o.order_number, date: o.order_date, status: o.status,
        retailer: o.retailer?.name ?? null,
        lines: (o.order_lines ?? []).map((l: any) => ({
          product: l.product?.name ?? null, ordered: num(l.quantity), fulfilled: num(l.fulfilled_quantity),
        })),
      }));
    }

    case "list_payments": {
      let q = db.from("payments")
        .select("payment_date, party_type, amount, discount_amount, mode, reference, retailer:retailers(name), supplier:suppliers(name)")
        .order("payment_date", { ascending: false }).limit(CAP);
      if (args.from_date) q = q.gte("payment_date", args.from_date);
      if (args.to_date) q = q.lte("payment_date", args.to_date);
      const { data } = await q;
      let rows = ((data ?? []) as any[]).map(p => ({
        date: p.payment_date,
        direction: p.party_type === "retailer" ? "received" : "paid_out",
        party: p.retailer?.name ?? p.supplier?.name ?? null,
        amount: num(p.amount), settlement_discount: num(p.discount_amount),
        mode: p.mode, reference: p.reference,
      }));
      if (args.party_query) {
        const pq = String(args.party_query).toLowerCase();
        rows = rows.filter(r => (r.party ?? "").toLowerCase().includes(pq));
      }
      return rows;
    }

    default:
      return { error: `Unknown tool ${name}` };
  }
}
