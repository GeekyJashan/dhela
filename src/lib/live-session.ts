import { GoogleGenAI, Modality, type Session } from "@google/genai";
import { INPUT_RATE, OUTPUT_RATE, PcmPlayer, decodePcm, startCapture } from "./live-audio";
import { LIVE_IDLE_TIMEOUT_SECONDS as IDLE_TIMEOUT_SECONDS } from "./plans";

/**
 * One realtime conversation: socket, microphone, speaker and tool bridge.
 *
 * Kept out of the component because almost none of it is React — it is a state
 * machine over a WebSocket that happens to report progress to a UI. The
 * component decides what to draw; this decides what is true.
 */

export type LiveState = "connecting" | "listening" | "thinking" | "speaking" | "closed" | "error";

export type LiveHandlers = {
  onState: (state: LiveState) => void;
  /** Interim then final transcript of what the user said. */
  onHeard: (text: string, final: boolean) => void;
  /** Accumulated transcript of what the assistant is saying. */
  onSaid: (text: string) => void;
  /** A completed exchange, for storing alongside the typed conversation. */
  onTurn: (question: string, answer: string) => void;
  onError: (message: string) => void;
};

export type LiveSessionDeps = {
  mint: () => Promise<{ token: string; model: string; sessionId: string | null; maxSeconds: number }>;
  /** Reports the session's real duration so the month's meter is accurate. */
  reportEnd: (sessionId: string, seconds: number) => void;
  runTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  stream: MediaStream;
  audioContext: AudioContext;
};

export class LiveConversation {
  private session: Session | null = null;
  private player: PcmPlayer | null = null;
  private stopCapture: (() => void) | null = null;
  private closed = false;

  private heard = "";
  private said = "";
  private sessionId: string | null = null;
  private startedAt = 0;
  private hardStop = 0;
  private idleTimer = 0;
  /** Raised when the session ends itself rather than being closed by the user. */
  onExpired: ((reason: "idle" | "limit") => void) | null = null;

  constructor(private deps: LiveSessionDeps, private on: LiveHandlers) {}

  async start() {
    this.on.onState("connecting");
    const { token, model, sessionId, maxSeconds } = await this.deps.mint();
    this.sessionId = sessionId;
    this.startedAt = Date.now();

    // The session is billed by the minute for as long as it is open, so it
    // closes itself. Two ceilings: one for a conversation that runs long, one
    // for a tab someone walked away from. Neither is the user's job to notice.
    this.hardStop = window.setTimeout(() => {
      this.onExpired?.("limit");
      this.close();
    }, maxSeconds * 1000);
    this.touch();

    // Ephemeral token in place of the API key, on v1alpha — the only
    // combination the service accepts. The real key stays on the server.
    const client = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } });

    this.player = new PcmPlayer(this.deps.audioContext);
    this.player.onIdle = () => {
      if (!this.closed) this.on.onState("listening");
    };

    this.session = await client.live.connect({
      model,
      // Model, prompt, voice and tools are pinned into the token; anything
      // sent here would be ignored, so nothing is.
      config: { responseModalities: [Modality.AUDIO] },
      callbacks: {
        onopen: () => {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onmessage: (message: any) => void this.handle(message),
        onerror: (e: unknown) => {
          if (this.closed) return;
          this.on.onError((e as Error)?.message ?? "Voice connection failed");
          this.on.onState("error");
        },
        onclose: () => {
          if (!this.closed) this.on.onState("closed");
        },
      },
    });

    this.stopCapture = await startCapture(this.deps.audioContext, this.deps.stream, base64 => {
      if (this.closed) return;
      try {
        this.session?.sendRealtimeInput({ audio: { data: base64, mimeType: `audio/pcm;rate=${INPUT_RATE}` } });
      } catch {
        // A frame lost during teardown is not worth surfacing.
      }
    });

    this.on.onState("listening");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handle(message: any) {
    if (this.closed) return;

    // The model decided the user started talking over it. Everything already
    // queued is now stale — playing it would be the assistant talking across
    // someone mid-sentence.
    if (message.serverContent?.interrupted) {
      this.player?.stop();
      this.said = "";
      this.on.onState("listening");
      return;
    }

    if (message.toolCall?.functionCalls?.length) {
      this.on.onState("thinking");
      const responses = [];
      for (const call of message.toolCall.functionCalls) {
        let result: unknown;
        try {
          result = await this.deps.runTool(call.name, (call.args ?? {}) as Record<string, unknown>);
        } catch (e) {
          // Handed back as data rather than thrown: the model can say "I
          // couldn't read that" far better than a dead socket can.
          result = { error: (e as Error).message };
        }
        responses.push({ id: call.id, name: call.name, response: { result } });
      }
      if (!this.closed) this.session?.sendToolResponse({ functionResponses: responses });
      return;
    }

    const content = message.serverContent;
    if (!content) return;

    if (content.inputTranscription?.text) {
      this.touch();
      this.heard += content.inputTranscription.text;
      this.on.onHeard(this.heard, false);
    }
    if (content.outputTranscription?.text) {
      this.said += content.outputTranscription.text;
      this.on.onSaid(this.said);
    }

    for (const part of content.modelTurn?.parts ?? []) {
      const inline = part.inlineData;
      if (inline?.data && String(inline.mimeType ?? "").includes("audio")) {
        this.touch();
        this.player?.enqueue(decodePcm(inline.data));
        this.on.onState("speaking");
      }
    }

    if (content.turnComplete) {
      const question = this.heard.trim();
      const answer = this.said.trim();
      if (question && answer) this.on.onTurn(question, answer);
      if (question) this.on.onHeard(question, true);
      this.heard = "";
      this.said = "";
      // Not "listening" yet — the queue is usually still draining, and
      // PcmPlayer.onIdle is what actually knows when it stops talking.
      if (!this.player?.playing) this.on.onState("listening");
    }
  }

  /** Restart the silence countdown; called whenever anyone actually speaks. */
  private touch() {
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      this.onExpired?.("idle");
      this.close();
    }, IDLE_TIMEOUT_SECONDS * 1000);
  }

  /** Stop the assistant mid-answer without ending the conversation. */
  interrupt() {
    this.player?.stop();
    this.on.onState("listening");
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.hardStop);
    clearTimeout(this.idleTimer);
    if (this.sessionId && this.startedAt) {
      this.deps.reportEnd(this.sessionId, Math.round((Date.now() - this.startedAt) / 1000));
      this.sessionId = null;
    }
    this.stopCapture?.();
    this.stopCapture = null;
    this.player?.close();
    this.player = null;
    try { this.session?.close(); } catch { /* already gone */ }
    this.session = null;
  }
}

export { OUTPUT_RATE };
