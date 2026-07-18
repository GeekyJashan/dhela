import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createLogger } from "./logger";
import { TOOL_DECLARATIONS, executeTool } from "./assistant-tools";
import { getOrgBilling } from "./billing.functions";

const log = createLogger("assistant.functions");

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const MAX_TOOL_ROUNDS = 8;

type Part = Record<string, unknown>;
type Content = { role: string; parts: Part[] };

function systemPrompt(orgName: string) {
  const today = new Date().toISOString().slice(0, 10);
  return `You are Ledgerly Assistant, the built-in business analyst for "${orgName}", an Indian distributor using the Ledgerly app. Today is ${today}.

Rules:
- Answer questions about invoices, retailers, suppliers, products, stock, orders, payments, statements and profit using ONLY the provided tools. Every number you state must come from a tool result — never estimate or invent figures.
- Call as many tools as needed before answering. For date-range questions, compute the range yourself (e.g. "last month", "this week") from today's date.
- Profit = taxable value minus recorded cost of goods; GST is excluded from profit. If a product has no recorded purchase cost, its profit is overstated — mention that when relevant.
- Currency is INR. Format amounts in the Indian style, e.g. ₹1,23,456.78.
- Reply in the SAME language the user asked in (English, Hindi or Punjabi).
- Be concise: lead with the direct answer, then a short breakdown if useful. Plain text only — no markdown symbols like ** or #. Use "•" for lists.
- If you spot a discrepancy in the data (totals that don't add up, unpaid amounts that look wrong), state it plainly.
- If you cannot answer confidently, if data is missing, or the user asks for a feature Ledgerly doesn't have: say so honestly and add that they can tap "Talk to Jashan" below to reach Jashan Sehgal, the founder, for help or feature requests. Never bluff.`;
}

async function callGemini(apiKey: string, system: string, contents: Content[]) {
  const resp = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
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

export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ question: z.string().min(2).max(2000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("Assistant is not configured (GOOGLE_API_KEY missing on the server)");

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

    const contents: Content[] = [];
    for (const h of (history ?? []).reverse()) {
      contents.push({ role: "user", parts: [{ text: h.question }] });
      contents.push({ role: "model", parts: [{ text: h.answer }] });
    }
    contents.push({ role: "user", parts: [{ text: data.question }] });

    log.info("ask:start", { orgId, q: data.question.slice(0, 80) });
    const t0 = Date.now();
    let toolCalls = 0;
    let content = await callGemini(apiKey, systemPrompt(orgName), contents);

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const calls = content.parts.filter(p => (p as { functionCall?: unknown }).functionCall) as
        { functionCall: { name: string; args?: Record<string, unknown> } }[];
      if (!calls.length) break;

      contents.push(content);
      const responses: Part[] = [];
      for (const c of calls) {
        toolCalls++;
        let result: unknown;
        try {
          result = await executeTool(supabase, c.functionCall.name, c.functionCall.args ?? {});
        } catch (e) {
          result = { error: (e as Error).message };
        }
        responses.push({
          functionResponse: { name: c.functionCall.name, response: { result } },
        });
      }
      contents.push({ role: "user", parts: responses });
      content = await callGemini(apiKey, systemPrompt(orgName), contents);
    }

    const answer = content.parts
      .map(p => (p as { text?: string }).text ?? "")
      .join("").trim()
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
