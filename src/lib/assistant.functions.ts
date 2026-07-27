import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createLogger } from "./logger";
import { TOOL_DECLARATIONS, executeTool } from "./assistant-tools";
import { getOrgBilling } from "./billing.functions";
import { aiProvider, anthropicModel, geminiModel, toAnthropicTools } from "./ai-provider";

const log = createLogger("assistant.functions");

const MAX_TOOL_ROUNDS = 8;

type Part = Record<string, unknown>;
type Content = { role: string; parts: Part[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };

const PLATFORM_GUIDE = `
HOW DHELA IS LAID OUT (use this to answer "how do I…" / "where is…" navigation questions — no tool call needed for these):

Sidebar is grouped as: Overview, Buying, Selling, Catalog, Finance, System. Billing and Account live under System, not Finance. Admin appears inside System for platform admins only.

Overview
- Dashboard (/dashboard): home screen — recent purchase invoices and a quick snapshot of the business.
- Insights (/insights): charts on how money is actually moving — collections over time, receivables ageing, payment modes, and which retailers and suppliers the business leans on most. Reporting only; nothing is recorded here.

Buying (purchases from your suppliers)
- Upload invoice (/upload): drop one or many supplier invoice PDFs/photos. Choose "AI" (Gemini — full extraction of supplier, header, line items, HSN, batch, expiry; uses the monthly AI quota) or "OCR" (free, heuristic, best on clean digital invoices — always review before approving). A single file is read instantly and opens for review; multiple files process in the background and appear in Purchases once done.
- Purchases (/invoices): list of uploaded purchase invoices. Open one to review/edit extracted header + line items, "Re-extract" if the reading looks wrong, then "Approve" — approving posts the items into stock and updates each product's weighted-average cost (avg_cost). This is what makes stock and cost-of-goods accurate, so always approve (not just upload) for stock to update.
- Suppliers (/suppliers): add/edit suppliers. Type the GSTIN first — name, address, city, state and PIN auto-fill from the government registry. GSTIN is required and validated before saving; duplicate suppliers (by GSTIN) are blocked.

Selling (sales to your retailers)
- Sales (/sales): list of sales invoices. From here you can "Issue" a draft invoice (locks it and deducts stock) or "Record payment" against an issued one.
- New/Edit sales invoice (/sales/new): pick a retailer, add line items (product, quantity, rate auto-fills from pricing rules), then "Save draft" (editable, no stock impact yet) or "Issue invoice" (final, deducts stock, cost is locked at issue for accurate profit).
- Sales invoice detail (/sales/$id): view/print the invoice, add bank details + authorized signature (needed before printing a proper invoice), "Return items" against it, and manage its E-way bill via the "E-way bill" button (see below). Print / Save PDF is here too.
- Orders (/orders): customer purchase orders — either upload a retailer's order file (AI-read) or key one in manually. Track and convert into a sales invoice.
- Returns (/returns): create a credit note against a retailer's issued invoice — pick the retailer, then the invoice, then the quantities being returned.
- Retailers (/retailers): add/edit retailers. GSTIN is optional for retailers (many are unregistered/URP) but if entered it's validated; duplicate check falls back to name when there's no GSTIN. Also set default discount %, credit limit, and category here.

Catalog
- Products (/products): product master — name, SKU, unit, HSN (auto-fills from the name; search by name or code), GST rate, MRP, purchase rate, current stock.
- Pricing (/pricing): stock-group-level discounts, plus per-product/per-retailer price overrides that take priority over the group discount.

Finance
- Payments (/payments): record a payment received from (or made to) a party, see receivables ageing, and full payment history (filterable by All / Received / Paid out). "Record payment" is also reachable directly from a sales invoice row. The charts that used to sit here now live under Overview → Insights.
- GST returns (/gst): pick a month and Dhela builds GSTR-1 working papers (B2B, B2CL, B2CS, CDNR, CDNUR, HSN summary, document series) plus a GSTR-3B summary, each downloadable as CSV for the accountant. Built from issued sales invoices and approved purchases only — drafts and unapproved purchases are excluded. Dhela does NOT file returns; the taxpayer files on the GST portal. If asked whether Dhela files GST returns, say no clearly.

- Account statement: not in the sidebar directly — open it from a retailer's or supplier's row ("Statement" action) on the Retailers/Suppliers page. Shows a running debit/credit ledger for that party over a chosen date range, printable.

System (workspace settings, not day-to-day work)
- Billing (/billing): current plan, monthly AI-extraction usage meter, and how to upgrade (scan the UPI QR at checkout, then send the payment screenshot on WhatsApp or by email — upgrades activate same day).
- Account (/account): the workspace's own business details — name, GSTIN, address, state code, phone, email — plus the bank and signatory block printed at the bottom of sales invoices, and a "Clear all data" action that wipes every business record but keeps the login and workspace. Set the GSTIN here; without it invoices print without one and GST returns warn. Admin role only for changes.
- Admin (/admin, platform admins only): manage users and get an invite link for the workspace.

E-way bills (/eway) — under Selling
- Flags sales invoices at or above ₹50,000 (the legal e-way bill threshold) that still need one. Open a sales invoice and tap "E-way bill" to fill vehicle/transport details (Part B — the invoice's own data is Part A, filled automatically), then "Download NIC JSON" — a ready-made file you upload yourself at ewaybillgst.gov.in → Bulk Generation to get the E-way Bill Number (EBN) for free. Paste that EBN back in to store it, print it on the invoice, and track its validity/expiry from the /eway register.

Other things worth knowing
- Language: switch English / Hindi / Punjabi from the bottom of the sidebar.
- The AI quota (extractions/month) is shared across: AI-engine invoice uploads, AI-read order uploads, and questions asked to this assistant. OCR uploads never use it.

If a user asks "how do I do X" or "where do I find X", answer directly from this guide (with the page name and the exact steps/button) — do not call a tool for this, tools are only for pulling their actual data/numbers.
`;

function systemPrompt(orgName: string) {
  const today = new Date().toISOString().slice(0, 10);
  return `You are Dhela Assistant, the built-in business analyst and product guide for "${orgName}", an Indian distributor using the Dhela app. Today is ${today}.
${PLATFORM_GUIDE}
Rules:
- Two kinds of questions: (1) data/numbers about their business — invoices, retailers, suppliers, products, stock, orders, payments, statements, profit — answer these using ONLY the provided tools, every number must come from a tool result, never estimate or invent figures; (2) "how do I…" / "where is…" navigation questions about using the app — answer these directly from the platform guide above, no tool call needed. If a question mixes both, do both.
- Call as many tools as needed before answering a data question. For date-range questions, compute the range yourself (e.g. "last month", "this week") from today's date.
- Profit = taxable value minus recorded cost of goods; GST is excluded from profit. If a product has no recorded purchase cost, its profit is overstated — mention that when relevant.
- Currency is INR. Format amounts in the Indian style, e.g. ₹1,23,456.78.
- Reply in the SAME language the user asked in (English, Hindi or Punjabi).
- Be concise: lead with the direct answer, then a short breakdown if useful. Plain text only — no markdown symbols like ** or #. Use "•" for lists.
- If you spot a discrepancy in the data (totals that don't add up, unpaid amounts that look wrong), state it plainly.
- If you cannot answer confidently, if data is missing, or the user asks for a feature Dhela doesn't have: say so honestly and add that they can tap "Talk to Jashan" below to reach Jashan Sehgal, the founder, for help or feature requests. Never bluff.`;
}

async function callGemini(apiKey: string, system: string, contents: Content[]) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel()}:generateContent`;
  const resp = await fetch(`${url}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      generationConfig: { temperature: 0.2 },
    }),
  });
  if (!resp.ok) {
    const body = (await resp.text()).slice(0, 300);
    throw new Error(`Assistant service error ${resp.status}: ${body}`);
  }
  const json = await resp.json();
  return (json.candidates?.[0]?.content ?? { role: "model", parts: [] }) as Content;
}

