import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { X, Mic } from "lucide-react";
import { createLiveSession, runAssistantTool, storeLiveTurn } from "@/lib/live.functions";
import { LiveConversation, type LiveState } from "@/lib/live-session";
import { diagnoseMic } from "@/lib/speech";
import { Markdown } from "@/components/markdown";

/**
 * Realtime voice: one socket, audio in and audio out, both streaming.
 *
 * Replaces a four-stage pipeline whose slowest stage was a synthesis endpoint
 * that would not stream — measured, ten to sixteen seconds before the first
 * word. Here the model hears and speaks natively, so the first word arrives in
 * about a second and it can be interrupted mid-sentence.
 *
 * If the socket cannot be opened at all — no billing, an unsupported browser,
 * a blocked network — the caller falls back to the old pipeline rather than
 * leaving the user with nothing.
 */

export function VoiceAgentLive({ onClose, onTurn, onUnavailable }: {
  onClose: () => void;
  onTurn?: (question: string, answer: string) => void;
  onUnavailable?: (reason: string) => void;
}) {
  const { t } = useTranslation();
  const mint = useServerFn(createLiveSession);
  const runTool = useServerFn(runAssistantTool);
  const storeTurn = useServerFn(storeLiveTurn);

  const [state, setState] = useState<LiveState>("connecting");
  const [heard, setHeard] = useState("");
  const [said, setSaid] = useState("");
  const [problem, setProblem] = useState("");
  const [level, setLevel] = useState(0);

  const convoRef = useRef<LiveConversation | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef(0);
  const liveRef = useRef(true);
  // Callbacks fire for the life of the socket, long after the render that
  // created them, so these have to be refs.
  const onTurnRef = useRef(onTurn);
  onTurnRef.current = onTurn;
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;

  const teardown = useCallback(() => {
    liveRef.current = false;
    cancelAnimationFrame(rafRef.current);
    convoRef.current?.close();
    convoRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
  }, []);

  useEffect(() => {
    liveRef.current = true;
    let cancelled = false;

    (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // Echo cancellation is not optional here: without it the assistant
          // hears itself through the speakers and interrupts its own answer.
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (err) {
        if (cancelled) return;
        setProblem(t(await diagnoseMic((err as DOMException)?.name === "NotAllowedError" ? "not-allowed" : "audio-capture")));
        setState("error");
        return;
      }
      if (cancelled) return stream.getTracks().forEach(track => track.stop());
      streamRef.current = stream;

      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      ctxRef.current = ctx;
      // Autoplay policy can hand back a suspended context even after a tap.
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});

      // Level meter for the orb, from the same stream the socket is using.
      try {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += (v - 128) * (v - 128);
          setLevel(Math.min(1, Math.sqrt(sum / buf.length) / 24));
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch { /* no meter, just a still orb */ }

      const convo = new LiveConversation(
        {
          mint: () => mint({ data: undefined }) as Promise<{ token: string; model: string }>,
          runTool: async (name, args) => {
            const res = await runTool({ data: { name, args } });
            return JSON.parse(res.json);
          },
          stream,
          audioContext: ctx,
        },
        {
          onState: s => { if (liveRef.current) setState(s); },
          onHeard: (text, final) => {
            if (!liveRef.current) return;
            setHeard(text);
            // Clear the previous answer once a new question is underway, so
            // the screen never shows a reply to a question that has moved on.
            if (!final) setSaid("");
          },
          onSaid: text => { if (liveRef.current) setSaid(text); },
          onTurn: (q, a) => {
            onTurnRef.current?.(q, a);
            // Fire and forget: losing a transcript is not worth interrupting
            // a conversation that is still going.
            storeTurn({ data: { question: q, answer: a } }).catch(() => {});
          },
          onError: message => {
            if (!liveRef.current) return;
            setProblem(message);
            setState("error");
          },
        },
      );
      convoRef.current = convo;

      try {
        await convo.start();
      } catch (err) {
        if (!liveRef.current) return;
        // Quota, billing, a blocked socket — all reasons to hand back to the
        // pipeline that still works rather than show a dead orb.
        onUnavailableRef.current?.((err as Error)?.message ?? "Live voice unavailable");
      }
    })();

    return () => { cancelled = true; teardown(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = useCallback(() => { teardown(); onClose(); }, [teardown, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const caption: Record<LiveState, string> = {
    connecting: t("Connecting…"),
    listening: t("Listening — just talk"),
    thinking: t("Checking your data…"),
    speaking: t("Tap to interrupt"),
    closed: t("Voice mode ended"),
    error: t("Voice mode stopped"),
  };

  const busy = state === "thinking" || state === "connecting";
  const scale = state === "listening" ? 1 + level * 0.45 : 1;

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
        onClick={() => convoRef.current?.interrupt()}
        aria-label={caption[state]}
        className="relative flex h-48 w-48 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
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
          style={{ transform: `scale(${state === "listening" ? 1 + level * 0.12 : 1})` }}
        >
          <Mic className="h-8 w-8" />
        </span>
      </button>

      <p aria-live="polite" className="mt-10 text-sm font-medium text-muted-foreground">
        {caption[state]}
      </p>

      <div className="mt-4 min-h-24 w-full max-w-lg text-center">
        {heard && <p className="font-display text-2xl leading-snug">{heard}</p>}
        {said && (
          <div className="mt-3 text-sm text-muted-foreground text-left">
            <Markdown text={said} />
          </div>
        )}
        {problem && <p className="text-sm text-destructive">{problem}</p>}
      </div>

      <p className="absolute bottom-8 text-xs text-muted-foreground">
        {t("Speak naturally — you can interrupt. Press Esc to close.")}
      </p>
    </div>
  );
}
