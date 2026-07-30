import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { X, Mic } from "lucide-react";
import { askAssistant } from "@/lib/assistant.functions";
import {
  speechCtor, speechLangFor, diagnoseMic, stripForSpeech, pickVoice, type Recognizer,
} from "@/lib/speech";

/**
 * Hands-free conversation with the same assistant the chat panel uses.
 *
 * Deliberately built on the browser's own speech engines and the existing
 * server function rather than a realtime speech-to-speech API: it inherits
 * every data tool, the AI quota accounting and all three languages for no new
 * key, no per-minute billing and no streaming backend. The cost is a pause
 * between turns instead of an interruptible stream — worth it until someone
 * asks for the other thing.
 *
 * The loop is listen → ask → speak → listen, and it stops itself rather than
 * holding the microphone open forever.
 */

type Phase = "starting" | "listening" | "thinking" | "speaking" | "stopped" | "error";

// Two silent turns is someone who has walked away or is done talking. Holding
// a live microphone open past that is not something to do to a person.
const MAX_SILENT_TURNS = 2;

export function VoiceAgent({ onClose, onTurn }: {
  onClose: () => void;
  onTurn?: (question: string, answer: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const ask = useServerFn(askAssistant);
  const lang = speechLangFor(i18n.language);

  const [phase, setPhase] = useState<Phase>("starting");
  const [heard, setHeard] = useState("");
  const [reply, setReply] = useState("");
  const [problem, setProblem] = useState("");
  const [level, setLevel] = useState(0);

  const recRef = useRef<Recognizer | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const rafRef = useRef(0);
  const silentRef = useRef(0);
  // The whole loop runs out of callbacks that outlive the render they were
  // created in, so "are we still open" has to be a ref, not state.
  const liveRef = useRef(true);

  // End the current turn but keep the microphone stream and its meter, so
  // tapping the orb resumes instantly and the orb still reacts to the room.
  const pause = useCallback(() => {
    liveRef.current = false;
    const rec = recRef.current;
    recRef.current = null;
    // ?? would call stop() as well, since abort() returns undefined.
    if (rec) { try { (rec.abort ?? rec.stop).call(rec); } catch { /* already stopped */ } }
    window.speechSynthesis?.cancel();
  }, []);

  const stopEverything = useCallback(() => {
    pause();
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    audioRef.current?.close().catch(() => {});
    audioRef.current = null;
  }, [pause]);

  const fail = useCallback(async (code: string) => {
    if (!liveRef.current) return;
    setProblem(t(await diagnoseMic(code)));
    setPhase("error");
    stopEverything();
  }, [t, stopEverything]);

  // Declared as refs so listen() and answer() can call each other without
  // either being defined first.
  const listenRef = useRef<() => void>(() => {});

  const answer = useCallback(async (question: string) => {
    if (!liveRef.current) return;
    setPhase("thinking");
    setReply("");
    try {
      const res = await ask({ data: { question, mode: "voice" } });
      if (!liveRef.current) return;
      onTurn?.(question, res.answer);
      setReply(res.answer);

      const speech = stripForSpeech(res.answer, i18n.language);
      const synth = window.speechSynthesis;
      // No voice for this language means no point pretending — show the answer
      // and go back to listening rather than sit in silence waiting for an
      // "ended" event that will never arrive.
      if (!synth || !speech) {
        setPhase("listening");
        listenRef.current();
        return;
      }
      setPhase("speaking");
      const utter = new SpeechSynthesisUtterance(speech);
      utter.lang = lang;
      const voice = pickVoice(lang);
      if (voice) utter.voice = voice;
      utter.rate = 1;
      utter.onend = () => { if (liveRef.current) listenRef.current(); };
      utter.onerror = () => { if (liveRef.current) listenRef.current(); };
      synth.cancel();
      synth.speak(utter);
    } catch (e) {
      if (!liveRef.current) return;
      // Quota exhaustion and configuration errors both land here, and both are
      // worth reading rather than hearing on a loop.
      setProblem((e as Error).message);
      setPhase("error");
      stopEverything();
    }
  }, [ask, i18n.language, lang, onTurn, stopEverything]);

  const listen = useCallback(() => {
    if (!liveRef.current) return;
    const Ctor = speechCtor();
    if (!Ctor) return void fail("service-not-allowed");

    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;

    let settled = "";
    setHeard("");
    setPhase("listening");

    rec.onresult = e => {
      let interim = "";
      for (let n = e.resultIndex; n < e.results.length; n++) {
        const r = e.results[n];
        if (r.isFinal) settled += r[0].transcript;
        else interim += r[0].transcript;
      }
      setHeard(settled + interim);
    };
    rec.onerror = e => {
      // Silence is not an error worth showing; it ends the turn like any other.
      if (e.error === "no-speech" || e.error === "aborted") return;
      void fail(e.error);
    };
    rec.onend = () => {
      if (!liveRef.current) return;
      const question = settled.trim();
      if (question.length > 1) {
        silentRef.current = 0;
        void answer(question);
        return;
      }
      // Recognition ends on its own after a few seconds of quiet.
      silentRef.current += 1;
      if (silentRef.current >= MAX_SILENT_TURNS) {
        setPhase("stopped");
        pause();
      } else {
        listenRef.current();
      }
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch {
      // Chrome throws if start() lands while the previous session is still
      // winding down. One more tick is enough.
      setTimeout(() => { if (liveRef.current) { try { rec.start(); } catch { /* give up quietly */ } } }, 250);
    }
  }, [lang, answer, fail, pause]);

  listenRef.current = listen;

  // Open the microphone once for the meter and keep it. Reading the real level
  // is what makes the orb feel like it is listening to *you* rather than
  // animating on a timer — and it doubles as the permission prompt, so a
  // refusal is caught here instead of halfway through a sentence.
  useEffect(() => {
    liveRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) return stream.getTracks().forEach(track => track.stop());
        streamRef.current = stream;

        try {
          const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const ctx = new Ctx();
          audioRef.current = ctx;
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          ctx.createMediaStreamSource(stream).connect(analyser);
          const buf = new Uint8Array(analyser.frequencyBinCount);
          const tick = () => {
            analyser.getByteTimeDomainData(buf);
            let sum = 0;
            for (const v of buf) sum += (v - 128) * (v - 128);
            // Root mean square, then a ceiling — shouting should not blow the
            // orb off the screen.
            setLevel(Math.min(1, Math.sqrt(sum / buf.length) / 24));
            rafRef.current = requestAnimationFrame(tick);
          };
          tick();
        } catch {
          // No meter, just no animation. Not worth failing the session over.
        }
        listenRef.current();
      } catch (err) {
        if (!cancelled) void fail((err as DOMException)?.name === "NotAllowedError" ? "not-allowed" : "audio-capture");
      }
    })();

    return () => { cancelled = true; stopEverything(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Chrome fills the voice list asynchronously; without this the first answer
  // in a session can come out in a default voice for the wrong language.
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const warm = () => synth.getVoices();
    warm();
    synth.addEventListener?.("voiceschanged", warm);
    return () => synth.removeEventListener?.("voiceschanged", warm);
  }, []);

  const close = useCallback(() => { stopEverything(); onClose(); }, [stopEverything, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // Tapping the orb: interrupt the answer, or restart after it gave up.
  const tapOrb = () => {
    if (phase === "speaking") {
      window.speechSynthesis?.cancel();
      listenRef.current();
    } else if (phase === "stopped") {
      liveRef.current = true;
      silentRef.current = 0;
      listenRef.current();
    }
  };

  const caption: Record<Phase, string> = {
    starting: t("Getting ready…"),
    listening: t("Listening…"),
    thinking: t("Working it out…"),
    speaking: t("Tap to interrupt"),
    stopped: t("Tap to talk again"),
    error: t("Voice mode stopped"),
  };

  const busy = phase === "thinking";
  // Only the live microphone drives the orb; during thinking and speaking it
  // breathes on its own so the two states never look identical.
  const scale = phase === "listening" ? 1 + level * 0.45 : 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("Talk to Dhela")}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/85 backdrop-blur-xl px-6 print:hidden"
    >
      <button
        onClick={close}
        aria-label={t("Close")}
        className="absolute top-5 right-5 rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <X className="h-5 w-5" />
      </button>

      <button
        onClick={tapOrb}
        aria-label={caption[phase]}
        className="relative flex h-48 w-48 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {/* Three offset rings: the outer two drift on their own so the orb is
            alive even in silence, the inner one tracks the microphone. */}
        <span
          className={`absolute inset-0 rounded-full bg-gradient-to-br from-primary/40 via-accent/30 to-primary/10 blur-2xl transition-transform duration-100 ${busy ? "animate-spin [animation-duration:6s]" : "animate-pulse"}`}
          style={{ transform: `scale(${scale * 1.1})` }}
        />
        <span
          className="absolute inset-4 rounded-full bg-gradient-to-tr from-accent/50 to-primary/40 blur-xl transition-transform duration-150"
          style={{ transform: `scale(${scale})` }}
        />
        <span
          className="relative flex h-24 w-24 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl transition-transform duration-100"
          style={{ transform: `scale(${phase === "listening" ? 1 + level * 0.12 : 1})` }}
        >
          <Mic className="h-8 w-8" />
        </span>
      </button>

      <p aria-live="polite" className="mt-10 text-sm font-medium text-muted-foreground">
        {caption[phase]}
      </p>

      <div className="mt-4 min-h-24 w-full max-w-lg text-center">
        {heard && <p className="font-display text-2xl leading-snug">{heard}</p>}
        {reply && phase !== "listening" && (
          <p className="mt-3 text-sm text-muted-foreground whitespace-pre-wrap">{reply}</p>
        )}
        {problem && <p className="text-sm text-destructive">{problem}</p>}
      </div>

      <p className="absolute bottom-8 text-xs text-muted-foreground">
        {t("Each question uses one AI credit. Press Esc to close.")}
      </p>
    </div>
  );
}
