import { useEffect, useState } from "react";
import { getHistory, hideHistoryEntry, revertTo, type HistoryEntry } from "../api";
import { ChevronRightIcon, HistoryIcon } from "./icons";

// Whole-deck commit history only — no per-slide detail anywhere here.
// Revert restores the whole file to a past commit and records that as a
// new commit (see artifact.revert_to), it never rewrites git history.
export function VersionHistorySidebar({
  sessionId,
  collapsed,
  onToggleCollapsed,
  refreshKey,
  onReverted,
}: {
  sessionId: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  // Bumped by the parent (ChatSession) after any approved turn, not just
  // reverts here — without this, an edit approved elsewhere in the app
  // never shows up in this list until something else happens to trigger it.
  refreshKey: number;
  onReverted: () => void;
}) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [reverting, setReverting] = useState<string | null>(null);

  useEffect(() => {
    getHistory(sessionId).then(setEntries).catch(() => {});
  }, [sessionId, refreshKey]);

  const handleRevert = async (hash: string) => {
    setReverting(hash);
    try {
      await revertTo(sessionId, hash);
      onReverted(); // bumps the parent's shared deckVersion, which flows back as our own refreshKey
    } finally {
      setReverting(null);
    }
  };

  const handleHide = async (hash: string) => {
    // Optimistic: drop it from the visible list right away rather than
    // waiting on a refetch — the backend filter (session.hidden_commits)
    // is already updated by the time this resolves, so a later refresh
    // (refreshKey bump) would agree anyway.
    await hideHistoryEntry(sessionId, hash);
    setEntries((prev) => prev.filter((entry) => entry.hash !== hash));
  };

  return (
    <aside
      className={`flex h-full flex-col border-l border-border bg-canvas transition-all duration-200 ${
        collapsed ? "w-11" : "w-72"
      }`}
    >
      <button
        onClick={onToggleCollapsed}
        className="flex items-center gap-1.5 px-3 py-4 text-xs font-medium text-muted hover:text-ink"
        aria-label="Toggle version history"
      >
        {/* The clock is the "what this button is" affordance, kept visible
            collapsed too. The chevron only joins it expanded — collapsed,
            the narrow w-11 rail doesn't have room for both without
            overflowing. */}
        <HistoryIcon className="h-4 w-4 shrink-0" />
        {!collapsed && (
          <>
            <ChevronRightIcon expanded={collapsed} className="h-4 w-4 shrink-0" />
            Version history
          </>
        )}
      </button>

      {!collapsed && (
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4">
          {entries.map((entry, index) => (
            <div key={entry.hash} className="rounded-md border border-border bg-white px-3 py-2">
              <p className="truncate text-sm text-ink">{entry.message}</p>
              <div className="mt-1.5 flex items-center justify-between">
                <span className="text-xs text-muted">{entry.hash.slice(0, 7)}</span>
                {index === 0 ? (
                  <span className="text-xs text-muted">Current</span>
                ) : (
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleRevert(entry.hash)}
                      disabled={reverting !== null}
                      className="text-xs font-medium text-accent hover:text-accent-hover disabled:opacity-50"
                    >
                      {reverting === entry.hash ? "Reverting..." : "Revert to here"}
                    </button>
                    <button
                      onClick={() => handleHide(entry.hash)}
                      disabled={reverting !== null}
                      className="text-xs font-medium text-muted hover:text-ink disabled:opacity-50"
                    >
                      Hide
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
