import { useEffect, useState } from "react";
import { listSessions, type SessionInfo } from "../api";
import { ChevronRightIcon, PlusIcon, SidebarToggleIcon } from "./icons";

// The only REST call this component makes directly: GET /api/sessions,
// to populate "Recents". Session creation and switching are handled by
// the parent (App.tsx already owns which session is active).
export function Sidebar({
  collapsed,
  onToggleCollapsed,
  activeSessionId,
  onSelectSession,
  onNewSession,
  refreshKey,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  refreshKey: number;
}) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [recentsExpanded, setRecentsExpanded] = useState(true);

  useEffect(() => {
    listSessions().then(setSessions).catch(() => {});
  }, [refreshKey]);

  return (
    <aside
      className={`flex h-full flex-col border-r border-border bg-canvas transition-all duration-200 ${
        collapsed ? "w-14" : "w-64"
      }`}
    >
      <div className="flex items-center px-3 py-4">
        <button
          className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-ink"
          onClick={onToggleCollapsed}
          aria-label="Toggle sidebar"
        >
          <SidebarToggleIcon />
        </button>
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
              {sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => onSelectSession(s.id)}
                  className={`truncate rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                    s.id === activeSessionId
                      ? "bg-surface text-ink"
                      : "text-muted hover:bg-surface hover:text-ink"
                  }`}
                >
                  {s.title}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
