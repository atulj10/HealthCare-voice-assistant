/**
 * Playback queue for raw Int16 PCM audio chunks received over the WebSocket.
 *
 * Chunks are converted to AudioBuffers and scheduled on a single continuous
 * playhead (`AudioContext.currentTime`), each buffer starting at exactly the
 * moment the previous one ends. This avoids the tiny per-chunk scheduling gaps
 * (crackling/clicking) that happen when each buffer is played individually
 * with `onended` chaining.
 *
 * `interrupt()` stops all active buffers, drops the queue, and resets the
 * playhead so fresh audio (e.g. after barge-in) starts cleanly.
 */
export class PlaybackQueue {
  private readonly ctx: AudioContext;
  private pending: AudioBuffer[] = [];
  private active: Set<AudioBufferSourceNode> = new Set();
  private nextStartTime = 0;
  private stopped = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  enqueuePcm(arrayBuffer: ArrayBuffer, sampleRate = 16000): void {
    if (this.stopped) {
      this.stopped = false;
    }

    const int16 = new Int16Array(arrayBuffer);
    if (int16.length === 0) return;

    // Resample the incoming stream to the AudioContext's native rate so the
    // browser never has to resample a whole 16kHz rendering thread to the
    // device rate (a common source of crackling on Windows).
    const sourceRate = sampleRate;
    const targetRate = this.ctx.sampleRate;
    const samples =
      sourceRate === targetRate ? int16 : resampleInt16(int16, sourceRate, targetRate);

    const audioBuffer = this.ctx.createBuffer(1, samples.length, targetRate);
    const data = audioBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i] / 32768;
      data[i] = sample > 1 ? 1 : sample < -1 ? -1 : sample;
    }

    this.pending.push(audioBuffer);
    this.flush();
  }

  /**
   * Schedules every pending buffer back-to-back on the continuous playhead.
   * When nothing is currently playing, starts a fresh playhead slightly in the
   * future so the first chunk never clips (start-time clamping).
   */
  private flush(): void {
    if (this.stopped) return;

    if (this.active.size === 0) {
      this.nextStartTime = this.ctx.currentTime + 0.05;
    }

    while (this.pending.length > 0) {
      const buffer = this.pending.shift()!;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.ctx.destination);
      source.onended = () => {
        this.active.delete(source);
      };
      source.start(this.nextStartTime);
      this.nextStartTime += buffer.duration;
      this.active.add(source);
    }
  }

  interrupt(): void {
    this.stopped = true;
    this.pending = [];
    this.nextStartTime = 0;
    for (const source of this.active) {
      try {
        source.stop();
      } catch {
        // ignore
      }
    }
    this.active.clear();
  }

  stop(): void {
    this.interrupt();
  }
}

/**
 * Linearly interpolates an Int16 PCM buffer from `sourceRate` to `targetRate`.
 * Used to lift the 16kHz TTS stream up to the AudioContext's native rate.
 */
function resampleInt16(
  input: Int16Array,
  sourceRate: number,
  targetRate: number,
): Int16Array {
  const ratio = sourceRate / targetRate;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Int16Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const index = Math.floor(pos);
    const frac = pos - index;
    const a = input[index];
    const b = index + 1 < input.length ? input[index + 1] : a;
    output[i] = a + (b - a) * frac;
  }

  return output;
}