type QA = { question: string; answer: string };

/** Gemini agentic loop over the data tools. */
async function runGemini(
  apiKey: string, system: string, history: QA[], question: string, db: Db,
): Promise<{ answer: string; toolCalls: number }> {
  const contents: Content[] = [];
  for (const h of history) {
    contents.push({ role: "user", parts: [{ text: h.question }] });
    contents.push({ role: "model", parts: [{ text: h.answer }] });
  }
  contents.push({ role: "user", parts: [{ text: question }] });

  let toolCalls = 0;
  let content = await callGemini(apiKey, system, contents);
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const calls = content.parts.filter(p => (p as { functionCall?: unknown }).functionCall) as
      { functionCall: { name: string; args?: Record<string, unknown> } }[];
    if (!calls.length) break;
    contents.push(content);
    const responses: Part[] = [];
    for (const c of calls) {
      toolCalls++;
      let result: unknown;
      try { result = await executeTool(db, c.functionCall.name, c.functionCall.args ?? {}); }
      catch (e) { result = { error: (e as Error).message }; }
      responses.push({ functionResponse: { name: c.functionCall.name, response: { result } } });
    }
    contents.push({ role: "user", parts: responses });
    content = await callGemini(apiKey, system, contents);
  }
  const answer = content.parts.map(p => (p as { text?: string }).text ?? "").join("").trim();
  return { answer, toolCalls };
}

