
/**
 * What the business is actually doing, and what to do about it today.
 *
 * A distributor does not fail on margin, they fail on cash. Stock that will
 * not move and invoices that will not be paid are the same problem wearing two
 * hats: money that has left the bank and not come back. So the headline figure
 * here is working capital locked, and the return the business earns on it —
 * the one number that says whether the operation is creating value rather than
 * just turning over.
 *
 * Every finding carries a rupee amount and one thing to do. A dashboard that
 * reports "inventory turnover 4.2x" tells an owner nothing they can act on
 * before lunch; "₹1,24,000 sitting in 9 products nobody has bought since May,
 * here they are" does.
 *
 * All figures come from issued invoices and approved purchases only, under the
 * caller's own RLS — drafts and unapproved bills are not facts yet.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };

const DAYS_HISTORY = 90;
const DEAD_STOCK_DAYS = 60;
const QUIET_RETAILER_DAYS = 45;
/** Below this many days of cover, a fast mover is a stockout waiting to happen. */
const COVER_DAYS_WARNING = 14;

const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const round = (v: number) => Math.round(v * 100) / 100;

export type Action = {
  kind: "dead_stock" | "overdue" | "below_cost" | "quiet_retailer" | "stockout";
  title: string;
  /** Rupees at stake. Sorting by this is what makes the list a priority list. */
  amount: number;
  detail: string;
  items: { name: string; amount: number; note?: string }[];
  /** Where the operator goes to actually do something about it. */
  to: string;
};

/**
 * Runs against whichever Supabase client is handed in, so the dashboard and
 * the assistant see exactly the same numbers. Two places computing "how is
 * the business" separately is two places to drift.
 */
