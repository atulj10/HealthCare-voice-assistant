import { useEffect, useRef } from "react";
import type { TranscriptMessage } from "../types/call";

interface ConversationProps {
  messages: TranscriptMessage[];
  interimTranscript: string;
}

export default function Conversation({ messages, interimTranscript }: ConversationProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, interimTranscript]);

  return (
    <div className="flex h-80 flex-col gap-3 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4">
      {messages.length === 0 && !interimTranscript && (
        <p className="m-auto text-sm text-slate-400">
          The AI will greet you shortly. Speak naturally when you hear the prompt.
        </p>
      )}

      {messages.map((message, index) => (
        <div
          key={index}
          className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
            message.role === "assistant"
              ? "self-start rounded-bl-sm bg-slate-100 text-slate-800"
              : "self-end rounded-br-sm bg-teal-600 text-white"
          }`}
        >
          {message.content}
        </div>
      ))}

      {interimTranscript && (
        <div className="max-w-[85%] self-end rounded-2xl rounded-br-sm bg-teal-600/40 px-4 py-2 text-sm leading-relaxed text-teal-50 italic">
          {interimTranscript}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
