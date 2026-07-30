/**
 * Minimal WAV container.
 *
 * Gemini's TTS returns raw signed 16-bit PCM ("audio/L16;codec=pcm;rate=24000")
 * and browsers will not play that — <audio> needs a container. Forty-four
 * bytes of header is cheaper than shipping a decoder to the client or an
 * encoder to the server, and every field here is fixed except the two lengths.
 *
 * Kept apart from the server function so it can be tested as the pure byte
 * arithmetic it is; a wrong length field yields silence or static, which is
 * exactly the sort of thing that is invisible until someone hears it.
 */
export const PCM_SAMPLE_RATE = 24000;

export function pcmToWav(pcm: Buffer, rate = PCM_SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4); // everything after this field
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);             // fmt chunk length
  header.writeUInt16LE(1, 20);              // format 1 = uncompressed PCM
  header.writeUInt16LE(1, 22);              // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);       // byte rate = rate × channels × bytes
  header.writeUInt16LE(2, 32);              // block align
  header.writeUInt16LE(16, 34);             // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Sample rate the model declares in its mime type, falling back to the usual. */
export const rateFromMime = (mime: string | undefined) =>
  Number(/rate=(\d+)/.exec(mime ?? "")?.[1]) || PCM_SAMPLE_RATE;
