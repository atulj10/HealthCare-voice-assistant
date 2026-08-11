import type { CallStatus } from "../types/call";

interface CallStatusProps {
  status: CallStatus;
  userSpeaking: boolean;
}

const LABELS: Record<CallStatus, string> = {
  idle: "Idle",
  connecting: "Connecting…",
  active: "Listening…",
  processing: "Processing…",
  "ai-speaking": "AI speaking…",
  ending: "Ending call…",
  completed: "Completed",
  error: "Error",
};

const COLORS: Record<CallStatus, string> = {
  idle: "bg-slate-300",
  connecting: "bg-amber-400",
  active: "bg-emerald-500",
  processing: "bg-violet-500",
  "ai-speaking": "bg-teal-500",
  ending: "bg-amber-400",
  completed: "bg-emerald-500",
  error: "bg-red-500",
};

export default function CallStatus({ status, userSpeaking }: CallStatusProps) {
  const showMicPulse = status === "active" && userSpeaking;

  return (
    <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 shadow-sm">
      <span className="relative flex h-3 w-3">
        {showMicPulse && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        )}
        <span
          className={`relative inline-flex h-3 w-3 rounded-full ${COLORS[status]}`}
        />
      </span>
      <span className="text-sm font-medium text-slate-700">{LABELS[status]}</span>
    </div>
  );
}
