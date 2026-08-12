import { useCallback, useEffect, useRef, useState } from "react";
import { createCall, fetchReport, getWsUrl } from "../services/api";
import type {
  CallStatus,
  HealthReport,
  Language,
  ServerMessage,
  TranscriptMessage,
} from "../types/call";
import { startMicCapture, type MicCapture } from "./micCapture";
import { PlaybackQueue } from "./playbackQueue";

const MIC_ERROR_MESSAGE = "Microphone permission is required to start the call.";
const CONNECTION_ERROR_MESSAGE = "Connection to the voice service was lost.";
const SWITCH_NOTICE_MS = 3000;

function getAudioContext(): AudioContext {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  // Use the device's native sample rate. Forcing a 16kHz context makes the
  // browser resample the whole output thread up to the device rate, which
  // causes audible crackling on Windows.
  return new Ctor();
}

const LANGUAGE_LABEL: Record<Language, string> = {
  en: "Switched to English",
  hi: "Switched to Hindi",
};

export interface UseVoiceCall {
  status: CallStatus;
  error: string | null;
  callId: string | null;
  messages: TranscriptMessage[];
  interimTranscript: string;
  userSpeaking: boolean;
  report: HealthReport | null;
  activeLanguage: Language;
  languageSwitchNotice: string | null;
  callStarted: boolean;
  startCall: () => Promise<void>;
  endCall: () => void;
  reset: () => void;
}

