// The one place in the app that owns the websocket connection to the
// backend at /ws/{sessionId} (proxied by Vite to the FastAPI backend on
// :8000). Every chat message, every live agent status update, and every
// permission prompt flows through this single socket — nothing else in
// the frontend opens its own connection.

// Messages coming in from the websocket server: OpenCode's raw event stream
//  These events are turned into a flat list of feed entries a chat UI can render directly

// Messages going out to the websocket server: (sendMessage, replyPermission)

import { useCallback, useEffect, useRef, useState } from "react";
import { getMessages } from "../api";

export type PermissionPreview = { before: string[]; after: string[] };

export type FeedEntry =
  | { kind: "text"; id: string; role: "user" | "assistant"; text: string; attachments?: string[] }
  | { kind: "status"; id: string; text: string }
  | {
      kind: "permission";
      id: string;
      requestId: string;
      summary: string;
      preview?: PermissionPreview;
      resolved?: string;
    };

export function useSessionSocket(sessionId: string) {
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  // True from the moment a message is sent until the backend confirms the
  // turn is done (see "app.message.result" below). A turn that produced a
  // deck change stays gated further by the unresolved review entry itself
  // (App.tsx also checks entries for that) — busy alone only covers the
  // window before that entry even exists yet.
  const [busy, setBusy] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  // Attachment lists for messages that have been sent but whose user-role
  // text entry hasn't arrived from the server yet — popped in FIFO order
  // as those entries get created. See sendMessage/handleEvent.
  const pendingAttachmentsRef = useRef<string[][]>([]);

  useEffect(() => {
    // App.tsx mounts one ChatSession per sessionId (keyed), so this hook's
    // whole instance — entries, busy, pendingAttachmentsRef — is fresh on
    // every session switch; nothing here needs to reset itself manually.
    let cancelled = false;
    let socket: WebSocket | null = null;

    // messageID -> role, so a later text part (which has no role of its
    // own) can be attributed to "user" or "assistant" correctly.
    const roleByMessageId = new Map<string, "user" | "assistant">();

    (async () => {
      // Replay this session's real transcript (from OpenCode's own message
      // history) through the same handler live events go through, before
      // opening the live connection — otherwise switching back to a past
      // session shows a blank chat even though the conversation happened.
      // Turn.review/approval cards don't come back this way since they're
      // our own transient events, never stored by OpenCode — an old,
      // already-resolved turn just won't show its review card again.
      const history = await getMessages(sessionId).catch(() => []);
      if (cancelled) return;

      for (const message of history) {
        if (message.info?.role) {
          handleEvent(
            { type: "message.updated", properties: { info: message.info } },
            setEntries, setBusy, roleByMessageId, pendingAttachmentsRef
          );
        }
        for (const part of message.parts ?? []) {
          handleEvent(
            { type: "message.part.updated", properties: { part } },
            setEntries, setBusy, roleByMessageId, pendingAttachmentsRef
          );
        }
      }
      if (cancelled) return;

      socket = new WebSocket(`ws://${location.host}/ws/${sessionId}`);
      socketRef.current = socket;
      socket.onmessage = (raw) => {
        handleEvent(JSON.parse(raw.data), setEntries, setBusy, roleByMessageId, pendingAttachmentsRef);
      };
    })();

    return () => {
      cancelled = true;
      socket?.close();
      socketRef.current = null;
    };
  }, [sessionId]);

  const sendMessage = useCallback((text: string, attachments: string[] = []) => {
    setBusy(true);
    if (attachments.length > 0) {
      pendingAttachmentsRef.current.push(attachments);
    }
    // -> backend: {"type": "message", "text": ..., "attachments": [...]} over the websocket
    socketRef.current?.send(JSON.stringify({ type: "message", text, attachments }));
  }, []);

  const replyPermission = useCallback((requestId: string, reply: "once" | "reject") => {
    // -> backend: {"type": "permission_reply", ...} over the websocket.
    // Used both for real OpenCode permissions (bash) and for approving or
    // rejecting the end-of-turn review card — the backend tells them apart.
    socketRef.current?.send(
      JSON.stringify({ type: "permission_reply", request_id: requestId, reply })
    );
  }, []);

  return { entries, busy, sendMessage, replyPermission };
}