/** Anthropic (Claude) agentic loop over the same data tools. */
async function runAnthropic(
  apiKey: string, system: string, history: QA[], question: string, db: Db,
): Promise<{ answer: string; toolCalls: number }> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const tools = toAnthropicTools(TOOL_DECLARATIONS);

  type Block = Record<string, unknown>;
  const messages: { role: "user" | "assistant"; content: string | Block[] }[] = [];
  for (const h of history) {
    messages.push({ role: "user", content: h.question });
    messages.push({ role: "assistant", content: h.answer });
  }
  messages.push({ role: "user", content: question });

  let toolCalls = 0;
  let answer = "";
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp: any = await client.messages.create({
      model: anthropicModel(),
      max_tokens: 2048,
      system,
      tools,
      messages: messages as never,
    });
    messages.push({ role: "assistant", content: resp.content });
    const toolUses = (resp.content as Block[]).filter(b => b.type === "tool_use");
    answer = (resp.content as Block[])
      .filter(b => b.type === "text").map(b => (b as { text: string }).text).join("").trim();
    if (!toolUses.length) break;
    const results: Block[] = [];
    for (const tu of toolUses) {
      toolCalls++;
      let result: unknown;
      try { result = await executeTool(db, tu.name as string, (tu.input as Record<string, unknown>) ?? {}); }
      catch (e) { result = { error: (e as Error).message }; }
      results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result) });
    }
    messages.push({ role: "user", content: results });
  }
  return { answer, toolCalls };
}

export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ question: z.string().min(2).max(2000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const provider = aiProvider();
    const apiKey = provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error(
        `Assistant is not configured (${provider === "anthropic" ? "ANTHROPIC_API_KEY" : "GOOGLE_API_KEY"} missing on the server)`,
      );
    }

    const { data: mem } = await supabase.from("memberships")
      .select("org_id, organization:organizations(name)")
      .eq("user_id", userId).limit(1).maybeSingle();
    if (!mem) throw new Error("No organization");
    const orgId = mem.org_id as string;
    const orgName = (mem.organization as { name?: string } | null)?.name ?? "your business";

    // One question = one unit of the AI quota (same meter as extractions).
    const billing = await getOrgBilling(supabase, orgId);
    if (billing.aiUsedThisMonth >= billing.aiLimitPerMonth) {
      throw new Error(
        `AI limit reached (${billing.aiUsedThisMonth}/${billing.aiLimitPerMonth} this month). ` +
        `Upgrade your plan on the Billing page to keep asking.`,
      );
    }

    // Short rolling history so follow-up questions have context.
    const { data: history } = await supabase.from("assistant_messages")
      .select("question, answer").eq("org_id", orgId)
      .order("created_at", { ascending: false }).limit(5);
    const qaHistory = ((history ?? []).reverse()) as QA[];

    log.info("ask:start", { orgId, provider, q: data.question.slice(0, 80) });
    const t0 = Date.now();
    const system = systemPrompt(orgName);
    const run = provider === "anthropic"
      ? await runAnthropic(apiKey, system, qaHistory, data.question, supabase)
      : await runGemini(apiKey, system, qaHistory, data.question, supabase);
    const toolCalls = run.toolCalls;

    const answer = run.answer
      || "I couldn't work that one out. Please tap \"Talk to Jashan\" below and he'll help you directly.";

    const { error: insErr } = await supabase.from("assistant_messages")
      .insert({ org_id: orgId, user_id: userId, question: data.question, answer });
    if (insErr) log.error("ask:store_failed", { err: insErr.message });

    log.info("ask:done", { orgId, ms: Date.now() - t0, toolCalls });
    return {
      answer,
      aiUsedThisMonth: billing.aiUsedThisMonth + 1,
      aiLimitPerMonth: billing.aiLimitPerMonth,
    };
  });

export const getAssistantHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: mem } = await supabase.from("memberships")
      .select("org_id").eq("user_id", userId).limit(1).maybeSingle();
    if (!mem) return [];
    const { data } = await supabase.from("assistant_messages")
      .select("question, answer, created_at").eq("org_id", mem.org_id)
      .order("created_at", { ascending: false }).limit(20);
    return (data ?? []).reverse();
  });
