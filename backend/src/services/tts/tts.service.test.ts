import { describe, expect, it, vi } from "vitest";
import {
  TtsService,
  type TTSSpeakHandlers,
} from "./tts.service";
import type {
  TTSInput,
  TTSProvider,
  TTSResult,
  TTSSynthesizeOptions,
} from "./types";

function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) {
        return reject(new Error("Timed out waiting for condition"));
      }
      setTimeout(tick, 5);
    };
    tick();
  });
}

function makeHandlers() {
  return {
    onAudio: vi.fn(),
    onStart: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
  } satisfies TTSSpeakHandlers;
}

interface Gate {
  promise: Promise<void>;
  release: () => void;
}

class FakeProvider implements TTSProvider {
  readonly name = "fake";
  synthesize = vi.fn(async (_input: TTSInput, options?: TTSSynthesizeOptions) => {
    const emit = (data: string) => {
      if (options?.signal?.aborted) throw new Error("Aborted");
      options?.onChunk?.(Buffer.from(data));
    };
    emit("aaa");
    if (this.gate) await this.gate.promise;
    emit("bbb");
    return { audio: Buffer.from("aaabbb"), sampleRate: 16000 } as TTSResult;
  });

  gate: Gate | null = null;

  constructor(private configError: string | null = null) {}

  holdOpen(): Gate {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.gate = { promise, release };
    return this.gate;
  }

  getConfigurationError(): string | null {
    return this.configError;
  }
}

describe("TtsService.speak", () => {
  it("calls onStart, streams every chunk to onAudio, then onComplete", async () => {
    const provider = new FakeProvider();
    const service = new TtsService(provider);
    const handlers = makeHandlers();

    service.speak({ text: "hello", language: "en" }, handlers);

    expect(handlers.onStart).toHaveBeenCalled();
    await waitFor(() => handlers.onComplete.mock.calls.length > 0);

    expect(handlers.onAudio).toHaveBeenCalledTimes(2);
    expect(handlers.onAudio.mock.calls[0][0].toString()).toBe("aaa");
    expect(handlers.onAudio.mock.calls[1][0].toString()).toBe("bbb");
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it("passes the language through to the provider", async () => {
    const provider = new FakeProvider();
    const service = new TtsService(provider);
    const handlers = makeHandlers();

    service.speak({ text: "नमस्ते", language: "hi" }, handlers);
    await waitFor(() => handlers.onComplete.mock.calls.length > 0);

    expect(provider.synthesize).toHaveBeenCalledWith(
      expect.objectContaining({ text: "नमस्ते", language: "hi" }),
      expect.anything(),
    );
  });

  it("delivers provider errors to onError without calling onComplete", async () => {
    const provider = new FakeProvider();
    const service = new TtsService(provider);
    const handlers = makeHandlers();
    provider.synthesize.mockRejectedValueOnce(new Error("boom"));

    service.speak({ text: "hello", language: "en" }, handlers);
    await waitFor(() => handlers.onError.mock.calls.length > 0);

    expect(handlers.onError.mock.calls[0][0].message).toBe("boom");
    expect(handlers.onComplete).not.toHaveBeenCalled();
  });

  it("interrupt() rejects the in-flight task as TTS interrupted", async () => {
    const provider = new FakeProvider();
    const service = new TtsService(provider);
    const handlers = makeHandlers();
    const gate = provider.holdOpen();

    service.speak({ text: "hello", language: "en" }, handlers);
    await waitFor(() => handlers.onStart.mock.calls.length > 0);

    service.interrupt();

    expect(handlers.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "TTS interrupted" }),
    );

    gate.release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(handlers.onComplete).not.toHaveBeenCalled();
  });

  it("does not deliver audio after interrupt", async () => {
    const provider = new FakeProvider();
    const service = new TtsService(provider);
    const handlers = makeHandlers();
    const gate = provider.holdOpen();

    service.speak({ text: "hello", language: "en" }, handlers);
    await waitFor(() => handlers.onAudio.mock.calls.length > 0);
    service.interrupt();
    const countAfterInterrupt = handlers.onAudio.mock.calls.length;

    gate.release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(handlers.onAudio.mock.calls.length).toBe(countAfterInterrupt);
    expect(handlers.onComplete).not.toHaveBeenCalled();
  });

  it("fails fast when the provider is not configured", async () => {
    const provider = new FakeProvider("ELEVENLABS_API_KEY missing");
    const service = new TtsService(provider);
    const handlers = makeHandlers();

    service.speak({ text: "hello", language: "en" }, handlers);

    expect(handlers.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "ELEVENLABS_API_KEY missing" }),
    );
    expect(provider.synthesize).not.toHaveBeenCalled();
  });
});
