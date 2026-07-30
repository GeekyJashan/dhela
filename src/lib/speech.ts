/**
 * Browser speech plumbing shared by dictation and the conversational mode.
 *
 * Everything here is feature-detected rather than assumed: support is uneven
 * across Chrome, Safari, Brave and the Android/iOS webviews distributors
 * actually use, and a header can switch the microphone off for the whole
 * document regardless of what the browser supports.
 */

// BCP-47 tags as Chrome's speech service lists them; Punjabi needs the script
// subtag or recognition rejects the language outright.
export const SPEECH_LANG: Record<string, string> = { en: "en-IN", hi: "hi-IN", pa: "pa-Guru-IN" };

export const speechLangFor = (code: string | undefined) =>
  SPEECH_LANG[(code ?? "en").split("-")[0]] ?? "en-IN";

export type Recognizer = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult:
    | ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};

export type SpeechCtor = new () => Recognizer;

export const speechCtor = (): SpeechCtor | undefined => {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

/**
 * Whether the document is even permitted a microphone.
 *
 * A Permissions-Policy header can switch the feature off for the whole page,
 * and when it does the browser reports the same "not-allowed" that a denied
 * prompt gives — so the app tells the user to check permissions they cannot
 * change and the real cause never surfaces. This shipped that way: the header
 * carried microphone=(), whose empty allowlist blocks our own origin too.
 * Non-Chromium browsers don't expose the object, so absence means "no reason
 * to think otherwise", not "blocked".
 */
export const micPolicyAllows = (): boolean => {
  if (typeof document === "undefined") return true;
  const policy = (document as { featurePolicy?: { allowsFeature?: (f: string) => boolean } }).featurePolicy;
  return policy?.allowsFeature ? policy.allowsFeature("microphone") : true;
};

/** Can this browser, on this page, take voice input at all? */
export const voiceInputAvailable = () => !!speechCtor() && micPolicyAllows();

/**
 * Work out why speech input failed, and say something the user can act on.
 *
 * SpeechRecognition's own error codes are close to useless: "not-allowed"
 * covers a denied prompt, a page that isn't on https, a document the header
 * blocked, and a browser whose speech backend is unavailable, while
 * "service-not-allowed" usually means the microphone is perfectly fine and the
 * *service* refused — telling someone to grant mic access there sends them
 * round a loop that can never work.
 *
 * So on failure we ask for the microphone directly, which returns a real
 * DOMException name, and diagnose from that. Only runs after an error, so the
 * working path never pays for it and never loses its user gesture.
 */
export async function diagnoseMic(code: string): Promise<string> {
  // Chrome strips microphone access on insecure origins and reports it as a
  // flat "not-allowed" — which reads as "you denied this" when in fact the
  // page is simply on http. Hits anyone opening the dev server by LAN IP.
  if (!window.isSecureContext) {
    return "Voice input only works over a secure (https) connection.";
  }
  // Nothing the user can do about this one, so say so rather than sending
  // them into browser settings that will not help.
  if (!micPolicyAllows()) {
    return "Voice input is switched off for this site, not by your device.";
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return "This browser won't let the page use a microphone.";
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Release it straight away, or the tab keeps showing as recording.
    stream.getTracks().forEach(track => track.stop());
    // Getting here means the microphone is fine and we're allowed to use it.
    // If recognition had said "not-allowed", the prompt we just showed is what
    // fixed it — dismissing Chrome's permission bubble reports as a denial, so
    // this is the common first-run case. Ask for another tap rather than
    // sending them into browser settings for a permission they now have.
    if (code === "not-allowed") return "Microphone allowed. Tap the mic again to start.";
    if (code === "network") return "Voice input needs an internet connection.";
    // Otherwise the speech backend is what refused: Brave and other Chromium
    // builds ship without Google's speech keys, and Safari needs Dictation on.
    return "This browser couldn't reach a speech service. Chrome or Edge handles voice best.";
  } catch (err) {
    switch ((err as DOMException)?.name) {
      case "NotAllowedError":
      case "SecurityError":
        return "Microphone blocked. Allow mic access for this site in your browser settings, then try again.";
      case "NotFoundError":
      case "OverconstrainedError":
        return "No microphone found on this device.";
      case "NotReadableError":
        return "Another app is using the microphone. Close it and try again.";
      default:
        return "Couldn't start voice input.";
    }
  }
}

const RUPEES: Record<string, string> = { en: "rupees", hi: "रुपये", pa: "ਰੁਪਏ" };

/**
 * Turn an assistant answer into something worth hearing.
 *
 * The answers are markdown now, and a speech engine reads markdown literally —
 * "star star one lakh forty two thousand star star". Tables are worse: read
 * cell by cell they become a stream of pipes and dashes with no structure at
 * all. So tables collapse into "label, value" phrases, list markers become
 * sentence breaks so the voice actually pauses, and the rupee sign is spelled
 * out because engines either skip it or name it inconsistently.
 */
export function stripForSpeech(markdown: string, lang = "en"): string {
  const rupees = RUPEES[lang.split("-")[0]] ?? RUPEES.en;

  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Table rule rows carry no words.
    if (/^\|?[\s:|-]*-[\s:|-]*$/.test(line) && line.includes("-") && line.includes("|")) continue;

    let text = line;
    if (text.includes("|")) {
      text = text.replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim()).filter(Boolean).join(", ");
    }
    text = text
      .replace(/^#{1,6}\s*/, "")
      .replace(/^[-*•]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .replace(/\*\*|__|`/g, "")
      .replace(/(^|\s)[*_]([^*_\n]+)[*_]/g, "$1$2");

    if (text) out.push(/[.!?:,]$/.test(text) ? text : `${text}.`);
  }

  return out
    .join(" ")
    // Digits, grouping commas and at most one decimal fraction. A looser class
    // swallows the sentence's full stop into the number, and "98,000. rupees"
    // is read with the pause in the wrong place.
    .replace(/₹\s*(\d[\d,]*(?:\.\d+)?)/g, `$1 ${rupees}`)
    .replace(/₹/g, ` ${rupees} `)
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Best available voice for a language, or undefined to let the engine choose.
 *
 * Engines ship wildly different voices under the same language tag, and the
 * first match is usually the worst one — the flat robotic default most people
 * mean when they say text-to-speech "sounds monotone". Ranking matters more
 * than matching: the cloud voices (Google's, and Apple's Enhanced/Premium
 * downloads) are a different class from the compact local fallbacks.
 *
 * Chrome populates getVoices() asynchronously, so callers must wait for
 * voiceschanged at least once before trusting an empty list.
 */
export function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  if (typeof window === "undefined" || !window.speechSynthesis) return undefined;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return undefined;

  const want = lang.toLowerCase();
  const base = want.split("-")[0];
  const candidates = voices.filter(v => {
    const l = v.lang.toLowerCase().replace("_", "-");
    return l === want || l.startsWith(`${base}-`) || l === base;
  });
  if (!candidates.length) return undefined;

  const score = (v: SpeechSynthesisVoice) => {
    const name = v.name.toLowerCase();
    let s = 0;
    // Exact region beats a same-language voice from elsewhere: an en-IN voice
    // says "lakh" and Indian names far better than en-US.
    if (v.lang.toLowerCase().replace("_", "-") === want) s += 40;
    // Cloud voices carry real prosody; the compact local ones are the flat
    // ones. Apple's downloads are local but explicitly labelled.
    if (!v.localService) s += 30;
    if (/google/.test(name)) s += 25;
    if (/natural|neural|enhanced|premium|siri/.test(name)) s += 20;
    if (/compact|espeak/.test(name)) s -= 30;
    if (v.default) s += 5;
    return s;
  };

  return [...candidates].sort((a, b) => score(b) - score(a))[0];
}

/**
 * Break an answer into speakable chunks.
 *
 * Two reasons. Chrome stops speaking after roughly fifteen seconds of a single
 * utterance — a long answer just cuts off mid-word — and separate utterances
 * give the engine a clean sentence to shape each time, which is most of the
 * difference between a delivery that sounds read and one that sounds recited.
 */
export function splitForSpeech(text: string, max = 180): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (sentence.length > max) {
      // One very long sentence: break it at commas rather than mid-word.
      if (current) { chunks.push(current); current = ""; }
      let rest = sentence;
      while (rest.length > max) {
        const cut = rest.lastIndexOf(",", max);
        const at = cut > max / 2 ? cut + 1 : max;
        chunks.push(rest.slice(0, at).trim());
        rest = rest.slice(at).trim();
      }
      if (rest) current = rest;
      continue;
    }
    if ((`${current} ${sentence}`).trim().length > max) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}

/** Whether anything can actually read this language aloud. */
export const canSpeak = (lang: string) =>
  typeof window !== "undefined" && !!window.speechSynthesis && !!pickVoice(lang);
