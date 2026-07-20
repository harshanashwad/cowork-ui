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
  // POST /api/sessions -> FastAPI backend (proxied by Vite from /api to :8000).
  // Starts completely empty — no deck at all. Upload a .pptx from within
  // the session (uploadFile below) to load one.
  const response = await fetch("/api/sessions", { method: "POST" });
  if (!response.ok) {
    throw new Error(`failed to create session: ${response.status}`);
  }
  return response.json();
}

export function exportUrl(sessionId: string): string {
  // GET /api/sessions/{id}/export.pptx -> plain download link, no JS needed
  // beyond building the URL (see SlideThumbnailRail.tsx).
  return `/api/sessions/${sessionId}/export.pptx`;
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

export async function deleteSession(sessionId: string): Promise<void> {
  // DELETE /api/sessions/{id} -> removes the session and its working
  // directory entirely. 409s if a turn is currently in progress for it.
  const response = await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`failed to delete session: ${response.status}`);
  }
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
  // A .pptx is special-cased server-side: saved as the deck itself
  // (deck.pptx, committed as-is, no conversion), not a generic attachment.
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(`/api/sessions/${sessionId}/upload`, { method: "POST", body });
  if (!response.ok) {
    throw new Error(`failed to upload file: ${response.status}`);
  }
  return response.json();
}

export interface HistoryEntry {
  hash: string;
  message: string;
}

export async function getHistory(sessionId: string): Promise<HistoryEntry[]> {
  // GET /api/sessions/{id}/history -> this deck's whole commit history,
  // most recent first, for the version history sidebar.
  const response = await fetch(`/api/sessions/${sessionId}/history`);
  if (!response.ok) {
    throw new Error(`failed to load history: ${response.status}`);
  }
  return response.json();
}

export async function revertTo(sessionId: string, commit: string): Promise<{ filenames: string[] }> {
  // POST /api/sessions/{id}/revert -> git checkout <commit> -- deck.pptx,
  // committed as a new "Revert to ..." entry (never rewrites history).
  const response = await fetch(`/api/sessions/${sessionId}/revert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commit }),
  });
  if (!response.ok) {
    throw new Error(`failed to revert: ${response.status}`);
  }
  return response.json();
}

export async function hideHistoryEntry(sessionId: string, commit: string): Promise<void> {
  // POST /api/sessions/{id}/history/{hash}/hide -> a display-only filter,
  // nothing in git is rewritten. Fails with 400 if commit is the current
  // (HEAD) commit — the sidebar always needs one visible "Current" entry.
  const response = await fetch(`/api/sessions/${sessionId}/history/${commit}/hide`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`failed to hide history entry: ${response.status}`);
  }
}

export async function getThumbnails(sessionId: string): Promise<{ filenames: string[] }> {
  // GET /api/sessions/{id}/thumbnails -> re-renders the current on-disk
  // deck and returns the resulting filenames, for the thumbnail rail.
  const response = await fetch(`/api/sessions/${sessionId}/thumbnails`);
  if (!response.ok) {
    throw new Error(`failed to load thumbnails: ${response.status}`);
  }
  return response.json();
}
