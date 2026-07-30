import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { askAssistant, getAssistantHistory } from "@/lib/assistant.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { X, Send, Loader2, PhoneCall, Mic, Square } from "lucide-react";
import { DhelaCoin } from "@/components/logo";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Markdown } from "@/components/markdown";

type Msg = { role: "user" | "assistant"; text: string };

import { whatsappLink } from "@/lib/support";

const founderLink = (text: string) => whatsappLink(text);

/**
 * Shown one after another while a question is in flight. The server function
 * returns only the final answer — there is no progress stream — so these are
 * timed, not measured. They are worded to describe what the agent loop really
 * does (it calls data tools before answering) and they stop on the last one
 * rather than cycling, because a status that loops back to the beginning reads
 * as "stuck" to anyone watching.
 */
const THINKING = [
  "Understanding your question…",
  "Reading your data…",
  "Crunching the numbers…",
  "Checking the figures…",
  "Writing it up…",
];

// BCP-47 tags as Chrome's speech service lists them; Punjabi needs the script
// subtag or recognition rejects the language outright.
const SPEECH_LANG: Record<string, string> = { en: "en-IN", hi: "hi-IN", pa: "pa-Guru-IN" };

type Recognizer = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechCtor = new () => Recognizer;

const speechCtor = (): SpeechCtor | undefined => {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

/**
 * Whether the document is even permitted a microphone.
 *
 * A Permissions-Policy header can switch the feature off for the whole page,
 * and when it does, the browser reports the same "not-allowed" that a denied
 * prompt gives — so the app tells the user to check permissions they cannot
 * change and the real cause never surfaces. This shipped that way: the header
 * carried microphone=(), whose empty allowlist blocks our own origin too.
 * Non-Chromium browsers don't expose the object, so absence means "no reason
 * to think otherwise", not "blocked".
 */
const micPolicyAllows = (): boolean => {
  if (typeof document === "undefined") return true;
  const policy = (document as { featurePolicy?: { allowsFeature?: (f: string) => boolean } }).featurePolicy;
  return policy?.allowsFeature ? policy.allowsFeature("microphone") : true;
};

/**
 * Work out why dictation failed, and say something the user can act on.
 *
 * SpeechRecognition's own error codes are close to useless: "not-allowed"
 * covers a denied prompt, a page that isn't on https, and a browser whose
 * speech backend is unavailable, while "service-not-allowed" usually means the
 * microphone is perfectly fine and the *service* refused — telling someone to
 * grant mic access there sends them round a loop that can never work.
 *
 * So on failure we ask for the microphone directly, which returns a real
 * DOMException name, and diagnose from that. Only runs after an error, so the
 * working path never pays for it and never loses its user gesture.
 */
async function diagnoseMic(code: string): Promise<string> {
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

export function Assistant() {
  const { t, i18n } = useTranslation();
  const ask = useServerFn(askAssistant);
  const fetchHistory = useServerFn(getAssistantHistory);

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null);
  const [phase, setPhase] = useState(0);
  const [listening, setListening] = useState(false);
  const [micAvailable, setMicAvailable] = useState(false);
  const loadedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<Recognizer | null>(null);

  // Feature-detected after mount, not during render: the server has no
  // window, and guessing wrong either way is a hydration mismatch.
  // A button that can only ever fail is worse than no button, so the policy
  // check gates it too.
  useEffect(() => setMicAvailable(!!speechCtor() && micPolicyAllows()), []);

  useEffect(() => {
    if (!busy) { setPhase(0); return; }
    const id = setInterval(() => setPhase(p => Math.min(p + 1, THINKING.length - 1)), 2200);
    return () => clearInterval(id);
  }, [busy]);

  useEffect(() => {
    if (!open || loadedRef.current) return;
    loadedRef.current = true;
    fetchHistory().then(history => {
      const msgs: Msg[] = [];
      for (const h of history as { question: string; answer: string }[]) {
        msgs.push({ role: "user", text: h.question });
        msgs.push({ role: "assistant", text: h.answer });
      }
      setMessages(msgs);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy, open]);

  // Dictation. Distributors type Hindi and Punjabi on an English keyboard or
  // not at all, so speaking the question is often the only realistic input.
  const toggleMic = () => {
    if (listening) { recRef.current?.stop(); return; }
    const Ctor = speechCtor();
    if (!Ctor) return;

    const rec = new Ctor();
    rec.lang = SPEECH_LANG[i18n.language?.split("-")[0] ?? "en"] ?? "en-IN";
    rec.interimResults = true;
    rec.continuous = false;

    // Dictation appends to whatever is already typed rather than replacing it,
    // and the interim text is rewritten in place until the phrase is final.
    const base = input.trim() ? `${input.trim()} ` : "";
    let settled = "";
    rec.onresult = e => {
      let interim = "";
      for (let n = e.resultIndex; n < e.results.length; n++) {
        const r = e.results[n];
        if (r.isFinal) settled += r[0].transcript;
        else interim += r[0].transcript;
      }
      setInput(base + settled + interim);
    };
    // Some browsers expose SpeechRecognition and then do nothing at all with
    // it — Playwright's Chromium fires no start, no error and no end, ever.
    // Without this the button sits on "listening" indefinitely and there is no
    // event to hang a message off.
    const watchdog = window.setTimeout(() => {
      rec.stop();
      setListening(false);
      toast.error(t("This browser couldn't reach a speech service. Chrome or Edge handles voice best."));
    }, 6000);
    rec.onstart = () => clearTimeout(watchdog);

    rec.onerror = e => {
      clearTimeout(watchdog);
      setListening(false);
      // Saying nothing when someone taps the mic and stays quiet is correct;
      // "aborted" is what our own stop() raises.
      if (e.error === "no-speech" || e.error === "aborted") return;

      if (e.error === "language-not-supported" || e.error === "bad-grammar") {
        toast.error(t("Your browser can't transcribe this language yet."));
        return;
      }
      // Leaves a breadcrumb for anyone debugging a report of "mic doesn't
      // work" — the raw code is the one thing the message deliberately hides.
      console.warn("[assistant] speech recognition error:", e.error);
      diagnoseMic(e.error).then(msg => toast.error(t(msg)));
    };
    rec.onend = () => { clearTimeout(watchdog); setListening(false); };

    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  };

  // Leaving a recogniser running after the panel closes keeps the tab's mic
  // indicator lit.
  useEffect(() => () => recRef.current?.stop(), []);
  useEffect(() => { if (!open && listening) recRef.current?.stop(); }, [open, listening]);

  const send = async (q?: string) => {
    if (listening) recRef.current?.stop();
    const question = (q ?? input).trim();
    if (!question || busy) return;
    setInput("");
    setMessages(m => [...m, { role: "user", text: question }]);
    setBusy(true);
    try {
      const res = await ask({ data: { question } });
      setMessages(m => [...m, { role: "assistant", text: res.answer }]);
      setUsage({ used: res.aiUsedThisMonth, limit: res.aiLimitPerMonth });
    } catch (e) {
      setMessages(m => [...m, { role: "assistant", text: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  };

  const callLink = founderLink(t("Hi Jashan! I'm using Dhela and would like to talk."));

  const suggestions = [
    t("How much do retailers owe me right now?"),
    t("Profit this month, product by product?"),
    t("Which invoices are unpaid for more than 30 days?"),
    t("How do I generate an e-way bill?"),
  ];

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="dhela-logo fixed bottom-5 right-5 z-40 h-13 rounded-full bg-primary text-primary-foreground shadow-lg px-4 py-3 flex items-center gap-2 hover:opacity-90 transition print:hidden"
        title={t("Ask Dhela Assistant")}
      >
        <DhelaCoin size={20} />
        <span className="text-sm font-medium">{t("Ask AI")}</span>
      </button>
    );
  }

  return (
    <div
      role="region"
      aria-label={t("Dhela Assistant")}
      className="fixed bottom-5 right-5 z-40 w-[380px] max-w-[calc(100vw-2rem)] h-[600px] max-h-[calc(100vh-3rem)] bg-background border rounded-xl shadow-2xl flex flex-col print:hidden"
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <DhelaCoin size={18} />
        <div className="flex-1">
          <div className="text-sm font-semibold leading-none">{t("Dhela Assistant")}</div>
          {usage && (
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {t("{{n}} AI questions/extractions left this month", { n: Math.max(0, usage.limit - usage.used) })}
            </div>
          )}
        </div>
        <a href={callLink} target="_blank" rel="noreferrer"
          className="text-xs text-primary inline-flex items-center gap-1 hover:underline">
          <PhoneCall className="h-3 w-3" /> {t("Talk to Jashan")}
        </a>
        <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground ml-1">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {!messages.length && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("Ask anything about your invoices, retailers, products, orders or profit — answers come straight from your own data. Stuck on how to do something in the app? Ask that too.")}
            </p>
            {suggestions.map(s => (
              <button key={s} onClick={() => send(s)}
                className="block w-full text-left text-sm border rounded-lg px-3 py-2 hover:bg-muted/60 transition">
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={
              m.role === "user"
                ? "bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-3 py-2 text-sm max-w-[85%] whitespace-pre-wrap"
                : "bg-muted rounded-2xl rounded-bl-sm px-3 py-2 text-sm max-w-[90%]"
            }>
              {m.role === "user" ? m.text : <Markdown text={m.text} />}
              {m.role === "assistant" && i === messages.length - 1 && !busy && (
                <div className="mt-2 pt-2 border-t border-border/60">
                  <a
                    href={founderLink(t("Hi Jashan! About my Dhela question: \"{{q}}\" — the answer didn't look right / I have a feature request.", { q: messages[i - 1]?.text?.slice(0, 150) ?? "" }))}
                    target="_blank" rel="noreferrer"
                    className="text-[11px] text-muted-foreground hover:text-primary hover:underline"
                  >
                    {t("Wrong answer or missing feature? Talk to Jashan →")}
                  </a>
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            {/* Keyed on the phase so the text fades in on each change instead
                of swapping abruptly under a spinner that never stops. */}
            <span key={phase} className="animate-in fade-in duration-500">{t(THINKING[phase])}</span>
          </div>
        )}
      </div>

      <div className="p-3 border-t flex gap-2 items-end">
        <Textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder={listening ? t("Listening…") : t("e.g. Profit on iphone from 1 July to today?")}
          rows={1}
          className="min-h-[40px] max-h-28 resize-none text-sm"
        />
        {micAvailable && (
          <Button
            size="icon"
            variant={listening ? "destructive" : "outline"}
            onClick={toggleMic}
            disabled={busy}
            aria-pressed={listening}
            title={listening ? t("Stop dictating") : t("Ask by voice")}
          >
            {listening ? <Square className="h-3.5 w-3.5 fill-current" /> : <Mic className="h-4 w-4" />}
          </Button>
        )}
        <Button size="icon" onClick={() => send()} disabled={busy || !input.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