// --- raw OpenCode event -> feed entry ---------------------------------

function handleEvent(
  event: any,
  setEntries: React.Dispatch<React.SetStateAction<FeedEntry[]>>,
  setBusy: React.Dispatch<React.SetStateAction<boolean>>,
  roleByMessageId: Map<string, "user" | "assistant">,
  pendingAttachmentsRef: { current: string[][] }
) {
  const props = event.properties ?? {};

  if (event.type === "message.updated" && props.info?.role) {
    roleByMessageId.set(props.info.id, props.info.role);
    return;
  }

  if (event.type === "message.part.updated") {
    const part = props.part;
    if (part.type === "text") {
      const role = roleByMessageId.get(part.messageID) ?? "assistant";
      // User text parts arrive fully formed in one shot (no deltas), so
      // this fires exactly once per sent message — safe to pop here.
      const attachments = role === "user" ? pendingAttachmentsRef.current.shift() : undefined;
      upsert(setEntries, part.id, {
        kind: "text",
        id: part.id,
        role,
        text: part.text ?? "",
        attachments,
      });
    } else if (part.type === "tool") {
      upsert(setEntries, part.id, { kind: "status", id: part.id, text: describeTool(part) });
    }
    return;
  }

  if (event.type === "message.part.delta" && props.field === "text") {
    setEntries((prev) =>
      prev.map((entry) =>
        entry.kind === "text" && entry.id === props.partID
          ? { ...entry, text: entry.text + props.delta }
          : entry
      )
    );
    return;
  }

  if (event.type === "permission.asked") {
    // Only bash commands still go through OpenCode's real permission ask —
    // edits are auto-allowed/denied now (see sessions.py), so this never
    // carries a before/after preview.
    setEntries((prev) => [
      ...prev,
      {
        kind: "permission",
        id: props.id,
        requestId: props.id,
        summary: `${props.permission}: ${(props.patterns ?? []).join(", ")}`,
      },
    ]);
    return;
  }

  if (event.type === "turn.review") {
    // The backend's own synthetic review card for a finished turn — not
    // something OpenCode sent. Shaped the same as a permission entry so it
    // renders through the same ApprovalCard with no extra UI code.
    setEntries((prev) => [
      ...prev,
      {
        kind: "permission",
        id: props.id,
        requestId: props.id,
        summary: props.summary,
        preview: props.preview,
      },
    ]);
    return;
  }

  if (event.type === "permission.replied") {
    // Resolves either a real OpenCode permission or a turn.review card —
    // both look the same here, matched purely by requestId.
    setEntries((prev) =>
      prev.map((entry) =>
        entry.kind === "permission" && entry.requestId === props.requestID
          ? { ...entry, resolved: props.reply }
          : entry
      )
    );
    return;
  }

  if (event.type === "app.message.result") {
    // The turn is done. If it produced a review card, that card (added
    // just before this event, per ws.py's send order) keeps further
    // messages blocked via the pending-approval check in App.tsx — this
    // only clears the "waiting on the agent at all" half of that gate.
    setBusy(false);
    return;
  }

  if (event.type === "turn.failed") {
    setBusy(false);
    setEntries((prev) => [
      ...prev,
      { kind: "status", id: `error-${Date.now()}`, text: `Turn failed: ${event.error}` },
    ]);
    return;
  }
}

function upsert(
  setEntries: React.Dispatch<React.SetStateAction<FeedEntry[]>>,
  id: string,
  entry: FeedEntry
) {
  setEntries((prev) => {
    const index = prev.findIndex((e) => e.id === id);
    if (index === -1) return [...prev, entry];
    const next = [...prev];
    next[index] = entry;
    return next;
  });
}

const TOOL_VERBS: Record<string, string> = {
  read: "Reading",
  write: "Editing",
  edit: "Editing",
  bash: "Running",
};

function describeTool(part: any): string {
  const verb = TOOL_VERBS[part.tool] ?? part.tool;
  const target = part.state?.input?.filePath ?? part.state?.input?.command ?? "";
  const status = part.state?.status ?? "";
  return `${verb} ${target} (${status})`.trim();
}
