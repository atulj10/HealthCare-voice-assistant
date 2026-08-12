# AI Health Screening Voice Call

A web app where a user has a live, continuous-voice conversation with an AI agent that conducts a basic, non-diagnostic health-screening call. The user speaks naturally in **English or Hindi**, the AI understands, automatically responds in the same language, and at the end a structured health report is generated.

**Automatic English/Hindi detection · Continuous microphone streaming · WebSocket transport · Deepgram Streaming STT (Nova-3, multilingual) · Gemini primary LLM · Cerebras fallback LLM · ElevenLabs TTS · In-memory call state · No database · No authentication**

---

## Table of contents

1. [Project overview](#project-overview)
2. [Architecture](#architecture)
3. [Technology stack](#technology-stack)
4. [STT → LLM → TTS flow](#stt--llm--tts-flow)
5. [Automatic English/Hindi detection](#automatic-englishhindi-detection)
6. [Mid-call language switching](#mid-call-language-switching)
7. [WebSocket architecture](#websocket-architecture)
8. [Conversation state management](#conversation-state-management)
9. [LLM provider fallback](#llm-provider-fallback)
10. [ElevenLabs TTS](#elevenlabs-tts)
11. [Environment variables](#environment-variables)
12. [How to obtain the required API keys](#how-to-obtain-the-required-api-keys)
13. [ElevenLabs setup (voices)](#elevenlabs-setup-voices)
14. [How to run the backend](#how-to-run-the-backend)
15. [How to run the frontend](#how-to-run-the-frontend)
16. [Browser microphone requirements](#browser-microphone-requirements)
17. [Error handling](#error-handling)
18. [Known limitations](#known-limitations)
19. [Production improvements](#production-improvements)

---

## Project overview

- The user clicks **Start Call** and grants microphone access. **No language needs to be selected** — the call starts in English.
- The microphone stays **continuously active** for the whole call. There is **no push-to-talk**.
- Mic audio is captured via the Web Audio API + an `AudioWorklet` that converts Float32 samples to **mono 16-bit PCM @ 16kHz**, and streamed to the backend over a WebSocket.
- The backend runs **Deepgram Streaming STT** (`nova-3`, `language=multi`, a single connection for the whole call), calls the **LLM** once per finalized user utterance, and synthesizes the reply with **ElevenLabs TTS** (raw PCM), which is streamed back to the browser and played through an audio playback queue.
- **The LLM detects the language of each user utterance.** If the user speaks Hindi, the reply is in Hindi and the **ElevenLabs Hindi voice** is used. If the user switches back to English, the English voice is used again. No reconnection, no restart.
- The AI asks one question at a time, remembers what was answered, never repeats answered questions, and adapts to the user.
- Clicking **End Call** generates a structured health report (via the LLM with structured output, with a local fallback) and shows it in the UI. The report is generated in the **final conversation language**.

## Architecture

```
                    React Browser
                         |
                         | WebSocket
                         | continuous microphone PCM
                         v
                   Node.js Backend
                         |
              ┌──────────┴──────────┐
              │                     │
              ▼                     ▼
       Deepgram Nova-3          LLM Service
       Streaming STT                |
       language=multi         ┌─────┴─────┐
              │               ▼           ▼
              │           Gemini      Cerebras
              │           PRIMARY     FALLBACK
              │               |
              └───────────────┴───────────────┐
                                    structured response
                                    (reply + responseLanguage)
                                             |
                                             ▼
                                       ElevenLabs TTS
                                    ┌──────┴──────┐
                                    ▼             ▼
                                 English       Hindi
                                    │             │
                                    └─────┬───────┘
                                          ▼
                                       Browser
```

The browser communicates **only** with the Node.js backend. All Deepgram, Gemini, Cerebras, and ElevenLabs calls happen in the backend; API keys never reach the browser.

## Technology stack

**Frontend** (`frontend/`)
- React 19, Vite 8, TypeScript, TailwindCSS 4
- Web Audio API + AudioWorklet (microphone → PCM)
- Browser WebSocket
- Playback queue for streaming TTS PCM

**Backend** (`backend/`)
- Node.js, TypeScript, Express, `ws`, `dotenv`, `cors`, `zod`
- `@deepgram/sdk` (streaming STT)
- `@google/genai` (Gemini, primary LLM)
- `@cerebras/cerebras_cloud_sdk` (Cerebras, fallback LLM)
- ElevenLabs via its official REST streaming API (no SDK dependency needed)
- Runs with `tsx` in development, tested with Vitest

## STT → LLM → TTS flow

```
Microphone (continuous)
   └─ PCM chunks ──► WebSocket ──► Deepgram Streaming STT (nova-3, language=multi)
                                      └─ interim transcripts ──► UI (live captions)
                                      └─ utterance finalized (UtteranceEnd)
                                           └─ Call LLM ONCE (with call state + history + current language)
                                                └─ LLM returns reply + responseLanguage + extractedData
                                                └─ update CallState.language = responseLanguage
                                                └─ notify browser (language_changed)
                                                └─ ElevenLabs TTS (text, language)
                                                     └─ raw PCM ──► WebSocket ──► playback queue ──► speakers
```

- **Interim transcripts** are shown live but are **never** sent to the LLM.
- The LLM is called **once per finalized user utterance** (guarded against duplicate final events — only `UtteranceEnd` triggers a turn, and turns are serialized).
- If the transcript is empty the AI says *"I didn't quite catch that. Could you please repeat?"* (English) or the Hindi equivalent, using the **current** conversation language — no LLM call.
- If the LLM fails after both providers, the AI says a controlled error message and the call continues.

## Automatic English/Hindi detection

- The call **always starts in English** (`CallState.language = "en"`).
- Deepgram STT uses **one** connection with `model=nova-3, language=multi`, so a single connection transcribes both English and Hindi for the whole call. It is **never** reconnected when the user switches language.
- After every finalized user utterance, the **LLM** (not a separate API) determines whether the latest meaningful utterance is English or Hindi and returns `responseLanguage: "en" | "hi"` as part of its structured response.
- `CallState.language` is updated to `responseLanguage` after every turn, so it always reflects the **current** conversation language.
- The LLM is instructed **not** to switch languages because of isolated medical terms, names, numbers, or common loanwords (e.g. "मुझे three days से fever है" stays in Hindi).
- The final health report is generated in the **final** conversation language.

## Mid-call language switching

Works without restarting the call:

```
Current: English
User: "मुझे पेट में दर्द है।"
LLM: responseLanguage = "hi"
ElevenLabs: Hindi voice
(browser shows "Switched to Hindi")

Then:
User: "It started two days ago."
LLM: responseLanguage = "en"
ElevenLabs: English voice
(browser shows "Switched to English")
```

There is **no WebSocket reconnection, no Deepgram reconnection, and no call restart**. The browser simply receives a `language_changed` message and switches the displayed language indicator (and optionally shows a subtle, non-blocking notice). No language-switch announcement is spoken.

## WebSocket architecture

One endpoint: `ws://localhost:5000/ws/call?callId=...`

**Frontend → Backend (text JSON)**

```json
{ "type": "start_call" }
{ "type": "end_call" }
```

Language is **not** sent by the client — it is detected server-side per utterance.

**Frontend → Backend (binary)**

Raw linear16 PCM @ 16kHz mono microphone audio.

**Backend → Frontend**

```json
{ "type": "call_started", "callId": "...", "language": "en" }
{ "type": "language_changed", "language": "en" | "hi" }
{ "type": "transcript_interim", "text": "..." }
{ "type": "transcript_final", "text": "..." }
{ "type": "user_speaking_start" }
{ "type": "ai_message", "text": "..." }
{ "type": "ai_speaking_start" }
/* binary: raw linear16 PCM TTS audio */
{ "type": "ai_speaking_end" }
{ "type": "report", "report": { ... } }
{ "type": "call_ended" }
{ "type": "error", "message": "..." }
```

- `ai_speaking_start` / binary TTS chunks / `ai_speaking_end` demux text vs. audio.
- `user_speaking_start` triggers **barge-in**: the browser stops and clears queued AI audio, and the backend aborts the in-flight ElevenLabs synthesis.
- `language_changed` is sent after every turn whose detected language differs from the previous one (and on the first turn) so the UI can show the current language.
- Unknown message types are ignored safely.
- A companion REST API exists: `GET /health`, `POST /api/calls`, `POST /api/calls/:callId/end`, `GET /api/calls/:callId/report`, `GET /api/tts/status`. The frontend uses `POST /api/calls` to create a call and `GET /api/calls/:callId/report` to fetch the authoritative report after the call ends.

**Barge-in:** the microphone stays active while the AI speaks. If the user starts speaking, the backend aborts the ElevenLabs synthesis, the browser stops/stops queued audio, and the new utterance is processed.

## Conversation state management

Calls are kept in memory in the backend:

```ts
Map<string, CallState>

interface CallState {
  callId: string;
  status: "active" | "ending" | "completed";
  language: "en" | "hi";              // CURRENT conversation language, updated per turn
  messages: ConversationMessage[];    // full transcript
  collectedData: {
    name: string | null;
    mainConcern: string | null;
    duration: string | null;
    severity: string | null;
    relatedSymptoms: string[];
    otherRelevantInformation: string[];
  };
  askedQuestions: string[];
  report?: HealthReport;
}
```

- The backend **explicitly** persists state; it does not rely on the LLM's memory.
- The LLM returns structured JSON (validated with Zod) including `responseLanguage` and only the newly extracted fields; the backend **merges** them into `collectedData`, never overwriting existing data with `null`, and de-duplicates symptoms.
- The full state + history + current language is sent to the LLM on every turn so the model never repeats an already-answered question and can detect language switches.
- Calls that are abandoned are swept after 30 minutes.

## LLM provider fallback

- **Gemini is the primary LLM provider.**
- **Cerebras is the automatic fallback** used when the primary fails with a temporary error (`RATE_LIMIT`, `TIMEOUT`, or `SERVER_ERROR`).
- The fallback receives the **same conversation, same collectedData, same askedQuestions, same latestUserMessage, and same current language**. If the user is speaking Hindi when Gemini fails, Cerebras must reply in Hindi — the user never notices the provider change.
- If **both** providers fail, the backend replies with a controlled, localized error message and the call continues.
- The primary/fallback provider names are configurable via `LLM_PROVIDER` and `LLM_FALLBACK_PROVIDER`.

## ElevenLabs TTS

- TTS is provider-independent. The conversation logic depends only on `backend/src/services/tts/types.ts`; only `elevenlabs.provider.ts` knows the ElevenLabs API.
- The ElevenLabs **streaming** endpoint (`/v1/text-to-speech/{voice_id}/stream`) is used with a **raw PCM** output format (`pcm_16000`, matching the browser playback queue). Audio chunks are forwarded progressively over the WebSocket, so playback starts before synthesis finishes.
- The voice is chosen per utterance from the detected language:
  - `language === "en"` → `ELEVENLABS_VOICE_EN`
  - `language === "hi"` → `ELEVENLABS_VOICE_HI`
- The model must be a **multilingual model that supports both English and Hindi**, configured via `ELEVENLABS_MODEL_ID` (e.g. `eleven_flash_v2_5` for low latency, or `eleven_multilingual_v2` for highest quality).
- ElevenLabs errors are normalized into `TTSServiceError` (CONFIG / AUTH / RATE_LIMIT / NETWORK / SERVER / INVALID_REQUEST / UNKNOWN). Failures do **not** crash the call — the AI text stays visible and the conversation continues.
- If Hindi TTS fails, the language state stays Hindi; the app never silently substitutes an English voice.

## Environment variables

All secrets live in `backend/.env` only. **Never** expose them to the frontend (no `VITE_*` keys for any of these).

```
# Server
BACKEND_PORT=5000
FRONTEND_URL=http://localhost:5173

# Deepgram (streaming STT)
DEEPGRAM_API_KEY=
# DEEPGRAM_STT_MODEL=nova-3
# DEEPGRAM_STT_LANGUAGE=multi

# LLM
LLM_PROVIDER=gemini
LLM_FALLBACK_PROVIDER=cerebras

# Gemini (primary LLM)
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.6-flash

# Cerebras (fallback LLM)
CEREBRAS_API_KEY=
CEREBRAS_MODEL=gpt-oss-120b

# ElevenLabs (TTS)
ELEVENLABS_API_KEY=
ELEVENLABS_MODEL_ID=eleven_flash_v2_5
ELEVENLABS_VOICE_EN=
ELEVENLABS_VOICE_HI=
```

Optional: `ELEVENLABS_BASE_URL`, `ELEVENLABS_OPTIMIZE_STREAMING_LATENCY` (0–4), `TTS_SAMPLE_RATE` (default 16000 — must stay aligned with the browser playback pipeline).

## How to obtain the required API keys

1. **Deepgram** — [console.deepgram.com](https://console.deepgram.com/): create a (free) account → project → copy the API key → `DEEPGRAM_API_KEY`. Used for streaming STT (`nova-3`, `language=multi`).
2. **Gemini** — [aistudio.google.com/apikey](https://aistudio.google.com/apikey): sign in with a Google account → create an API key → `GEMINI_API_KEY`. Primary LLM.
3. **Cerebras** — [cloud.cerebras.ai](https://cloud.cerebras.ai/): create an account → API key → `CEREBRAS_API_KEY`. Automatic fallback LLM.
4. **ElevenLabs** — [elevenlabs.io/app/settings/api-keys](https://elevenlabs.io/app/settings/api-keys): create an account → copy an API key → `ELEVENLABS_API_KEY`. Used for TTS.

## ElevenLabs setup (voices)

The repo does **not** hardcode voice IDs, so you must provide the IDs of two voices in `backend/.env`:

1. Open [elevenlabs.io/app/voices](https://elevenlabs.io/app/voices).
2. Pick an **English** voice and copy its voice ID → `ELEVENLABS_VOICE_EN`.
3. Pick a **Hindi** voice (filter voices by the Hindi language, or create one) and copy its voice ID → `ELEVENLABS_VOICE_HI`.

A voice ID is the 32-character string in the voice's share URL / settings (e.g. `21m00Tcm4TlvDq8ikWAM` for the "Rachel" pre-made voice). Both IDs are required; if either is missing, the backend refuses to start a call with a clear error and `GET /api/tts/status` reports `"configured": false`.

Use a **multilingual model** that explicitly supports both English and Hindi. Verified options:
- `eleven_flash_v2_5` — low-latency, optimized for real-time/conversational use (default).
- `eleven_multilingual_v2` — highest quality, still supports Hindi.
- `eleven_v3` — supports Hindi but is designed for offline/high-quality use, **not** real-time.

`GET /api/tts/status` returns:

```json
{ "provider": "elevenlabs", "languages": ["en", "hi"], "configured": true }
```

It never exposes API keys.

## How to run the backend

```bash
cd backend
npm install
cp .env.example .env      # then fill in your API keys and voice IDs (see above)
npm run dev               # tsx watch, http://localhost:5000
```

Verify: `http://localhost:5000/health` → `{ "status": "ok" }` and `http://localhost:5000/api/tts/status`.

## How to run the frontend

```bash
cd frontend
npm install
npm run dev               # http://localhost:5173
```

Vite proxies `/api` and `/ws` to the backend, so no CORS setup is needed in development.

Open http://localhost:5173, click **Start Call**, and allow microphone access. No language selection is needed — speak English or Hindi and the assistant follows along.

## Browser microphone requirements

- Chrome, Edge, or Firefox (recent versions). Safari works but PCM sample-rate support varies (the worklet resamples to 16 kHz regardless).
- The page must be served over `http://localhost` (or HTTPS) — the browser requires a secure context for `getUserMedia`.
- The microphone stays active during the call; there is no push-to-talk.

## Error handling

- **ElevenLabs TTS failure** — the call does not crash, the AI text stays visible, the normalized error is logged, and the conversation continues. The language state stays unchanged.
- **Gemini rate limit/timeout/server error** — automatic fallback to Cerebras with identical input (conversation, extracted data, language).
- **Both LLM providers fail** — a controlled, localized error message is shown and the call continues.
- **Empty transcript** — a localized "please repeat" response in the **current** language.
- **Deepgram STT disconnects** — reported to the user; recovery is best-effort (automatic reconnection is not implemented).
- **Incomplete call** — ending after one or two exchanges generates a limited report with `informationCompleteness` set appropriately and `null`/`[]` for missing fields, without crashing.

## Known limitations

- Language detection is done by the LLM on finalized utterances; very short utterances may occasionally be classified with the previous language.
- Barge-in aborts in-flight ElevenLabs synthesis and clears queued audio, but a tiny tail of already-streamed audio may still be heard.
- Deepgram STT connection failures are reported to the user; automatic STT reconnection is not implemented (recovery is "best effort").
- TTS audio is not saved to disk and there is no recording of the call.
- Report generation falls back to a local summary if the LLM is unavailable.
- ElevenLabs TTS and LLM usage consume API credits/quotas; heavy use may hit rate limits.

## Production improvements

- Persist call state and reports (e.g., Postgres) and add authentication/rate-limiting.
- Add STT reconnection with a short retry/backoff and keepalive pings.
- Use server-side TTS cancellation and tighter barge-in at the socket level.
- Use Deepgram temporary auth tokens (`/auth/issue`) and short-lived ElevenLabs/Gemini credentials scoped per session.
- Add activity/utterance keepalive handling and idle timeouts.
- Serve the frontend build from the backend (static hosting) or a CDN with HTTPS.
- Add logging/metrics/tracing for STT/LLM/TTS latency and per-call cost.
- Add tests for turn serialization, merge logic, language switching, and the end-call race conditions.
