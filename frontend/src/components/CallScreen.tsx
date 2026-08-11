import type { CallStatus, TranscriptMessage } from "../types/call";
import CallStatusBadge from "./CallStatus";
import Conversation from "./Conversation";

interface CallScreenProps {
  status: CallStatus;
  error: string | null;
  messages: TranscriptMessage[];
  interimTranscript: string;
  userSpeaking: boolean;
  onEnd: () => void;
}

export default function CallScreen({
  status,
  error,
  messages,
  interimTranscript,
  userSpeaking,
  onEnd,
}: CallScreenProps) {
  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">AI Health Screening</h1>
        <CallStatusBadge status={status} userSpeaking={userSpeaking} />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Conversation messages={messages} interimTranscript={interimTranscript} />

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-slate-400">
          The microphone is continuously active. Speak naturally.
        </p>
        <button
          type="button"
          onClick={onEnd}
          disabled={status === "ending"}
          className="rounded-full bg-red-500 px-6 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          End Call
        </button>
      </div>
    </div>
  );
}
