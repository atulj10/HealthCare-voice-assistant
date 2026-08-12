import { useVoiceCall } from "./hooks/useVoiceCall";
import StartScreen from "./components/StartScreen";
import CallScreen from "./components/CallScreen";
import HealthReport from "./components/HealthReport";

function App() {
  const voice = useVoiceCall();

  const canStart = voice.status === "idle" || (voice.status === "error" && !voice.callStarted);
  const showReport = voice.status === "completed" && voice.report !== null;

  return (
    <div className="flex min-h-screen flex-col items-center bg-gradient-to-b from-slate-50 to-slate-100 px-4 py-10">
      <main className="flex w-full max-w-2xl flex-1 flex-col items-center">
        {canStart ? (
          <StartScreen
            error={voice.error}
            disabled={voice.status === "connecting"}
            onStart={() => void voice.startCall()}
          />
        ) : showReport ? (
          <HealthReport report={voice.report!} onNewCall={voice.reset} />
        ) : (
          <CallScreen
            status={voice.status}
            error={voice.error}
            language={voice.activeLanguage}
            languageSwitchNotice={voice.languageSwitchNotice}
            messages={voice.messages}
            interimTranscript={voice.interimTranscript}
            userSpeaking={voice.userSpeaking}
            onEnd={voice.endCall}
          />
        )}
      </main>
    </div>
  );
}

export default App;
