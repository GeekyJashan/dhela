import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createLogger } from "./logger";
import { TOOL_DECLARATIONS, executeTool } from "./assistant-tools";
import { getOrgBilling } from "./billing.functions";
import { aiProvider, anthropicModel, geminiModel, toAnthropicTools } from "./ai-provider";
import { bedrockConverse, bedrockConfigured, bedrockModel, type ConverseMessage } from "./bedrock";

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

/**
 * Appended for the hands-free mode. A markdown table read aloud is a stream of
 * pipes and dashes, and "star star" in the middle of a number is worse than no
 * emphasis at all — so voice answers are shaped for the ear, not the eye.
 */
const VOICE_RULES = `
This answer will be spoken aloud, not read:
- Reply in one to three short sentences. No markdown, no tables, no bullet points, no headings, no symbols.
- Say figures the way a person would: "four lakh eighty two thousand rupees", not "₹4,82,310.00".
- Lead with the single number or fact they asked for. Offer the breakdown only if they ask for it.
- If the answer really is a long list, say the top two or three and mention how many others there are.`;

export function systemPrompt(orgName: string, mode: "text" | "voice" = "text") {
  const today = new Date().toISOString().slice(0, 10);
  return `You are Dhela Assistant, the built-in business analyst and product guide for "${orgName}", an Indian distributor using the Dhela app. Today is ${today}.
${PLATFORM_GUIDE}
Rules:
- Two kinds of questions: (1) data/numbers about their business — invoices, retailers, suppliers, products, stock, orders, payments, statements, profit — answer these using ONLY the provided tools, every number must come from a tool result, never estimate or invent figures; (2) "how do I…" / "where is…" navigation questions about using the app — answer these directly from the platform guide above, no tool call needed. If a question mixes both, do both.
- Call as many tools as needed before answering a data question. For date-range questions, compute the range yourself (e.g. "last month", "this week") from today's date.
- If a tool can fetch what they asked for, call it. Never answer a data question by telling them to go and open a page and look — you have their data, so use it. Naming a page is only for "how do I…" questions.
- "What did I buy from <supplier>" is purchases_summary with supplier_query. "What is on bill <number>" is get_purchase_invoice for a supplier bill or get_sales_invoice for one you issued.
- Open questions about the business — "how are we doing", "how was this month", "what should I focus on", "where am I losing money", "is everything okay" — are business_health. It returns the working capital tied up, the return on it, days to collect, stock cover, margin, and a ranked list of problems with the rupees at stake and the rows behind each one.

WHEN SOMEONE ASKS HOW THE BUSINESS IS DOING

Talk to them like their accountant would over tea, not like a report. Three beats, in this order:

1. Where it stands. One or two sentences with the numbers that matter — what is tied up, what is coming in, what it is earning. Say what the number means, not what it is called: "your money is taking about 40 days to come back from retailers" rather than "DSO is 40". Never use the words DSO, working capital ratio, ROI or turnover unless they used them first.
2. What is stuck. Lead with the single biggest rupee problem, name the products or retailers, and say plainly why it matters. "₹1,20,000 is sitting in four items nobody has bought since May — that is money you could be buying stock that moves with."
3. What to do first. One concrete action, the one worth the most. If a second is nearly as valuable, mention it and stop. Three suggestions is a list; one is a decision.

Say the good parts too, briefly, when they are true — an owner who only ever hears problems stops asking. If the business is genuinely fine, say so and say why.

If the tool says there is not enough history to judge a ratio, do not quote that ratio at all and do not estimate one. Say what you can see and what you would need to say more.

ANY OTHER STATISTIC THEY ASK FOR

Combine tools freely and do the arithmetic yourself from tool results — comparisons between periods, per-retailer or per-product breakdowns, averages, shares, growth, best and worst. Work out the date ranges from today's date without asking. If a figure genuinely cannot be built from these tools, say which part is missing rather than approximating it. Every number in the answer must trace to a tool result.
- Profit = taxable value minus recorded cost of goods; GST is excluded from profit. If a product has no recorded purchase cost, its profit is overstated — mention that when relevant.
- Currency is INR. Format amounts in the Indian style, e.g. ₹1,23,456.78.
- Reply in the SAME language the user asked in (English, Hindi or Punjabi).
- Be concise: lead with the direct answer, then a short breakdown if useful. The answer is rendered as markdown, so use it lightly: **bold** for the headline number, "-" bullets, and a pipe table when comparing rows (keep tables to 3 columns — they are read in a narrow panel on a phone). No headings, no code fences, no links.
- If you spot a discrepancy in the data (totals that don't add up, unpaid amounts that look wrong), state it plainly.
- If you cannot answer confidently, if data is missing, or the user asks for a feature Dhela doesn't have: say so honestly and add that they can tap "Talk to Jashan" below to reach Jashan Sehgal, the founder, for help or feature requests. Never bluff.${mode === "voice" ? VOICE_RULES : ""}`;
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


/**
 * Bedrock agentic loop, same tools and same contract as the other two.
 *
 * Tried first when it is configured, and allowed to fail: every error here is
 * caught by the caller and the question is re-run on the existing provider.
 * A second front door is only worth having if it cannot lock the first one.
 */
async function runBedrock(
  system: string, history: QA[], question: string, db: Db,
): Promise<{ answer: string; toolCalls: number }> {
  const tools = toAnthropicTools(TOOL_DECLARATIONS);
  const messages: ConverseMessage[] = [];
  for (const h of history) {
    messages.push({ role: "user", content: [{ text: h.question }] });
    messages.push({ role: "assistant", content: [{ text: h.answer }] });
  }
  messages.push({ role: "user", content: [{ text: question }] });

  let toolCalls = 0;
  let answer = "";
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const resp = await bedrockConverse({ system, messages, tools });
    answer = resp.text || answer;

    if (!resp.toolUses.length) break;

    // Converse requires the assistant turn to be replayed verbatim, tool
    // blocks included, before the results can be attached to it.
    messages.push({
      role: "assistant",
      content: [
        ...(resp.text ? [{ text: resp.text }] : []),
        ...resp.toolUses.map(t => ({ toolUse: { toolUseId: t.id, name: t.name, input: t.input } })),
      ],
    });

    const results = [];
    for (const use of resp.toolUses) {
      toolCalls++;
      let result: unknown;
      try { result = await executeTool(db, use.name, use.input ?? {}); }
      catch (e) { result = { error: (e as Error).message }; }
      results.push({
        toolResult: {
          toolUseId: use.id,
          // json, not text: Converse keeps the structure, so the model reads
          // figures as numbers rather than re-parsing a string.
          content: [{ json: result as Record<string, unknown> }],
          status: "success",
        },
      });
    }
    messages.push({ role: "user", content: results });
  }
  return { answer, toolCalls };
}

