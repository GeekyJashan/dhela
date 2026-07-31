import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { GoogleGenAI, Modality, type FunctionDeclaration } from "@google/genai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLogger } from "./logger";
import { TOOL_DECLARATIONS, executeTool } from "./assistant-tools";
import { systemPrompt } from "./assistant.functions";
import { getOrgBilling } from "./billing.functions";
import { PLANS, firstOfMonthISO, LIVE_MAX_SESSION_SECONDS } from "./plans";

/**
 * Loose handle for voice_sessions. integrations/supabase/types.ts is generated
 * from the live schema and does not know this table until someone regenerates
 * it, so the query builder would reject the name outright.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };
const loose = (client: unknown) => client as Db;

/**
 * Realtime voice: session tokens and the tool bridge.
 *
 * The old voice mode was four sequential round trips — wait for silence,
 * think, synthesise the whole answer, then play — and the synthesis alone was
 * six seconds because that endpoint does not stream. Measured end to end it
 * was ten to sixteen seconds before the first word.
 *
 * The Live API replaces all four with one socket: audio in, audio out, both
 * streaming, with barge-in. Measured on this project's key, first audio landed
 * 2.3s after a cold connect including a tool call, and setup is once per
 * session rather than per turn.
 *
 * The browser holds the socket, because the audio has to get there somehow and
 * neither Vercel's functions nor a cold-starting Render dyno can sit in the
 * middle of a realtime stream. So the API key never goes to the browser at
 * all: this mints a short-lived, single-use token with the model, the system
 * prompt and the tool list already pinned into it, and the browser can only
 * use it for that exact session shape.
 */

const log = createLogger("live");

// Native-audio model: it hears and speaks directly rather than wrapping a text
// model in speech, which is what removes the synthesis wait.
const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL ?? "gemini-3.1-flash-live-preview";
const LIVE_VOICE = process.env.GEMINI_TTS_VOICE ?? "Kore";

// Long enough to open the socket on a slow phone, short enough that a leaked
// token is worthless. The session itself outlives the token once connected.
const TOKEN_TTL_MS = 5 * 60_000;
const SESSION_START_TTL_MS = 2 * 60_000;

/**
 * How many seconds of realtime voice this workspace has used this month.
 *
 * Sessions that never reported a duration count at their own cap. A tab closed
 * with the laptop lid never sends its "ended" call, and if that read as zero
 * the meter would be trivially avoidable by never closing cleanly.
 */
async function secondsUsedThisMonth(supabase: Db, orgId: string): Promise<number> {
  const { data, error } = await loose(supabase).from("voice_sessions")
    .select("seconds, max_seconds")
    .eq("org_id", orgId)
    .gte("started_at", `${firstOfMonthISO()}T00:00:00Z`);

  // Failing closed on purpose. An unreadable meter on a per-minute API is not
  // a reason to hand out unmetered minutes.
  if (error) throw new Error(`Voice usage is unavailable (${error.message})`);

  return (data ?? []).reduce(
    (total: number, row: { seconds: number | null; max_seconds: number | null }) =>
      total + (row.seconds ?? row.max_seconds ?? LIVE_MAX_SESSION_SECONDS),
    0,
  );
}

export const createLiveSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("Voice is not configured (GOOGLE_API_KEY missing on the server)");

    const { data: mem } = await supabase.from("memberships")
      .select("org_id, organization:organizations(name)")
      .eq("user_id", userId).limit(1).maybeSingle();
    if (!mem) throw new Error("No organization");
    const orgId = mem.org_id as string;
    const orgName = (mem.organization as { name?: string } | null)?.name ?? "your business";

    // The gate lives here rather than in the component. The UI hides the
    // feature for other plans, but hiding is presentation — this is the part
    // that stops a crafted request from opening a billed socket.
    const billing = await getOrgBilling(supabase, orgId);
    const allowanceSeconds = PLANS[billing.plan].liveVoiceMinutesPerMonth * 60;
    if (allowanceSeconds <= 0) {
      throw new Error("LIVE_NOT_ON_PLAN");
    }

    const used = await secondsUsedThisMonth(supabase, orgId);
    if (used >= allowanceSeconds) {
      throw new Error("LIVE_ALLOWANCE_SPENT");
    }

    // Never mint more than what is left, so the last session of the month
    // cannot overshoot the allowance by a full cap.
    const maxSeconds = Math.min(LIVE_MAX_SESSION_SECONDS, allowanceSeconds - used);

    const ai = new GoogleGenAI({ apiKey });
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
        newSessionExpireTime: new Date(Date.now() + SESSION_START_TTL_MS).toISOString(),
        // Everything the browser could otherwise tamper with is fixed here:
        // which model, which voice, the system prompt, and — the one that
        // matters — the exact list of tools it may ask us to run.
        liveConnectConstraints: {
          model: LIVE_MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: LIVE_VOICE } } },
            systemInstruction: { parts: [{ text: systemPrompt(orgName, "voice") }] },
            // TOOL_DECLARATIONS is `as const` for the text assistant; the SDK wants
            // a mutable array of the same shape.
            tools: [{ functionDeclarations: TOOL_DECLARATIONS as unknown as FunctionDeclaration[] }],
            // Both sides transcribed so the overlay can show the conversation,
            // and so a turn can be stored like any other.
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        },
        httpOptions: { apiVersion: "v1alpha" },
      },
    });

    // Written before the socket opens, so a session that fails halfway is
    // still on the meter — the API bills from connect, not from first word.
    const { data: session } = await loose(supabase).from("voice_sessions")
      .insert({ org_id: orgId, user_id: userId, max_seconds: maxSeconds, model: LIVE_MODEL })
      .select("id").single();

    log.info("live:token", { orgId, usedSeconds: used, maxSeconds });
    return {
      token: token.name as string,
      model: LIVE_MODEL,
      sessionId: (session?.id as string) ?? null,
      maxSeconds,
      remainingSeconds: allowanceSeconds - used,
    };
  });

