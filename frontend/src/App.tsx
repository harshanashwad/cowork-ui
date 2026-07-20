import { useEffect, useRef, useState } from "react";
import { createSession } from "./api";
import { useSessionSocket } from "./hooks/useSessionSocket";
import { ChatInput } from "./components/ChatInput";
import { ActivityFeed } from "./components/ActivityFeed";
import { Sidebar } from "./components/Sidebar";
import { SlideThumbnailRail } from "./components/SlideThumbnailRail";
import { VersionHistorySidebar } from "./components/VersionHistorySidebar";

function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Bumped whenever a session is created, so Sidebar re-fetches "Recents".
  const [sessionListVersion, setSessionListVersion] = useState(0);
  const requested = useRef(false);

  useEffect(() => {
    // StrictMode runs effects twice in dev (mount, cleanup, mount again) to
    // surface bugs like this one — without the guard, that means two real
    // POST /api/sessions calls and an orphaned workdir every page load.
    if (requested.current) return;
    requested.current = true;
    startNewSession();
  }, []);

  function startNewSession() {
    createSession().then((session) => {
      setSessionId(session.id);
      setSessionListVersion((v) => v + 1);
    });
  }

  function handleSessionDeleted(deletedId: string) {
    setSessionListVersion((v) => v + 1);
    // If the deleted session was the one on screen, it needs to be
    // replaced with something — there's no "no session" state in this app.
    if (deletedId === sessionId) {
      startNewSession();
    }
  }

  if (!sessionId) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas text-sm text-muted">
        Starting session...
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-canvas">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
        activeSessionId={sessionId}
        onSelectSession={setSessionId}
        onNewSession={startNewSession}
        onSessionDeleted={handleSessionDeleted}
        refreshKey={sessionListVersion}
      />
      {/* Keyed by sessionId: switching sessions unmounts/remounts this
          whole subtree, so useSessionSocket's state (entries, busy, the
          socket itself) resets cleanly instead of briefly rendering the
          previous session's entries against the new session's id. */}
      <ChatSession key={sessionId} sessionId={sessionId} />
    </div>
  );
}

function ChatSession({ sessionId }: { sessionId: string }) {
  const { entries, busy, sendMessage, replyPermission, replyQuestion, rejectQuestion, retryRender } =
    useSessionSocket(sessionId);
  const [historyCollapsed, setHistoryCollapsed] = useState(true); // closed by default — not needed during normal editing
  // Bumped after an approved turn or a revert, so the thumbnail rail
  // re-renders the current deck instead of showing stale slides.
  const [deckVersion, setDeckVersion] = useState(0);
  // Set the instant a .pptx is picked, cleared once SlideThumbnailRail's
  // own fetch (triggered by the deckVersion bump below) resolves — spans
  // the upload request itself plus the first-render cost after it.
  const [deckUploading, setDeckUploading] = useState(false);

  const approvedCount = entries.filter((e) => e.kind === "permission" && e.resolved === "once").length;
  useEffect(() => {
    setDeckVersion((v) => v + 1);
  }, [approvedCount]);

  // A pending bash permission, an unresolved turn.review card, an
  // unanswered question, or a render that failed and hasn't been retried
  // yet all mean "don't send another message yet" — busy alone only
  // covers the window before any of those exists (agent still thinking,
  // nothing asked yet).
  const hasPendingApproval = entries.some(
    (e) =>
      (e.kind === "permission" || e.kind === "question" || e.kind === "render_failed") &&
      !e.resolved
  );

  return (
    <>
      <main className="flex min-w-0 flex-1 flex-col">
        <SlideThumbnailRail
          sessionId={sessionId}
          refreshKey={deckVersion}
          uploading={deckUploading}
          onUploadSettled={() => setDeckUploading(false)}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ActivityFeed
            sessionId={sessionId}
            entries={entries}
            onReplyPermission={replyPermission}
            onReplyQuestion={replyQuestion}
            onRejectQuestion={rejectQuestion}
            onRetryRender={retryRender}
            showTyping={busy && !hasPendingApproval}
          />
        </div>
        <div className="mx-auto w-full max-w-3xl px-6 pb-6">
          <ChatInput
            sessionId={sessionId}
            onSend={sendMessage}
            onDeckUploadStart={() => setDeckUploading(true)}
            onDeckImported={() => setDeckVersion((v) => v + 1)}
            disabled={busy || hasPendingApproval}
          />
        </div>
      </main>
      <VersionHistorySidebar
        sessionId={sessionId}
        collapsed={historyCollapsed}
        onToggleCollapsed={() => setHistoryCollapsed((v) => !v)}
        refreshKey={deckVersion}
        onReverted={() => setDeckVersion((v) => v + 1)}
      />
    </>
  );
}

export default App;