export function useVoiceCall(): UseVoiceCall {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [report, setReport] = useState<HealthReport | null>(null);
  const [activeLanguage, setActiveLanguage] = useState<Language>("en");
  const [languageSwitchNotice, setLanguageSwitchNotice] = useState<string | null>(
    null,
  );
  const [callStarted, setCallStarted] = useState(false);

  const statusRef = useRef<CallStatus>(status);
  const callIdRef = useRef<string | null>(callId);
  const switchNoticeTimerRef = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const playbackRef = useRef<PlaybackQueue | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    callIdRef.current = callId;
  }, [callId]);

  useEffect(() => {
    return () => {
      if (switchNoticeTimerRef.current !== null) {
        window.clearTimeout(switchNoticeTimerRef.current);
      }
    };
  }, []);

  const showSwitchNotice = useCallback((language: Language) => {
    if (switchNoticeTimerRef.current !== null) {
      window.clearTimeout(switchNoticeTimerRef.current);
    }
    setLanguageSwitchNotice(LANGUAGE_LABEL[language]);
    switchNoticeTimerRef.current = window.setTimeout(() => {
      setLanguageSwitchNotice(null);
      switchNoticeTimerRef.current = null;
    }, SWITCH_NOTICE_MS);
  }, []);

  const cleanupResources = useCallback(() => {
    micRef.current?.stop();
    micRef.current = null;

    playbackRef.current?.stop();
    playbackRef.current = null;

    const ctx = ctxRef.current;
    ctxRef.current = null;
    if (ctx) {
      void ctx.close().catch(() => {});
    }

    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
  }, []);

  const refreshReport = useCallback(async (id: string) => {
    try {
      const fetched = await fetchReport(id);
      setReport(fetched);
    } catch {
      // Keep the report delivered over the WebSocket.
    }
  }, []);

  const handleServerMessage = useCallback(
    (raw: string) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(raw) as ServerMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case "call_started":
          setCallStarted(true);
          setStatus("active");
          if (msg.language === "en" || msg.language === "hi") {
            setActiveLanguage(msg.language);
          }
          break;
        case "language_changed":
          if (msg.language === "en" || msg.language === "hi") {
            setActiveLanguage(msg.language);
            showSwitchNotice(msg.language);
          }
          break;
        case "transcript_interim":
          setInterimTranscript(typeof msg.text === "string" ? msg.text : "");
          setUserSpeaking(true);
          break;
        case "transcript_final":
          setInterimTranscript("");
          setUserSpeaking(false);
          if (typeof msg.text === "string" && msg.text.trim()) {
            setMessages((prev) => [
              ...prev,
              { role: "user", content: msg.text as string },
            ]);
          }
          setStatus("processing");
          break;
        case "user_speaking_start":
          setUserSpeaking(true);
          playbackRef.current?.interrupt();
          break;
        case "ai_message":
          if (typeof msg.text === "string" && msg.text.trim()) {
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: msg.text as string },
            ]);
          }
          break;
        case "ai_speaking_start":
          setUserSpeaking(false);
          setStatus("ai-speaking");
          break;
        case "ai_speaking_end":
          setUserSpeaking(false);
          setStatus("active");
          break;
        case "report":
          setReport(msg.report as HealthReport);
          break;
        case "call_ended":
          setStatus("completed");
          if (callIdRef.current) {
            void refreshReport(callIdRef.current);
          }
          break;
        case "error":
          setError(typeof msg.message === "string" ? msg.message : "An error occurred.");
          setStatus("error");
          break;
        default:
          break;
      }
    },
    [refreshReport, showSwitchNotice],
  );

  const handleServerBinary = useCallback((data: ArrayBuffer) => {
    playbackRef.current?.enqueuePcm(data);
  }, []);

  const startCall = useCallback(async () => {
    setError(null);
    setReport(null);
    setMessages([]);
    setInterimTranscript("");
    setCallStarted(false);
    setActiveLanguage("en");
    setLanguageSwitchNotice(null);
    setStatus("connecting");

    let ctx: AudioContext;
    try {
      ctx = getAudioContext();
      await ctx.resume();

      const mic = await startMicCapture(ctx, (data) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });
      micRef.current = mic;
      ctxRef.current = ctx;
      playbackRef.current = new PlaybackQueue(ctx);
    } catch (err) {
      if (ctxRef.current) {
        void ctxRef.current.close().catch(() => {});
        ctxRef.current = null;
      }
      setError(MIC_ERROR_MESSAGE);
      setStatus("error");
      console.error("[CALL] Microphone setup failed", err);
      return;
    }

    let id: string;
    try {
      id = await createCall();
      setCallId(id);
    } catch (err) {
      cleanupResources();
      setError(CONNECTION_ERROR_MESSAGE);
      setStatus("error");
      console.error("[CALL] Could not create call", err);
      return;
    }

    const ws = new WebSocket(getWsUrl(id));
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "start_call" }));
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        handleServerMessage(event.data);
      } else {
        handleServerBinary(event.data as ArrayBuffer);
      }
    };

    ws.onerror = () => {
      if (statusRef.current !== "error") {
        setError(CONNECTION_ERROR_MESSAGE);
        setStatus("error");
      }
    };

    ws.onclose = () => {
      if (
        statusRef.current !== "completed" &&
        statusRef.current !== "ending" &&
        statusRef.current !== "error"
      ) {
        setError(CONNECTION_ERROR_MESSAGE);
        setStatus("error");
      }
      cleanupResources();
    };
  }, [cleanupResources, handleServerBinary, handleServerMessage]);

  const endCall = useCallback(() => {
    setStatus("ending");
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "end_call" }));
    } else {
      setError(CONNECTION_ERROR_MESSAGE);
      setStatus("error");
    }
  }, []);

  const reset = useCallback(() => {
    cleanupResources();
    if (switchNoticeTimerRef.current !== null) {
      window.clearTimeout(switchNoticeTimerRef.current);
      switchNoticeTimerRef.current = null;
    }
    setStatus("idle");
    setError(null);
    setCallId(null);
    setMessages([]);
    setInterimTranscript("");
    setUserSpeaking(false);
    setReport(null);
    setCallStarted(false);
    setActiveLanguage("en");
    setLanguageSwitchNotice(null);
  }, [cleanupResources]);

  useEffect(() => {
    return () => cleanupResources();
  }, [cleanupResources]);

  return {
    status,
    error,
    callId,
    messages,
    interimTranscript,
    userSpeaking,
    report,
    activeLanguage,
    languageSwitchNotice,
    callStarted,
    startCall,
    endCall,
    reset,
  };
}