/**
 * Run one tool for a live session.
 *
 * The model asks the browser, the browser asks this, and this runs the query
 * under the caller's own Supabase session — so a live conversation reads
 * exactly the rows the typed assistant would, no more. The name is checked
 * against the declared list rather than passed through: the pinned token makes
 * an unknown name unlikely, but "unlikely" is not an access control.
 */
export const runAssistantTool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      name: z.string().min(1).max(64),
      args: z.record(z.string(), z.unknown()).default({}),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const known = TOOL_DECLARATIONS.some(t => t.name === data.name);
    if (!known) {
      log.error("live:unknown_tool", { name: data.name });
      return { json: JSON.stringify({ error: `Unknown tool ${data.name}` }) };
    }
    const t0 = Date.now();
    const result = await executeTool(context.supabase, data.name, data.args as Record<string, unknown>);
    log.info("live:tool", { name: data.name, ms: Date.now() - t0 });
    // Returned as a JSON string rather than a shaped object: tool results are
    // heterogeneous by design, and this is going straight back into the model
    // as JSON anyway.
    return { json: JSON.stringify(result ?? null) };
  });

/**
 * Record a spoken exchange in the same table the typed conversation uses, so
 * a question asked out loud is still there in the chat panel afterwards.
 * Transcripts, not audio — nothing about the recording is kept.
 */
export const storeLiveTurn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      question: z.string().min(1).max(2000),
      answer: z.string().min(1).max(8000),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: mem } = await supabase.from("memberships")
      .select("org_id").eq("user_id", userId).limit(1).maybeSingle();
    if (!mem) return { stored: false };

    const { error } = await supabase.from("assistant_messages").insert({
      org_id: mem.org_id as string, user_id: userId,
      question: data.question, answer: data.answer,
    });
    if (error) log.error("live:store_failed", { err: error.message });
    return { stored: !error };
  });

/**
 * Close the meter on a session.
 *
 * Client-reported, which is worth being honest about: a user could under-report
 * their own usage. The cost of that is bounded by max_seconds, since an
 * unreported session already counts at its cap — so the worst a bad actor
 * achieves is being billed accurately instead of generously.
 */
export const endLiveSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      sessionId: z.string().uuid(),
      seconds: z.number().int().min(0).max(LIVE_MAX_SESSION_SECONDS),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await loose(context.supabase).from("voice_sessions")
      .update({ seconds: data.seconds, ended_at: new Date().toISOString() })
      .eq("id", data.sessionId)
      .is("seconds", null);        // first report wins; no rewriting history
    if (error) log.error("live:end_failed", { err: error.message });
    return { ok: !error };
  });

/** Minutes left this month, for the UI to show before it opens a session. */
export const liveVoiceAllowance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: mem } = await supabase.from("memberships")
      .select("org_id").eq("user_id", userId).limit(1).maybeSingle();
    if (!mem) return { plan: "free", allowedMinutes: 0, remainingMinutes: 0 };

    const orgId = mem.org_id as string;
    const billing = await getOrgBilling(supabase, orgId);
    const allowedMinutes = PLANS[billing.plan].liveVoiceMinutesPerMonth;
    if (allowedMinutes <= 0) return { plan: billing.plan, allowedMinutes: 0, remainingMinutes: 0 };

    let used = 0;
    try {
      used = await secondsUsedThisMonth(supabase, orgId);
    } catch {
      // Only a display value here; the real gate is in createLiveSession.
      return { plan: billing.plan, allowedMinutes, remainingMinutes: 0 };
    }
    return {
      plan: billing.plan,
      allowedMinutes,
      remainingMinutes: Math.max(0, Math.floor((allowedMinutes * 60 - used) / 60)),
    };
  });
