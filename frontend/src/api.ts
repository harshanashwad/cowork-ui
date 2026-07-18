// Every direct REST call to the FastAPI backend lives here. Everything
// else the frontend talks to the backend about goes over the websocket
// (see hooks/useSessionSocket.ts) — this file is only for request/response
// calls, not the live event stream.

export interface SessionInfo {
  id: string;
  directory: string;
  title: string;
}

export async function createSession(): Promise<SessionInfo> {
  // POST /api/sessions -> FastAPI backend (proxied by Vite from /api to :8000)
  const response = await fetch("/api/sessions", { method: "POST" });
  if (!response.ok) {
    throw new Error(`failed to create session: ${response.status}`);
  }
  return response.json();
}

export async function listSessions(): Promise<SessionInfo[]> {
  // GET /api/sessions -> the sidebar's "Recents" list. Only reflects
  // sessions created since the backend last started.
  const response = await fetch("/api/sessions");
  if (!response.ok) {
    throw new Error(`failed to list sessions: ${response.status}`);
  }
  return response.json();
}

export async function getMessages(sessionId: string): Promise<any[]> {
  // GET /api/sessions/{id}/messages -> OpenCode's own message history for
  // this session, raw ({info, parts}[]) — useSessionSocket replays it
  // through the same event handler live events go through.
  const response = await fetch(`/api/sessions/${sessionId}/messages`);
  if (!response.ok) {
    throw new Error(`failed to load session history: ${response.status}`);
  }
  return response.json();
}

export async function uploadFile(sessionId: string, file: File): Promise<{ filename: string }> {
  // POST /api/sessions/{id}/upload (multipart) -> saved straight into that
  // session's working directory, so the agent can read it immediately.
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(`/api/sessions/${sessionId}/upload`, { method: "POST", body });
  if (!response.ok) {
    throw new Error(`failed to upload file: ${response.status}`);
  }
  return response.json();
}
