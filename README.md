# AI Health Screening Voice Call

A web app where a user has a live, continuous-voice conversation with an AI agent that conducts a basic, non-diagnostic health-screening call. The user speaks naturally, the AI understands, responds, and at the end a structured health report is generated.

**English only · Continuous microphone streaming · WebSocket transport · Deepgram Streaming STT · Gemini for conversational reasoning · Deepgram Streaming TTS · In-memory call state · No database · No authentication**

---

## Table of contents

1. [Project overview](#project-overview)
2. [Architecture](#architecture)
3. [Technology stack](#technology-stack)
4. [STT → LLM → TTS flow](#stt--llm--tts-flow)
5. [WebSocket architecture](#websocket-architecture)
6. [Conversation state management](#conversation-state-management)
7. [Setup instructions](#setup-instructions)
8. [Environment variables](#environment-variables)
9. [How to obtain a Deepgram API key](#how-to-obtain-a-deepgram-api-key)
10. [How to obtain a Gemini API key](#how-to-obtain-a-gemini-api-key)
11. [How to run the backend](#how-to-run-the-backend)
12. [How to run the frontend](#how-to-run-the-frontend)
13. [Browser microphone requirements](#browser-microphone-requirements)
14. [Known limitations](#known-limitations)
15. [Production improvements](#production-improvements)

---

## Project overview

- The user clicks **Start Call** and grants microphone access.
- The microphone stays **continuously active** for the whole call. There is **no push-to-talk**.
- Mic audio is captured via the Web Audio API + an `AudioWorklet` that converts Float32 samples to **mono 16-bit PCM @ 16kHz**, and streamed to the backend over a WebSocket.
- The backend runs **Deepgram Streaming STT**, calls **Gemini** once per finalized user utterance, and synthesizes the reply with **Deepgram Streaming TTS** (raw PCM), which is streamed back to the browser and played through an audio playback queue.
- The AI asks one question at a time, remembers what was answered, never repeats answered questions, and adapts to the user.
- Clicking **End Call** generates a structured health report (via Gemini structured output, with a local fallback) and shows it in the UI.

## Architecture

```
                    React Browser
                         |
                         | WebSocket
                         | continuous microphone PCM
                         v
                   Node.js Backend
                         |
             +-----------+-----------+
             |           |           |
             v           v           v
         Deepgram      Gemini      Deepgram
           STT           LLM          TTS
             |           |           |
             +-----------+-----------+
                         |
                    Call State
                         |
                         v
                  Health Report
                         |
                         v
                    React UI
```

The browser communicates **only** with the Node.js backend. All Deepgram and Gemini calls happen in the backend; API keys never reach the browser.

## Technology stack

**Frontend** (`frontend/`)
- React 19, Vite 8, TypeScript, TailwindCSS 4
- Web Audio API + AudioWorklet (microphone → PCM)
- Browser WebSocket
- Playback queue for streaming TTS PCM

**Backend** (`backend/`)
- Node.js, TypeScript, Express, `ws`, `dotenv`, `cors`, `zod`
- `@deepgram/sdk` (streaming STT + streaming TTS)
- `@google/genai` (Gemini structured output)
- Runs with `tsx` in development

## STT → LLM → TTS flow

```
Microphone (continuous)                     
   └─ PCM chunks ──► WebSocket ──► Deepgram Streaming STT
                                            └─ interim transcripts ──► UI (live captions)
                                            └─ utterance finalized (UtteranceEnd)
                                                 └─ Call Gemini ONCE (with call state + history)
                                                      └─ update call state (merge extracted data)
                                                      └─ reply ──► Deepgram Streaming TTS
                                                                    └─ PCM ──► WebSocket ──► playback queue ──► speakers
```

- **Interim transcripts** are shown live but are **never** sent to Gemini.
- Gemini is called **once per finalized user utterance** (guarded against duplicate final events — only `UtteranceEnd` triggers a turn, and turns are serialized).
- If the transcript is empty the AI says: *"I didn't quite catch that. Could you please repeat?"* (no LLM call).
- If Gemini fails the AI says: *"I'm sorry, I had trouble processing that. Could you please repeat?"* and the call continues.

## WebSocket architecture

One endpoint: `ws://localhost:5000/ws/call?callId=...`

**Frontend → Backend (text JSON)**

```json
{ "type": "start_call" }
{ "type": "end_call" }
```

**Frontend → Backend (binary)**

Raw linear16 PCM @ 16kHz mono microphone audio.

**Backend → Frontend**

```json
{ "type": "call_started", "callId": "..." }
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
- `user_speaking_start` triggers **barge-in**: the browser stops and clears queued AI audio.
- Unknown message types are ignored safely.
- A companion REST API exists: `GET /health`, `POST /api/calls`, `POST /api/calls/:callId/end`, `GET /api/calls/:callId/report`. The frontend uses `POST /api/calls` to create a call and `GET /api/calls/:callId/report` to fetch the authoritative report after the call ends.

**Barge-in:** the microphone stays active while the AI speaks. If the user starts speaking, the backend clears the Deepgram TTS buffer, the browser stops/stops queued audio, and the new utterance is processed.

## Conversation state management

Calls are kept in memory in the backend:

```ts
Map<string, CallState>

interface CallState {
  callId: string;
  status: "active" | "ending" | "completed";
  language: "en";
  messages: ConversationMessage[];      // full transcript
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

- The backend **explicitly** persists state; it does not rely on Gemini's memory.
- Gemini returns structured JSON (validated with Zod) including only the newly extracted fields; the backend **merges** them into `collectedData`, never overwriting existing data with `null`, and de-duplicates symptoms.
- The full state + history is sent to Gemini on every turn so the model never repeats an already-answered question.
- Calls that are abandoned are swept after 30 minutes.

## Setup instructions

Prerequisites: Node.js 20+, npm.

```bash
# 1. Backend
cd backend
npm install
cp .env.example .env        # then fill in your API keys (see below)

# 2. Frontend (dependencies are already installed)
cd ../frontend
npm install
```

## Environment variables

All secrets live in `backend/.env` only. **Never** expose them to the frontend.

```
BACKEND_PORT=5000
FRONTEND_URL=http://localhost:5173

DEEPGRAM_API_KEY=
GEMINI_API_KEY=

# Optional overrides
# GEMINI_MODEL=gemini-3.6-flash
# DEEPGRAM_STT_MODEL=nova-3
# DEEPGRAM_TTS_MODEL=aura-2-luna-en
```

Never use `VITE_DEEPGRAM_API_KEY` or `VITE_GEMINI_API_KEY`.

## How to obtain a Deepgram API key

1. Go to [console.deepgram.com](https://console.deepgram.com/).
2. Create a (free) account.
3. Create a project and copy an API key.
4. Paste it into `backend/.env` as `DEEPGRAM_API_KEY`.

Used for streaming STT (`nova-3`) and streaming TTS (`aura-2-luna-en`, raw linear16 @ 16kHz).

## How to obtain a Gemini API key

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Sign in with a Google account and create an API key.
3. Paste it into `backend/.env` as `GEMINI_API_KEY`.

Used for conversational reasoning and report generation with structured output. Default model `gemini-3.6-flash` (free tier) — override with `GEMINI_MODEL`.

## How to run the backend

```bash
cd backend
npm run dev          # tsx watch, http://localhost:5000
```

Verify: `http://localhost:5000/health` → `{ "status": "ok" }`.

## How to run the frontend

```bash
cd frontend
npm run dev          # http://localhost:5173
```

Vite proxies `/api` and `/ws` to the backend, so no CORS setup is needed in development.

Open http://localhost:5173, click **Start Call**, and allow microphone access.

## Browser microphone requirements

- Chrome, Edge, or Firefox (recent versions). Safari works but PCM sample-rate support varies (the worklet resamples to 16 kHz regardless).
- The page must be served over `http://localhost` (or HTTPS) — the browser requires a secure context for `getUserMedia`.
- The microphone stays active during the call; there is no push-to-talk.

## Known limitations

- **English only** (STT configured for `en-US`).
- No database and no authentication — call state is in-memory and lost on restart.
- Barge-in is a simple interrupt: queued audio is stopped/cleared and the TTS buffer is flushed, but a tiny tail of already-streamed audio may be heard. In-flight Gemini turns are not cancelled.
- Deepgram STT connection failures are reported to the user; automatic STT reconnection is not implemented (recovery is "best effort").
- TTS audio is not saved to disk and there is no recording of the call.
- Report generation falls back to a local summary if Gemini is unavailable.
- Deepgram TTS uses `aura-2-luna-en`; the Deepgram quota for streaming TTS is per-minute, which may limit very long conversations.

## Production improvements

- Persist call state and reports (e.g., Postgres) and add authentication/rate-limiting.
- Add STT reconnection with a short retry/backoff and keepalive pings.
- Implement server-side TTS cancellation at the socket level for tighter barge-in.
- Use Deepgram temporary auth tokens (`/auth/issue`) scoped per session instead of forwarding long-lived keys.
- Add activity/utterance keepalive handling and idle timeouts.
- Serve the frontend build from the backend (static hosting) or a CDN with HTTPS.
- Add logging/metrics/tracing for STT/LLM/TTS latency and per-call cost.
- Add tests for turn serialization, merge logic, and the end-call race conditions.