export async function computeInsights(supabase: Db) {
  const since = daysAgo(DAYS_HISTORY);

  const [products, lines, invoices, balances, purchases] = await Promise.all([
    supabase.from("products").select("id, name, current_stock, avg_cost, purchase_rate, mrp").limit(5000),
    supabase.from("sales_invoice_lines")
      .select("product_id, description, quantity, taxable_value, cost_price, profit, invoice:sales_invoices!inner(invoice_date, status, retailer_id)")
      .gte("invoice.invoice_date", since)
      .in("invoice.status", ["issued", "paid"])
      .limit(20000),
    supabase.from("sales_invoices")
      .select("id, invoice_number, invoice_date, due_date, grand_total, amount_paid, payment_status, retailer_id, retailer:retailers(name)")
      .in("status", ["issued", "paid"])
      .limit(5000),
    supabase.from("party_balances").select("party_type, party_id, balance"),
    supabase.from("invoices").select("grand_total").eq("status", "approved").gte("invoice_date", since).limit(5000),
  ]);

  const prods = (products.data ?? []) as any[];
  const sold = (lines.data ?? []) as any[];
  const invs = (invoices.data ?? []) as any[];
  const bals = (balances.data ?? []) as any[];

  // ---- headline figures -------------------------------------------------
  const stockValue = prods.reduce(
    (s, p) => s + num(p.current_stock) * (num(p.avg_cost) || num(p.purchase_rate)), 0);
  const receivable = bals.filter(b => b.party_type === "retailer").reduce((s, b) => s + num(b.balance), 0);
  const payable = bals.filter(b => b.party_type === "supplier").reduce((s, b) => s + num(b.balance), 0);

  const revenue = sold.reduce((s, l) => s + num(l.taxable_value), 0);
  const grossProfit = sold.reduce((s, l) => s + num(l.profit), 0);
  const cogs = sold.reduce((s, l) => s + num(l.cost_price) * num(l.quantity), 0);

  // Working capital is what the owner has funded: goods on the shelf plus
  // money owed to them, less what they have not yet paid their suppliers.
  const workingCapital = stockValue + receivable - payable;
  const dailyRevenue = revenue / DAYS_HISTORY;
  const dailyCogs = cogs / DAYS_HISTORY;

  // Ratios need enough underneath them to mean anything. Three invoices in
  // ninety days annualised into a return on capital is a confident number
  // built on nothing, and a dashboard that does that is worse than one that
  // says "not enough data yet".
  const salesCount = invs.filter(i => i.invoice_date >= since).length;
  const enoughToJudge = salesCount >= 5 && revenue > 0;

  const headline = {
    revenue: round(revenue),
    grossProfit: round(grossProfit),
    marginPct: revenue > 0 ? round((grossProfit / revenue) * 100) : null,
    stockValue: round(stockValue),
    receivable: round(receivable),
    payable: round(payable),
    workingCapital: round(workingCapital),
    // How long a rupee stays out before it comes back as cash.
    // A negative receivable means retailers are in credit — real, but "-41
    // days to collect" is meaningless, so it stays blank rather than wrong.
    dsoDays: enoughToJudge && receivable > 0 && dailyRevenue > 0
      ? Math.round(receivable / dailyRevenue) : null,
    stockCoverDays: dailyCogs > 0 ? Math.round(stockValue / dailyCogs) : null,
    // Annualised return on the capital the owner has tied up. The research
    // benchmark for a healthy distributor is roughly 12-16%; below that the
    // business is working hard to fund its own shelves.
    capitalReturnPct: enoughToJudge && workingCapital > 0
      ? round(((grossProfit * (365 / DAYS_HISTORY)) / workingCapital) * 100)
      : null,
    periodDays: DAYS_HISTORY,
    // Surfaced so the screen can admit when it is working from very little.
    salesCount,
    enoughToJudge,
  };

  // ---- what to do about it ---------------------------------------------
  const actions: Action[] = [];
  const soldRecently = new Map<string, number>();   // product_id -> last sale (days ago)
  const unitsSold = new Map<string, number>();
  for (const l of sold) {
    if (!l.product_id) continue;
    const days = Math.round((Date.now() - new Date(l.invoice.invoice_date).getTime()) / 86_400_000);
    soldRecently.set(l.product_id, Math.min(soldRecently.get(l.product_id) ?? 9999, days));
    unitsSold.set(l.product_id, (unitsSold.get(l.product_id) ?? 0) + num(l.quantity));
  }

  // 1. Stock nobody is buying. This is cash on a shelf.
  const dead = prods
    .filter(p => num(p.current_stock) > 0 && (soldRecently.get(p.id) ?? 9999) > DEAD_STOCK_DAYS)
    .map(p => ({ name: p.name as string, amount: round(num(p.current_stock) * (num(p.avg_cost) || num(p.purchase_rate))),
                 note: soldRecently.has(p.id) ? `last sold ${soldRecently.get(p.id)}d ago` : "never sold" }))
    .filter(d => d.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  if (dead.length) {
    actions.push({
      kind: "dead_stock",
      title: `₹${Math.round(dead.reduce((s, d) => s + d.amount, 0)).toLocaleString("en-IN")} is sitting in stock nobody has bought`,
      amount: dead.reduce((s, d) => s + d.amount, 0),
      detail: `${dead.length} product(s) with stock but no sale in ${DEAD_STOCK_DAYS} days. Discount them, bundle them, or stop reordering.`,
      items: dead.slice(0, 5),
      to: "/pricing",
    });
  }

  // 2. Money already earned that has not arrived.
  const today = new Date().toISOString().slice(0, 10);
  const overdue = invs
    .filter(i => i.payment_status !== "paid" && i.due_date && i.due_date < today)
    .map(i => ({ name: `${i.retailer?.name ?? "Retailer"} · ${i.invoice_number}`,
                 amount: round(num(i.grand_total) - num(i.amount_paid)),
                 note: `${Math.round((Date.now() - new Date(i.due_date).getTime()) / 86_400_000)}d overdue` }))
    .filter(o => o.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  if (overdue.length) {
    actions.push({
      kind: "overdue",
      title: `₹${Math.round(overdue.reduce((s, o) => s + o.amount, 0)).toLocaleString("en-IN")} is past its due date`,
      amount: overdue.reduce((s, o) => s + o.amount, 0),
      detail: `${overdue.length} invoice(s) are overdue. Chase the largest first — this is money you have already earned and paid tax on.`,
      items: overdue.slice(0, 5),
      to: "/payments",
    });
  }

  // 3. Lines sold at or under what they cost. Every unit deepens the hole.
  const leak = new Map<string, { name: string; amount: number; units: number }>();
  for (const l of sold) {
    const cost = num(l.cost_price) * num(l.quantity);
    const got = num(l.taxable_value);
    if (cost > 0 && got < cost) {
      const key = l.product_id ?? l.description;
      const at = leak.get(key) ?? { name: l.description ?? "Unknown", amount: 0, units: 0 };
      at.amount += cost - got;
      at.units += num(l.quantity);
      leak.set(key, at);
    }
  }
  const below = [...leak.values()]
    .map(v => ({ name: v.name, amount: round(v.amount), note: `${v.units} units below cost` }))
    .sort((a, b) => b.amount - a.amount);
  if (below.length) {
    actions.push({
      kind: "below_cost",
      title: `₹${Math.round(below.reduce((s, b) => s + b.amount, 0)).toLocaleString("en-IN")} lost selling under cost`,
      amount: below.reduce((s, b) => s + b.amount, 0),
      detail: "These went out below what they cost to buy. Check the pricing rule or the discount on these products.",
      items: below.slice(0, 5),
      to: "/pricing",
    });
  }

  // 4. A retailer who used to buy and has stopped. Cheapest sale to win back.
  const byRetailer = new Map<string, { total: number; last: number; name: string }>();
  for (const i of invs) {
    if (!i.retailer_id) continue;
    const days = Math.round((Date.now() - new Date(i.invoice_date).getTime()) / 86_400_000);
    if (days > DAYS_HISTORY) continue;
    const at = byRetailer.get(i.retailer_id) ?? { total: 0, last: 9999, name: i.retailer?.name ?? "Retailer" };
    at.total += num(i.grand_total);
    at.last = Math.min(at.last, days);
    byRetailer.set(i.retailer_id, at);
  }
  const quiet = [...byRetailer.values()]
    .filter(r => r.last > QUIET_RETAILER_DAYS && r.total > 0)
    .map(r => ({ name: r.name, amount: round(r.total), note: `nothing for ${r.last}d` }))
    .sort((a, b) => b.amount - a.amount);
  if (quiet.length) {
    actions.push({
      kind: "quiet_retailer",
      title: `${quiet.length} retailer(s) have gone quiet`,
      amount: quiet.reduce((s, q) => s + q.amount, 0),
      detail: `They bought ₹${Math.round(quiet.reduce((s, q) => s + q.amount, 0)).toLocaleString("en-IN")} in the last ${DAYS_HISTORY} days and nothing recently. A phone call costs nothing.`,
      items: quiet.slice(0, 5),
      to: "/retailers",
    });
  }

  // 5. Fast movers about to run out. A stockout is a sale handed to someone else.
  const risk = prods
    .map(p => {
      const perDay = (unitsSold.get(p.id) ?? 0) / DAYS_HISTORY;
      const cover = perDay > 0 ? num(p.current_stock) / perDay : Infinity;
      return { p, perDay, cover };
    })
    .filter(r => r.perDay > 0 && r.cover < COVER_DAYS_WARNING)
    .sort((a, b) => a.cover - b.cover)
    .map(r => ({
      name: r.p.name as string,
      // Value of a month's sales that would be missed if it runs dry.
      amount: round(r.perDay * 30 * (num(r.p.avg_cost) || num(r.p.purchase_rate))),
      note: `${Math.round(r.cover)}d of stock left`,
    }));
  if (risk.length) {
    actions.push({
      kind: "stockout",
      title: `${risk.length} fast-moving product(s) run out within ${COVER_DAYS_WARNING} days`,
      amount: risk.reduce((s, r) => s + r.amount, 0),
      detail: "At the current rate these run dry. Reorder before a retailer asks and you have to say no.",
      items: risk.slice(0, 5),
      to: "/products",
    });
  }

  // Biggest rupee impact first, because that is the order to spend a morning in.
  actions.sort((a, b) => b.amount - a.amount);
  return { headline, actions };
}
