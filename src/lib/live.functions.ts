import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { GoogleGenAI, Modality, type FunctionDeclaration } from "@google/genai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLogger } from "./logger";
import { TOOL_DECLARATIONS, executeTool } from "./assistant-tools";
import { systemPrompt } from "./assistant.functions";

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
    const orgName = (mem.organization as { name?: string } | null)?.name ?? "your business";

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

    log.info("live:token", { orgName });
    return { token: token.name as string, model: LIVE_MODEL };
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
