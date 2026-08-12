interface StartScreenProps {
  error: string | null;
  disabled: boolean;
  onStart: () => void;
}

export default function StartScreen({ error, disabled, onStart }: StartScreenProps) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-600 text-3xl text-white shadow-lg">
        🩺
      </div>
      <h1 className="text-3xl font-bold text-slate-900">AI Health Screening</h1>
      <p className="mt-3 max-w-md text-slate-600">
        Have a short voice conversation with an AI health screening assistant.
        Answer a few simple questions about your health concern and get a
        structured report afterwards.
      </p>

      <p className="mt-4 max-w-md text-sm text-slate-500">
        You can speak English or Hindi. The assistant automatically responds in
        the language you use, and you can switch languages at any time during
        the call.
      </p>

      {error && (
        <div className="mt-6 w-full max-w-md rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={onStart}
        disabled={disabled}
        className="mt-8 rounded-full bg-teal-600 px-8 py-3 text-lg font-semibold text-white shadow-lg transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Start Call
      </button>

      <p className="mt-6 max-w-sm text-xs text-slate-400">
        You will be asked for microphone access. The microphone stays active
        for the whole call, and your audio is streamed securely to the backend.
      </p>
    </div>
  );
}
