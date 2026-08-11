export interface MicCapture {
  stop: () => void;
}

/**
 * AudioWorklet processor source. Runs inside the audio rendering thread:
 * converts microphone Float32 samples into mono 16-bit PCM at 16kHz
 * and posts the raw bytes to the main thread.
 *
 * The processor resamples from the AudioContext's native sample rate down
 * to 16kHz using linear interpolation (a no-op when the context is 16kHz).
 */
const WORKLET_SOURCE = `
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.pending = [];
  }

  process(inputs) {
    const input = inputs && inputs[0] && inputs[0][0];
    if (!input || input.length === 0) return true;

    for (let i = 0; i < input.length; i++) {
      this.pending.push(input[i]);
    }

    const outLen = Math.floor(this.pending.length / this.ratio);
    if (outLen < 1) return true;

    const out = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i * this.ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const a = this.pending[idx];
      const b = idx + 1 < this.pending.length ? this.pending[idx + 1] : a;
      let sample = a + (b - a) * frac;
      if (sample > 1) sample = 1;
      else if (sample < -1) sample = -1;
      out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }

    this.pending = this.pending.slice(outLen * this.ratio);
    this.port.postMessage(out.buffer, [out.buffer]);
    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
`;

/**
 * Starts continuous microphone capture on the provided AudioContext.
 * Every chunk of Int16 PCM data is delivered to `onPcm`.
 */
export async function startMicCapture(
  ctx: AudioContext,
  onPcm: (data: ArrayBuffer) => void,
): Promise<MicCapture> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access is not supported in this browser.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  await ctx.audioWorklet.addModule(
    URL.createObjectURL(
      new Blob([WORKLET_SOURCE], { type: "application/javascript" }),
    ),
  );

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm-processor");
  node.port.onmessage = (event: MessageEvent) => {
    onPcm(event.data as ArrayBuffer);
  };

  source.connect(node);

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      node.port.onmessage = null;
      try {
        source.disconnect();
        node.disconnect();
      } catch {
        // ignore
      }
      stream.getTracks().forEach((track) => track.stop());
    },
  };
}
