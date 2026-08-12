import express from "express";
import cors from "cors";
import http from "node:http";
import { WebSocketServer } from "ws";
import { env } from "./config/env";
import { createCall, getCall, setCallStatus, sweepStaleCalls } from "./call/callManager";
import { generateReport } from "./services/report.service";
import { ttsService } from "./services/tts/tts.service";
import { CallSocket } from "./websocket/callSocket";

const app = express();

app.use(
  cors({
    origin: env.FRONTEND_URL,
  }),
);
app.use(express.json());

const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: "/ws/call" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "", "http://localhost");
  const callId = url.searchParams.get("callId") ?? undefined;
  new CallSocket(ws, callId);
});

/* ------------------------------------------------------------------ */
/* REST API                                                           */
/* ------------------------------------------------------------------ */

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/tts/status", (_req, res) => {
  res.json({
    provider: ttsService.providerName,
    languages: ["en", "hi"],
    configured: ttsService.getConfigurationError() === null,
  });
});

app.post("/api/calls", (_req, res) => {
  const call = createCall();
  res.status(201).json({ callId: call.callId });
});

app.post("/api/calls/:callId/end", async (req, res) => {
  const call = getCall(req.params.callId);
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  if (call.status === "active") {
    setCallStatus(call.callId, "ending");
  }
  const report = await generateReport(call);
  call.report = report;
  setCallStatus(call.callId, "completed");
  res.json({ report });
});

app.get("/api/calls/:callId/report", async (req, res) => {
  const call = getCall(req.params.callId);
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  if (call.status === "active") {
    res.status(409).json({ error: "Call is still in progress" });
    return;
  }
  const report = call.report ?? (await generateReport(call));
  call.report = report;
  res.json({ report });
});

/* ------------------------------------------------------------------ */
/* Startup                                                            */
/* ------------------------------------------------------------------ */

setInterval(sweepStaleCalls, 60 * 1000).unref();

server.listen(env.BACKEND_PORT, () => {
  console.log(`[SERVER] Backend listening on http://localhost:${env.BACKEND_PORT}`);
  console.log(`[SERVER] WebSocket endpoint: ws://localhost:${env.BACKEND_PORT}/ws/call`);
  if (!env.DEEPGRAM_API_KEY || !env.GEMINI_API_KEY || !env.ELEVENLABS_API_KEY) {
    console.warn(
      "[SERVER] Add DEEPGRAM_API_KEY, GEMINI_API_KEY and ELEVENLABS_API_KEY to backend/.env for the voice pipeline.",
    );
  }
  const ttsConfigError = ttsService.getConfigurationError();
  if (ttsConfigError) {
    console.warn(`[SERVER] TTS not fully configured: ${ttsConfigError}`);
  }
});
