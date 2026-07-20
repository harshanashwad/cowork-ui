import { useEffect, useState } from "react";
import { deleteSession, listSessions, type SessionInfo } from "../api";
import { ChevronRightIcon, PlusIcon, SidebarToggleIcon, TrashIcon } from "./icons";

// The only REST calls this component makes directly: GET /api/sessions (to
// populate "Recents") and DELETE /api/sessions/{id}. Session creation and
// switching are handled by the parent (App.tsx already owns which session
// is active). Loading a presentation happens inside a session via the chat
// input's attach button, not here — see ChatInput.tsx.
export function Sidebar({
  collapsed,
  onToggleCollapsed,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onSessionDeleted,
  refreshKey,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onSessionDeleted: (id: string) => void;
  refreshKey: number;
}) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [recentsExpanded, setRecentsExpanded] = useState(true);
  // At most one confirm popover open at a time — clicking a different
  // session's trash icon just moves it there.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    listSessions().then(setSessions).catch(() => {});
  }, [refreshKey]);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      onSessionDeleted(id);
    } catch {
      // Most likely a 409 (a turn is in progress for that session) — leave
      // the confirm box up rather than pretending it worked.
    } finally {
      setDeletingId(null);
      setConfirmingId(null);
    }
  };

  return (
    <aside
      className={`flex h-full flex-col border-r border-border bg-canvas transition-all duration-200 ${
        collapsed ? "w-14" : "w-64"
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-4">
        <button
          className="shrink-0 rounded-md p-1.5 text-muted hover:bg-surface hover:text-ink"
          onClick={onToggleCollapsed}
          aria-label="Toggle sidebar"
        >
          <SidebarToggleIcon />
        </button>
        {/* Only shown expanded — collapsed, the toggle icon above is the
            whole footprint, same as any icon-only rail. */}
        {!collapsed && (
          <span className="truncate text-sm font-semibold tracking-tight text-ink">
            ppt cowork
          </span>
        )}
      </div>

      {!collapsed && (
        <div className="flex min-h-0 flex-1 flex-col px-3">
          <button
            className="mb-4 flex items-center gap-2 self-start rounded-md px-2.5 py-1.5 text-sm text-ink hover:bg-surface"
            onClick={onNewSession}
          >
            <PlusIcon />
            New
          </button>

          <button
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted hover:text-ink"
            onClick={() => setRecentsExpanded((v) => !v)}
          >
            <ChevronRightIcon expanded={recentsExpanded} />
            Recents
          </button>

          <div
            className={`overflow-hidden transition-all duration-200 ${
              recentsExpanded ? "max-h-[60vh] opacity-100" : "max-h-0 opacity-0"
            }`}
          >
            <div className="mt-1 flex flex-col gap-0.5 overflow-y-auto pb-2">
              {sessions.map((s) =>
                confirmingId === s.id ? (
                  // Inline, not a floating popover — a popover positioned
                  // below the row would get clipped by this list's own
                  // overflow-y-auto (and the collapse wrapper's
                  // overflow-hidden above it), so it replaces the row's
                  // content in place instead.
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-2 rounded-md bg-surface py-1.5 pl-2.5 pr-2"
                  >
                    <span className="truncate text-xs text-ink">Delete this session?</span>
                    <div className="flex shrink-0 items-center gap-2.5">
                      <button
                        onClick={() => setConfirmingId(null)}
                        className="text-xs font-medium text-muted hover:text-ink"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleDelete(s.id)}
                        disabled={deletingId === s.id}
                        className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                      >
                        {deletingId === s.id ? "…" : "Delete"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div key={s.id} className="group relative">
                    <button
                      onClick={() => onSelectSession(s.id)}
                      className={`w-full truncate rounded-md py-1.5 pl-2.5 pr-7 text-left text-sm transition-colors ${
                        s.id === activeSessionId
                          ? "bg-surface text-ink"
                          : "text-muted hover:bg-surface hover:text-ink group-hover:bg-surface group-hover:text-ink"
                      }`}
                    >
                      {s.title}
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmingId(s.id);
                      }}
                      aria-label={`Delete ${s.title}`}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted opacity-0 hover:text-red-600 group-hover:opacity-100"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
