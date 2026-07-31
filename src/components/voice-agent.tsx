import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { X, Mic } from "lucide-react";
import { askAssistant } from "@/lib/assistant.functions";
import { synthesizeSpeech } from "@/lib/tts.functions";
import {
  speechCtor, speechLangFor, diagnoseMic, stripForSpeech, splitForSpeech, pickVoice, type Recognizer,
} from "@/lib/speech";
import { Markdown } from "@/components/markdown";

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

// "preparing" is its own state because server speech takes a few seconds to
// come back: saying "tap to interrupt" while nothing is playing is a lie,
// and showing nothing looks like a hang.
type Phase = "starting" | "listening" | "thinking" | "preparing" | "speaking" | "stopped" | "error";

// Two silent turns is someone who has walked away or is done talking. Holding
// a live microphone open past that is not something to do to a person.
const MAX_SILENT_TURNS = 2;

// Server speech is billed per character and each chunk is its own request, so
// a long answer is capped rather than fanned out. Voice answers are asked to
// be one to three sentences anyway; this is the guard, not the plan.
const MAX_TTS_CHUNKS = 4;

// Below this, the whole answer goes in one request instead of one per
// sentence. Voice answers are asked to be one to three sentences, so in
// practice almost everything takes this path.
const SINGLE_REQUEST_LIMIT = 420;

/**
 * Play synthesised chunks strictly in order, starting as soon as the first
 * one lands rather than waiting for all of them.
 *
 * Returns false the moment any chunk failed to synthesise, so the caller can
 * fall back to the browser voice for the whole answer instead of leaving a
 * hole in the middle of a sentence.
 */
async function playInOrder(
  pending: Promise<string | null>[],
  elRef: { current: HTMLAudioElement | null },
  liveRef: { current: boolean },
  onStart: () => Promise<void> | void,
): Promise<boolean> {
  for (const promise of pending) {
    const base64 = await promise;
    if (!liveRef.current) return true;   // closed mid-answer: nothing to fall back to
    if (!base64) return false;

    const audio = new Audio(`data:audio/wav;base64,${base64}`);
    elRef.current = audio;
    // Awaited: this is where the holding phrase is allowed to finish its
    // sentence, so the answer follows it instead of cutting across it.
    await onStart();
    if (!liveRef.current) return true;
    const finished = await new Promise<boolean>(resolve => {
      audio.onended = () => resolve(true);
      // Autoplay refusal lands here. It shouldn't — the session began with a
      // tap — but a browser that blocks it must not stall the loop.
      audio.onerror = () => resolve(false);
      audio.play().catch(() => resolve(false));
    });
    elRef.current = null;
    if (!liveRef.current) return true;
    if (!finished) return false;
  }
  return true;
}

