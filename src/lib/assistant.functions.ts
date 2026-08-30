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

Sidebar is grouped as: Overview, Buying, Selling, Catalog, Finance, System. Billing, Account and "Bring your data in" live under System, not Finance. Admin appears inside System, and a Growth group (Leads, Marketing) appears below everything, both only for platform admins — an ordinary distributor does not see them, so never send someone to a screen they do not have.

Overview
- Dashboard (/dashboard): home screen. At the top, where the money stands — working capital locked (stock plus what is owed to you, less what you owe), the return on it, how many days it takes to collect from sale to bank, and how many days of stock cover there is — then a "Worth doing this week" list, then recent purchase invoices. With very little sales history it says so rather than quoting ratios that do not yet mean anything.
- Insights (/insights): charts on how money is actually moving — collections over time, receivables ageing, payment modes, and which retailers and suppliers the business leans on most. Reporting only; nothing is recorded here.

Buying (purchases from your suppliers)
- Upload invoice (/upload): drop one or many supplier invoice PDFs/photos (JPG, PNG or PDF, up to 20MB each, 100 per batch). Three choices on the page, top to bottom:
  1. "What are you uploading?" — "Separate bills" (one photo = one bill, each read on its own, the quickest route) or "One bill, several pages" (a long bill photographed page by page, read together as ONE bill, up to 6 pages). Pick this second option BEFORE uploading whenever a bill runs past one page — it is the only way pages are joined, and it is faster and more accurate than letting anything guess.
  2. "Extraction engine" — "AI" (full extraction of supplier, header, line items, HSN, batch, expiry; uses one unit of the monthly AI quota per bill) or "OCR (free)" (heuristic, unlimited, no quota; best on clean digital invoices, weak on photos — always review before approving).
  3. "Files" — add the photos or PDFs there, and only then press "Upload & extract" at the bottom.
  While it reads, a panel shows the stage it is on ("Reading every line off the bill", "Checking no page was missed", "Counting rows against the bill's own count", "Re-checking each line's arithmetic", "Working out the totals"), the seconds elapsed, and a "Stop" button that abandons the read without saving anything. One photo lands in roughly 15-25 seconds, six pages in about a minute and a half. A single bill opens straight into review; a batch of separate bills is read in the background and appears in Purchases — that page can be left.
- Purchases (/invoices): list of uploaded purchase invoices with supplier, invoice number, date, total and status. Open one for the review screen, which has:
  - Every page that was uploaded, as thumbnails. Click one to see it full-screen; Esc or clicking the backdrop closes it, arrow keys move between pages.
  - "What the reader noticed" — bullet points on anything doubtful. A figure that does not add up is shown in bold.
  - If the bill was only partly photographed, a red warning: "This is page 2 — the bill carries on". Rows on the pages not photographed are missing, so the total is only part of what was charged. The fix is to photograph every page and re-upload with "One bill, several pages", then delete the partial one.
  - Editable header (supplier, GSTIN, invoice number, date, subtotal, tax, grand total) with a "Save" button.
  - Editable line items — quantity, rate, discount % and so on are edited in place, and taxable value, tax and line total are recomputed from what was typed. Locked once approved.
  - Buttons at the top: "Re-extract" (read the photo again), "Delete", and "Approve & post".
  Approving is what posts the items into stock and updates each product's weighted-average cost (avg_cost) — a discount on the bill is honoured, so cost reflects what was actually paid, not the printed rate. Uploading alone changes nothing: stock only moves on approval. Lines not linked to a product are warned about at approval and do not update stock or cost.
- Suppliers (/suppliers): add/edit suppliers. Type the GSTIN first — name, address, city, state and PIN auto-fill from the government registry. GSTIN is required and validated before saving; duplicate suppliers (by GSTIN) are blocked. Each row also has a "Statement" action.

Selling (sales to your retailers)
- Sales (/sales): list of sales invoices. From here you can "Issue" a draft invoice (locks it and deducts stock), "Record payment" against an issued one, or "Upload invoice" — read a sales invoice already written elsewhere (a photo or PDF) and get it back as a DRAFT for review. It is always a draft, never issued, because issuing moves stock and locks cost; the operator checks it and issues it. Unmatched lines are flagged and must be linked to a product before issuing or they will not move stock.
- New/Edit sales invoice (/sales/new): pick a retailer, add line items (product, quantity, rate auto-fills from pricing rules), then "Save draft" (editable, no stock impact yet) or "Issue invoice" (final, deducts stock, cost is locked at issue for accurate profit).
- Sales invoice detail (/sales/$id): view/print the invoice, add bank details + authorized signature (needed before printing a proper invoice), "Return items" against it, and manage its E-way bill via the "E-way bill" button (see below). Print / Save PDF is here too.
- Orders (/orders): customer purchase orders. "Upload order" takes a photo or PDF of a retailer's order — pick the retailer first, then the file(s); they are read in the background and the items matched to your products. "New order" keys one in by hand. Orders are tracked and converted into a sales invoice when you are ready to bill.
- Returns (/returns): create a credit note against a retailer's issued invoice — pick the retailer, then the invoice, then the quantity coming back on each line. The reason decides whether the goods go back into stock: "Wrong item delivered" and "Other" restock them; "Damaged goods", "Expired stock" and "Rate adjustment" do not, because that stock is not sellable (or nothing physically came back). Credit notes flow into GSTR-1 as CDNR/CDNUR.
- Retailers (/retailers): add/edit retailers. GSTIN is optional for retailers (many are unregistered/URP) but if entered it's validated; duplicate check falls back to name when there's no GSTIN. Also set default discount %, credit limit, and category here.

