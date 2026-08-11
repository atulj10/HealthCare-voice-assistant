/**
 * Sequential playback queue for raw Int16 PCM audio chunks received over
 * the WebSocket. Chunks are converted to AudioBuffers, queued, and played
 * one after another so playback never depends on chunk boundaries.
 *
 * `interrupt()` stops the currently playing buffer and drops the queue so
 * stale AI audio does not continue after the user barges in.
 */
export class PlaybackQueue {
  private readonly ctx: AudioContext;
  private queue: AudioBuffer[] = [];
  private playing = false;
  private current: AudioBufferSourceNode | null = null;
  private cleared = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  enqueuePcm(arrayBuffer: ArrayBuffer, sampleRate = 16000): void {
    if (this.cleared) return;
    this.cleared = false;

    const int16 = new Int16Array(arrayBuffer);
    if (int16.length === 0) return;

    const audioBuffer = this.ctx.createBuffer(1, int16.length, sampleRate);
    const data = audioBuffer.getChannelData(0);
    for (let i = 0; i < int16.length; i++) {
      const sample = int16[i] / 32768;
      data[i] = sample > 1 ? 1 : sample < -1 ? -1 : sample;
    }

    this.queue.push(audioBuffer);
    void this.playNext();
  }

  private async playNext(): Promise<void> {
    if (this.playing) return;
    this.playing = true;

    try {
      while (this.queue.length > 0) {
        if (this.cleared) break;
        const buffer = this.queue.shift()!;
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.ctx.destination);
        this.current = source;

        await new Promise<void>((resolve) => {
          source.onended = () => resolve();
          source.start();
        });

        this.current = null;
      }
    } finally {
      this.playing = false;
    }
  }

  interrupt(): void {
    this.cleared = true;
    this.queue = [];
    if (this.current) {
      try {
        this.current.stop();
      } catch {
        // ignore
      }
      this.current = null;
    }
  }

  stop(): void {
    this.cleared = true;
    this.queue = [];
    if (this.current) {
      try {
        this.current.stop();
      } catch {
        // ignore
      }
      this.current = null;
    }
  }
}
