import { randomUUID } from "node:crypto";
import type { CallState, CallStatus } from "../types/call";
import { createCallState } from "./callState";

const STALE_CALL_MS = 30 * 60 * 1000;

const calls = new Map<string, CallState>();

export function createCall(): CallState {
  const call = createCallState(randomUUID());
  calls.set(call.callId, call);
  console.log(`[CALL] Call started (${call.callId})`);
  return call;
}

export function getCall(callId: string): CallState | undefined {
  return calls.get(callId);
}

export function setCallStatus(callId: string, status: CallStatus): void {
  const call = calls.get(callId);
  if (call) call.status = status;
}

export function hasCall(callId: string): boolean {
  return calls.has(callId);
}

export function removeCall(callId: string): void {
  calls.delete(callId);
}

/**
 * Opportunistic cleanup so abandoned in-memory calls do not accumulate.
 */
export function sweepStaleCalls(): void {
  const now = Date.now();
  for (const [callId, call] of calls) {
    if (now - call.createdAt > STALE_CALL_MS) {
      calls.delete(callId);
      console.log(`[CALL] Removed stale call (${callId})`);
    }
  }
}