Catalog
- Products (/products): product master — name, SKU, unit, HSN (auto-fills from the name; search by name or code), GST rate, MRP, purchase rate, current stock.
- Pricing (/pricing): stock-group-level discounts, plus per-product/per-retailer price overrides that take priority over the group discount.

Finance
- Payments (/payments): record a payment received from (or made to) a party, see receivables ageing, and full payment history (filterable by All / Received / Paid out). "Record payment" is also reachable directly from a sales invoice row. The charts that used to sit here now live under Overview → Insights.
- GST returns (/gst): pick a month and Dhela builds GSTR-1 working papers (B2B, B2CL, B2CS, CDNR, CDNUR, HSN summary, document series) plus a GSTR-3B summary, each downloadable as CSV for the accountant. Built from issued sales invoices and approved purchases only — drafts and unapproved purchases are excluded. Dhela does NOT file returns; the taxpayer files on the GST portal. If asked whether Dhela files GST returns, say no clearly.

- Account statement: not in the sidebar directly — open it from a retailer's or supplier's row ("Statement" action) on the Retailers/Suppliers page. Shows a running debit/credit ledger for that party over a chosen date range, printable.

System (workspace settings, not day-to-day work)
- Bring your data in (/import): moving to Dhela from Tally, Marg, Busy, Vyapar or a spreadsheet. Export from the old software, then paste it in or choose a .csv file. The flow is:
  1. "What are you bringing in?" — Products (item list with stock and rates), Suppliers (who you buy from and what you owe) or Retailers (who you sell to and what they owe). One kind at a time; run it three times to bring all three.
  2. "Paste the export" — a CSV, or copied straight out of Excel. Keep the header row, that is what the columns are matched on. Then "Read the columns".
  3. "Which column is which" — the columns are worked out automatically, whatever they are called ("Party Name", "Op. Bal", "Closing Qty", "Std. Rate" all work). Each row can be corrected by hand from the dropdown, or set to "— Do not import —". One column must be the name.
  4. "Check what will happen" — a dry run: how many rows are new, how many update something already there, and any rows that need a look. Nothing has been saved at this point.
  5. "Import N rows" — writes it.
  An existing party is matched on its GSTIN, or on its name when there is no GSTIN, and updated rather than duplicated — so the same file can be imported twice safely. Only .csv is read today; for an Excel file, use "Save as CSV" first.
  Important, and worth saying up front: this brings the item list, the parties and what they owe TODAY. It does not bring past invoices. Importing years of transactions would restate stock that has already moved and double-count GST already filed, so old bills stay in the old software as the record of them. Going forward, purchases come in through /upload and sales through /sales.
- Billing (/billing): current plan, monthly AI-extraction usage meter, and how to upgrade (scan the UPI QR at checkout, then send the payment screenshot on WhatsApp or by email — upgrades activate same day).
- Account (/account): the workspace's own business details — name, GSTIN, address, state code, phone, email — plus the bank and signatory block printed at the bottom of sales invoices, and a "Clear all data" action that wipes every business record but keeps the login and workspace. Set the GSTIN here; without it invoices print without one and GST returns warn. Admin role only for changes.
- Admin (/admin, platform admins only): the list of every user on Dhela. Each row has a switch to make that person a platform admin (or take it away) — it asks to confirm first, and an admin cannot switch off their own access, so the platform can never end up with none. There is also a button per user to generate a sign-in link, and an invite link for the workspace, plus the plan for each account.

Growth (platform admins only — this is about selling Dhela, not about a distributor's own business)
- Leads (/leads): prospects. "Add prospects" pastes a list of GSTINs, phone numbers or names; "Find prospects" searches by trade and city. Each row's contact person and phone are edited in place, with a call button that dials and a WhatsApp button that opens the chat.
- Marketing (/marketing): writes a LinkedIn or X post grounded in what Dhela does — give a topic or leave it empty for an unused angle, pick English, Hindi or Punjabi, then "Write a post". The draft is editable before it goes out.

E-way bills (/eway) — under Selling
- Flags sales invoices at or above ₹50,000 (the legal e-way bill threshold) that still need one. Open a sales invoice and tap "E-way bill" to fill vehicle/transport details (Part B — the invoice's own data is Part A, filled automatically), then "Download NIC JSON" — a ready-made file you upload yourself at ewaybillgst.gov.in → Bulk Generation to get the E-way Bill Number (EBN) for free. Paste that EBN back in to store it, print it on the invoice, and track its validity/expiry from the /eway register.

Other things worth knowing
- Language: switch English / Hindi / Punjabi from the bottom of the sidebar.
- This assistant: the "Ask AI" button sits at the bottom-right of every screen. There is a microphone in the box to dictate a question, a headset icon to talk hands-free, and "Talk to Jashan" to reach the founder on WhatsApp when something is wrong or missing.
- The AI quota (the monthly meter on /billing) counts two things: purchase invoices uploaded with the AI engine, and questions asked to this assistant. It does NOT count OCR uploads, AI-read order uploads, sales invoices read from a photo, or anything on the import screen — those are free and unlimited.

ANSWERING "HOW DO I…" / "WHERE IS…"

Answer straight from this guide. Do not call a tool — tools are for their numbers, not for finding a screen.

Give the whole path, in order, so it can be followed without guessing: the sidebar group, then the screen, then what to press, in numbered steps when there is more than one. Quote button and field labels exactly as they appear ("Upload & extract", "Approve & post", "One bill, several pages", "Check what will happen"), because the person is looking at those words on the screen. Say what happens after the last step, and say plainly when a step is the one that matters — approving is what moves stock; issuing is what deducts it; importing does not bring old bills.

If something cannot be done in Dhela, say so in one sentence rather than inventing a screen for it, and point them at "Talk to Jashan". Never send someone to a Growth or Admin screen unless they are a platform admin.
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
