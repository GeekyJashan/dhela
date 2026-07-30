import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLogger } from "@/lib/logger";
import { pcmToWav, rateFromMime } from "@/lib/wav";

/**
 * Server-side speech synthesis for the hands-free assistant.
 *
 * The browser's own speechSynthesis reads Hindi with whatever voice the OS
 * happens to ship, which on most machines is a flat compact one — good enough
 * to be understood, not good enough to listen to. Gemini's TTS models handle
 * Devanagari and code-switched Hinglish in one pass, which matters because
 * these answers genuinely mix scripts: "Anand Enterprises से दो बिल".
 *
 * It runs on the server because the key must not reach a browser, and behind
 * the auth middleware because an unauthenticated synthesis endpoint is an open
 * bill on someone else's account.
 *
 * The trade, measured rather than assumed: ~6s to generate a one-sentence
 * answer, and streamGenerateContent gives no head start — the first chunk
 * arrives with the last. The client asks for sentences in parallel and plays
 * them in order so the wait is one chunk's, not the whole answer's.
 */

const log = createLogger("tts");

const MODEL = process.env.GEMINI_TTS_MODEL ?? "gemini-2.5-flash-preview-tts";
// Prebuilt Gemini voice. Kore is warm and even-paced across both scripts;
// Charon is male, Leda lighter. Swap with GEMINI_TTS_VOICE.
const VOICE = process.env.GEMINI_TTS_VOICE ?? "Kore";

export const synthesizeSpeech = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      // Capped hard: this is billed per character, and a runaway client should
      // cost a sentence rather than a novel.
      text: z.string().min(1).max(600),
    }).parse(d))
  .handler(async ({ data }) => {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("Speech is not configured (GOOGLE_API_KEY missing on the server)");

    const t0 = Date.now();
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: data.text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
          },
        }),
      },
    );

    if (!resp.ok) {
      const body = (await resp.text()).slice(0, 200);
      log.error("tts:http", { status: resp.status, body });
      throw new Error(`Speech service error ${resp.status}`);
    }

    const json = await resp.json();
    const inline = json.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!inline?.data) {
      // A safety stop or an empty candidate lands here. The caller falls back
      // to the browser voice rather than going silent.
      log.error("tts:no_audio", { finish: json.candidates?.[0]?.finishReason ?? null });
      throw new Error("Speech service returned no audio");
    }

    const pcm = Buffer.from(inline.data, "base64");
    const wav = pcmToWav(pcm, rateFromMime(inline.mimeType));

    log.info("tts:done", { ms: Date.now() - t0, chars: data.text.length, kb: Math.round(wav.length / 1024) });
    return { audio: wav.toString("base64"), mime: "audio/wav" };
  });
