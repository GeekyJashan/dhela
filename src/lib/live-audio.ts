/**
 * Audio plumbing for the realtime voice session.
 *
 * Two jobs, both fiddly enough to keep away from the component:
 *
 *  - Capture: the Live API wants signed 16-bit PCM at 16 kHz, and browsers
 *    hand you Float32 at whatever the device runs (usually 48 kHz). So every
 *    frame is resampled and requantised before it goes out.
 *  - Playback: it replies with 24 kHz PCM in chunks that arrive faster than
 *    they play. Each is scheduled against a running cursor rather than played
 *    on arrival, because "play when it lands" leaves audible seams between
 *    chunks of the same sentence.
 */

export const INPUT_RATE = 16000;
export const OUTPUT_RATE = 24000;

/** Base64 → Int16 samples, without a round trip through a string per sample. */
export function decodePcm(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
}

function encodeBase64(bytes: Uint8Array): string {
  let s = "";
  // Chunked: String.fromCharCode(...bytes) on a whole frame overflows the
  // argument limit and throws on longer buffers.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/**
 * Float32 at the device rate → base64 Int16 at 16 kHz.
 * Linear interpolation is enough here: this is speech heading for a
 * recogniser, not audio anyone will listen to.
 */
export function encodeForUpload(input: Float32Array, fromRate: number): string {
  const ratio = fromRate / INPUT_RATE;
  const outLength = Math.floor(input.length / ratio);
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const at = i * ratio;
    const lo = Math.floor(at);
    const hi = Math.min(lo + 1, input.length - 1);
    const sample = input[lo] + (input[hi] - input[lo]) * (at - lo);
    // Clamp before scaling, or a hot mic wraps around into a loud crackle.
    out[i] = Math.max(-1, Math.min(1, sample)) * 0x7fff;
  }
  return encodeBase64(new Uint8Array(out.buffer));
}

/**
 * Plays 24 kHz PCM chunks gaplessly, and can be silenced instantly.
 *
 * Instant matters: barge-in is the whole point of a realtime mode, and an
 * assistant that keeps talking for two seconds after you interrupt it is worse
 * than one that never let you.
 */
export class PcmPlayer {
  private ctx: AudioContext;
  private gain: GainNode;
  private cursor = 0;
  private sources = new Set<AudioBufferSourceNode>();
  /** Fires when the queue drains, so the caller can drop the "speaking" state. */
  onIdle: (() => void) | null = null;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.connect(ctx.destination);
  }

  get playing() {
    return this.sources.size > 0;
  }

  enqueue(pcm: Int16Array) {
    if (!pcm.length) return;
    const buffer = this.ctx.createBuffer(1, pcm.length, OUTPUT_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 0x8000;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);

    // Never schedule in the past: if the queue has drained, restart from now
    // plus a hair, otherwise the chunk is dropped silently.
    const startAt = Math.max(this.cursor, this.ctx.currentTime + 0.02);
    source.start(startAt);
    this.cursor = startAt + buffer.duration;

    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      if (!this.sources.size) this.onIdle?.();
    };
  }

  /** Barge-in: kill everything queued and reset the cursor. */
  stop() {
    for (const source of this.sources) {
      try { source.onended = null; source.stop(); } catch { /* already finished */ }
    }
    this.sources.clear();
    this.cursor = 0;
  }

  close() {
    this.stop();
    try { this.gain.disconnect(); } catch { /* already detached */ }
  }
}

/**
 * A tiny worklet so capture runs off the main thread. ScriptProcessorNode
 * would also work and is deprecated for good reason — it fires on the main
 * thread and drops frames exactly when React is busy rendering.
 */
const CAPTURE_WORKLET = `
class Capture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch && ch.length) this.port.postMessage(new Float32Array(ch));
    return true;
  }
}
registerProcessor('dhela-capture', Capture);
`;

export async function startCapture(
  ctx: AudioContext,
  stream: MediaStream,
  onFrame: (base64: string) => void,
): Promise<() => void> {
  const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "dhela-capture");
  node.port.onmessage = e => onFrame(encodeForUpload(e.data as Float32Array, ctx.sampleRate));
  source.connect(node);
  // Not connected to the destination: routing the microphone to the speakers
  // is how you get feedback howl.

  return () => {
    node.port.onmessage = null;
    try { source.disconnect(); node.disconnect(); } catch { /* already torn down */ }
  };
}