export function VoiceAgent({ onClose, onTurn }: {
  onClose: () => void;
  onTurn?: (question: string, answer: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const ask = useServerFn(askAssistant);
  const speakServer = useServerFn(synthesizeSpeech);
  const lang = speechLangFor(i18n.language);

  const [phase, setPhase] = useState<Phase>("starting");
  const [heard, setHeard] = useState("");
  const [reply, setReply] = useState("");
  const [problem, setProblem] = useState("");
  const [level, setLevel] = useState(0);

  const recRef = useRef<Recognizer | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const fillerElRef = useRef<HTMLAudioElement | null>(null);
  const fillerUrlsRef = useRef<string[]>([]);
  const fillerStopRef = useRef(true);
  const rafRef = useRef(0);
  const silentRef = useRef(0);
  // The whole loop runs out of callbacks that outlive the render they were
  // created in, so "are we still open" has to be a ref, not state.
  const liveRef = useRef(true);

  /**
   * Holding phrases — "एक मिनट, मैं आपका डेटा देख रही हूँ" — played while the
   * agent reads the data and the answer is synthesised.
   *
   * Pre-rendered at build time in the same voice as the answers, because
   * synthesising them on demand would cost the very seconds they exist to
   * cover. They loop until the answer is ready rather than playing once, since
   * a tool-heavy question can take longer than any single clip.
   */
  const startFillers = useCallback(() => {
    const urls = fillerUrlsRef.current;
    if (!urls.length) return;
    fillerStopRef.current = false;
    let n = Math.floor(Math.random() * urls.length);

    const playNext = () => {
      if (fillerStopRef.current || !liveRef.current) return;
      const audio = new Audio(urls[n % urls.length]);
      n += 1;
      fillerElRef.current = audio;
      const done = () => { fillerElRef.current = null; playNext(); };
      audio.onended = done;
      audio.onerror = () => { fillerElRef.current = null; };
      audio.play().catch(() => { fillerElRef.current = null; });
    };
    playNext();
  }, []);

  /** Stop looping and let the clip that is mid-sentence finish. */
  const stopFillers = useCallback(
    () =>
      new Promise<void>(resolve => {
        fillerStopRef.current = true;
        const audio = fillerElRef.current;
        if (!audio) return resolve();
        const done = () => { fillerElRef.current = null; resolve(); };
        audio.onended = done;
        audio.onerror = done;
        // No clip is this long. If one somehow stalls, the answer still goes.
        setTimeout(() => { audio.pause(); done(); }, 5000);
      }),
    [],
  );

  const killFillers = useCallback(() => {
    fillerStopRef.current = true;
    const audio = fillerElRef.current;
    fillerElRef.current = null;
    if (audio) { audio.pause(); audio.src = ""; }
  }, []);

  // Only the current language's clips, and only the ones that exist — the
  // manifest is written by the generator, so a language whose clips were never
  // rendered simply has no holding phrase rather than a 404 every turn.
  useEffect(() => {
    const code = (i18n.language ?? "en").split("-")[0];
    let cancelled = false;
    fetch("/speech/manifest.json")
      .then(r => (r.ok ? r.json() : {}))
      .then((m: Record<string, string[]>) => {
        if (cancelled) return;
        const files = m[code] ?? [];
        fillerUrlsRef.current = files.map(f => `/speech/${f}`);
        // Warm the cache now, while the user is still being listened to.
        for (const url of fillerUrlsRef.current) {
          const a = new Audio();
          a.preload = "auto";
          a.src = url;
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [i18n.language]);

  // End the current turn but keep the microphone stream and its meter, so
  // tapping the orb resumes instantly and the orb still reacts to the room.
  const pause = useCallback(() => {
    liveRef.current = false;
    killFillers();
    const rec = recRef.current;
    recRef.current = null;
    // ?? would call stop() as well, since abort() returns undefined.
    if (rec) { try { (rec.abort ?? rec.stop).call(rec); } catch { /* already stopped */ } }
    window.speechSynthesis?.cancel();
    const audio = audioElRef.current;
    audioElRef.current = null;
    if (audio) { audio.pause(); audio.src = ""; }
  }, [killFillers]);

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
    startFillers();
    try {
      const res = await ask({ data: { question, mode: "voice" } });
      if (!liveRef.current) return;
      onTurn?.(question, res.answer);
      setReply(res.answer);

      const speech = stripForSpeech(res.answer, i18n.language);
      const synth = window.speechSynthesis;
      // Nothing worth saying — go back to listening rather than wait on an
      // "ended" event that will never arrive. A missing speechSynthesis is no
      // longer fatal: the server voice does not need it.
      if (!speech) {
        killFillers();
        setPhase("listening");
        listenRef.current();
        return;
      }
      const chunks = splitForSpeech(speech);
      synth?.cancel();
      setPhase("preparing");

      // Gemini's voice reads Devanagari and code-switched Hinglish properly,
      // which the browser's local voices do not.
      //
      // One request for the whole answer when it fits. Splitting it would let
      // playback start a couple of seconds sooner, but every chunk is a
      // separate billed request against a per-day cap, and a three-sentence
      // answer costing three requests is how a day's quota disappears in four
      // questions. Long answers still split, because the cap is per request.
      const wanted = speech.length <= SINGLE_REQUEST_LIMIT ? [speech] : chunks.slice(0, MAX_TTS_CHUNKS);
      const pending = wanted.map(chunk =>
        speakServer({ data: { text: chunk } }).then(r => r.audio).catch(() => null),
      );
      const played = await playInOrder(pending, audioElRef, liveRef, async () => {
        await stopFillers();
        setPhase("speaking");
      });
      if (!liveRef.current) return;
      if (played) { listenRef.current(); return; }

      // Server speech failed — the browser's own voice is worse but it is
      // there, and silence would look like the app had hung.
      if (!synth) { await stopFillers(); listenRef.current(); return; }
      await stopFillers();
      setPhase("speaking");
      const voice = pickVoice(lang);
      chunks.forEach((chunk, n) => {
        const utter = new SpeechSynthesisUtterance(chunk);
        utter.lang = lang;
        if (voice) utter.voice = voice;
        // A touch under natural pace: the headline of an answer is a number,
        // and numbers are what people mishear.
        utter.rate = 0.96;
        utter.pitch = 1;
        if (n === chunks.length - 1) {
          utter.onend = () => { if (liveRef.current) listenRef.current(); };
          utter.onerror = () => { if (liveRef.current) listenRef.current(); };
        }
        synth.speak(utter);
      });
    } catch (e) {
      if (!liveRef.current) return;
      // Quota exhaustion and configuration errors both land here, and both are
      // worth reading rather than hearing on a loop.
      setProblem((e as Error).message);
      setPhase("error");
      stopEverything();
    }
  }, [ask, speakServer, i18n.language, lang, onTurn, stopEverything, startFillers, stopFillers, killFillers]);

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
    if (phase === "speaking" || phase === "preparing") {
      window.speechSynthesis?.cancel();
      const audio = audioElRef.current;
      audioElRef.current = null;
      if (audio) { audio.pause(); audio.src = ""; }
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
    preparing: t("Reading it out…"),
    speaking: t("Tap to interrupt"),
    stopped: t("Tap to talk again"),
    error: t("Voice mode stopped"),
  };

  const busy = phase === "thinking" || phase === "preparing";
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
        {/* Rendered, not printed: the models still emit markdown here now and
            then despite being asked for speech, and raw ** on screen is the
            one thing worse than a table nobody can hear. */}
        {reply && phase !== "listening" && (
          <div className="mt-3 text-sm text-muted-foreground text-left">
            <Markdown text={reply} />
          </div>
        )}
        {problem && <p className="text-sm text-destructive">{problem}</p>}
      </div>

      <p className="absolute bottom-8 text-xs text-muted-foreground">
        {t("Each question uses one AI credit. Press Esc to close.")}
      </p>
    </div>
  );
}
