/**
 * Pre-render the assistant's "hold on" lines to audio files.
 *
 * Voice answers take a few seconds to think and another six to synthesise, and
 * dead air reads as a hang. These clips cover that gap — but only if they are
 * instant, so they are generated once here and committed, not synthesised at
 * request time (which would cost exactly the six seconds they exist to hide).
 *
 *   npm run fillers          # generate anything missing
 *   npm run fillers -- --force   # redo everything, e.g. after a voice change
 *
 * Same model and voice as the live answers, so the filler and the answer are
 * one continuous speaker rather than two.
 *
 * The Hindi and Punjabi lines are in the feminine ("देख रही हूँ"), matching
 * Kore. Switching GEMINI_TTS_VOICE to a male voice means rewriting them and
 * regenerating — the grammar carries gender even though the English doesn't.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "public", "speech");

function env(name) {
  const file = path.join(root, ".env");
  if (!fs.existsSync(file)) return process.env[name];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && line.slice(0, i).trim() === name) {
      return line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
  return process.env[name];
}

const KEY = env("GOOGLE_API_KEY");
const MODEL = env("GEMINI_TTS_MODEL") ?? "gemini-2.5-flash-preview-tts";
const VOICE = env("GEMINI_TTS_VOICE") ?? "Kore";
if (!KEY) throw new Error("GOOGLE_API_KEY missing — needed to render the filler clips");

/**
 * Kept short and non-committal on purpose. They have to be true whatever the
 * question turned out to be, and they must end cleanly so the real answer can
 * follow without a seam.
 */
const LINES = {
  en: [
    "One moment, I'm looking through your data.",
    "Let me check your books.",
    "Just pulling that up now.",
  ],
  hi: [
    "एक मिनट, मैं आपका डेटा देख रही हूँ।",
    "ज़रा रुकिए, आपके हिसाब में देख रही हूँ।",
    "बस अभी निकाल कर बताती हूँ।",
  ],
  pa: [
    "ਇੱਕ ਮਿੰਟ, ਮੈਂ ਤੁਹਾਡਾ ਡਾਟਾ ਵੇਖ ਰਹੀ ਹਾਂ।",
    "ਜ਼ਰਾ ਰੁਕੋ, ਤੁਹਾਡੇ ਹਿਸਾਬ ਵਿੱਚ ਵੇਖ ਰਹੀ ਹਾਂ।",
    "ਬਸ ਹੁਣੇ ਕੱਢ ਕੇ ਦੱਸਦੀ ਹਾਂ।",
  ],
};

/** Raw L16 PCM in a WAV container — mirrors src/lib/wav.ts. */
function pcmToWav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function synth(text) {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
        },
      }),
    },
  );
  if (!resp.ok) throw new Error(`${resp.status} ${(await resp.text()).slice(0, 160)}`);
  const json = await resp.json();
  const inline = json.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!inline?.data) throw new Error(`no audio (finish: ${json.candidates?.[0]?.finishReason})`);
  const rate = Number(/rate=(\d+)/.exec(inline.mimeType ?? "")?.[1]) || 24000;
  return pcmToWav(Buffer.from(inline.data, "base64"), rate);
}

const force = process.argv.includes("--force");
fs.mkdirSync(outDir, { recursive: true });

let made = 0, kept = 0, total = 0, blocked = false;
const manifest = {};

for (const [lang, lines] of Object.entries(LINES)) {
  for (const [n, text] of lines.entries()) {
    const name = `${lang}-${n + 1}.wav`;
    const file = path.join(outDir, name);

    if (fs.existsSync(file) && !force) {
      kept++; total += fs.statSync(file).size;
      (manifest[lang] ??= []).push(name);
      continue;
    }
    if (blocked) continue;

    try {
      const wav = await synth(text);
      fs.writeFileSync(file, wav);
      made++; total += wav.length;
      (manifest[lang] ??= []).push(name);
      console.log(`  ${name}  ${(wav.length / 1024).toFixed(0)}KB  ${(wav.length / 48000).toFixed(1)}s  "${text}"`);
    } catch (err) {
      // The free tier allows ten TTS requests a day, per model. Stopping at the
      // first refusal keeps the manifest honest — it lists what actually
      // exists — and rerunning tomorrow picks up exactly where this left off.
      if (String(err.message).startsWith("429")) {
        console.error(`\n  quota exhausted at ${name}. Rerun \`npm run fillers\` to continue;`);
        console.error("  already-rendered clips are kept and skipped.");
        blocked = true;
        continue;
      }
      throw err;
    }
  }
}

// The client reads this rather than probing for files, so a half-rendered set
// degrades to "no filler for that language" instead of a 404 per turn.
fs.writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const want = Object.values(LINES).flat().length;
const have = Object.values(manifest).flat().length;
console.log(`\n${made} rendered, ${kept} kept — ${have}/${want} clips, ${(total / 1024).toFixed(0)}KB in public/speech`);
if (have < want) process.exitCode = 1;
