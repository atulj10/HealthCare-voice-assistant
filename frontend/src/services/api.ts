import type { HealthReport } from "../types/call";

const API_BASE = "/api";

export async function createCall(): Promise<string> {
  const res = await fetch(`${API_BASE}/calls`, { method: "POST" });
  if (!res.ok) {
    throw new Error("Failed to reach the voice service.");
  }
  const data = (await res.json()) as { callId: string };
  return data.callId;
}

export async function fetchReport(callId: string): Promise<HealthReport> {
  const res = await fetch(`${API_BASE}/calls/${encodeURIComponent(callId)}/report`);
  if (!res.ok) {
    throw new Error("Failed to fetch the report.");
  }
  const data = (await res.json()) as { report: HealthReport };
  return data.report;
}

export function getWsUrl(callId: string): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws/call?callId=${encodeURIComponent(callId)}`;
}