export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      question: z.string().min(2).max(2000),
      // Hands-free mode asks for the same answer shaped to be heard.
      mode: z.enum(["text", "voice"]).optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const provider = aiProvider();
    const apiKey = provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.GOOGLE_API_KEY;
    // Either route is enough to answer. Refusing when only one is present
    // would make adding Bedrock a way to break a working install.
    if (!apiKey && !bedrockConfigured()) {
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
    const system = systemPrompt(orgName, data.mode ?? "text");
    // Bedrock first when it is configured, with the existing provider as the
    // safety net. Credentials, model access, throttling and regional outages
    // are all things that go wrong on someone else's schedule, and none of
    // them should turn into a failed question for a distributor.
    let run: { answer: string; toolCalls: number } | null = null;
    if (bedrockConfigured()) {
      const t = Date.now();
      try {
        run = await runBedrock(system, qaHistory, data.question, supabase);
        log.info("ask:bedrock", { model: bedrockModel(), ms: Date.now() - t });
      } catch (e) {
        log.error("ask:bedrock_failed", { model: bedrockModel(), err: (e as Error).message.slice(0, 200) });
      }
    }
    if (!run) {
      if (!apiKey) throw new Error("Assistant is unavailable: Bedrock failed and no fallback provider is configured.");
      run = provider === "anthropic"
        ? await runAnthropic(apiKey, system, qaHistory, data.question, supabase)
        : await runGemini(apiKey, system, qaHistory, data.question, supabase);
    }
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
