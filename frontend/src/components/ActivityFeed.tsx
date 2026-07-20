import { useState } from "react";
import type { FeedEntry } from "../hooks/useSessionSocket";
import { ApprovalCard } from "./ApprovalCard";
import { QuestionCard } from "./QuestionCard";
import { CheckCircleIcon, ChevronRightIcon, FileIcon, SpinnerIcon, XIcon } from "./icons";

// Renders whatever useSessionSocket has already turned OpenCode's events
// into. This component never touches the websocket itself — approve/reject
// and question-answer clicks call back up to the parent's callbacks, wired
// to useSessionSocket's replyPermission/replyQuestion/rejectQuestion.
export function ActivityFeed({
  sessionId,
  entries,
  onReplyPermission,
  onReplyQuestion,
  onRejectQuestion,
  onRetryRender,
  showTyping,
}: {
  sessionId: string;
  entries: FeedEntry[];
  onReplyPermission: (requestId: string, reply: "once" | "reject") => void;
  onReplyQuestion: (requestId: string, answers: string[][]) => void;
  onRejectQuestion: (requestId: string) => void;
  onRetryRender: (requestId: string) => void;
  // True while a turn is in flight and hasn't produced anything needing the
  // user's attention yet (agent still thinking, running a slow command,
  // or the deck is being rendered for the review card) — the parent
  // computes this as busy && !hasPendingApproval, since once a review/
  // question/render-failed card exists, that card is the "what's next"
  // signal instead.
  showTyping: boolean;
}) {
  // Tool cards default collapsed — set of entry ids the user has expanded.
  // Lives here (not on the entry itself) since it's purely a display
  // preference, not something the backend or the hook needs to know about.
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const toggleTool = (id: string) =>
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-8">
      {entries.map((entry) => {
        if (entry.kind === "text" && entry.role === "user") {
          return <UserMessage key={entry.id} text={entry.text} attachments={entry.attachments} />;
        }

        if (entry.kind === "text") {
          return <AssistantMessage key={entry.id} text={entry.text} />;
        }

        if (entry.kind === "status") {
          return <StatusLine key={entry.id} text={entry.text} />;
        }

        if (entry.kind === "tool") {
          return (
            <ToolCard
              key={entry.id}
              tool={entry.tool}
              target={entry.target}
              status={entry.status}
              expanded={expandedTools.has(entry.id)}
              onToggle={() => toggleTool(entry.id)}
            />
          );
        }

        if (entry.kind === "question") {
          return (
            <QuestionCard
              key={entry.id}
              questions={entry.questions}
              resolved={entry.resolved}
              onSubmit={(answers) => onReplyQuestion(entry.requestId, answers)}
              onReject={() => onRejectQuestion(entry.requestId)}
            />
          );
        }

        if (entry.kind === "render_failed") {
          return (
            <RenderFailedCard
              key={entry.id}
              error={entry.error}
              resolved={entry.resolved}
              onRetry={() => onRetryRender(entry.requestId)}
            />
          );
        }

        return (
          <ApprovalCard
            key={entry.id}
            sessionId={sessionId}
            summary={entry.summary}
            preview={entry.preview}
            resolved={entry.resolved}
            onApprove={() => onReplyPermission(entry.requestId, "once")}
            onReject={() => onReplyPermission(entry.requestId, "reject")}
          />
        );
      })}
      {showTyping && <TypingIndicator />}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 self-start px-1 py-1">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" />
    </div>
  );
}

function UserMessage({ text, attachments }: { text: string; attachments?: string[] }) {
  return (
    <div className="max-w-[70%] self-end rounded-2xl bg-surface px-5 py-3.5">
      {attachments && attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((name) => (
            <div
              key={name}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-2 py-1 text-xs text-ink"
            >
              <FileIcon className="shrink-0 text-muted" />
              <span className="max-w-[10rem] truncate">{name}</span>
            </div>
          ))}
        </div>
      )}
      <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{text}</p>
    </div>
  );
}

function AssistantMessage({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p className="whitespace-pre-wrap font-serif text-[17px] leading-relaxed text-ink">{text}</p>
  );
}

function StatusLine({ text }: { text: string }) {
  return <p className="text-sm text-muted">{text}</p>;
}

const TOOL_LABELS: Record<string, string> = {
  read: "Read a file",
  write: "Write a file",
  edit: "Edit a file",
  bash: "Run a command",
};

// A bash/read/write/edit tool call, collapsed by default — the raw command
// or file path is exactly the kind of internal detail that fills up the
// feed without helping most of the time (matches the collapsed-by-default
// tool-call pattern from Claude Code's own chat UI). Expanding shows the
// actual target and a status line beneath a short connector, same idea as
// that UI's expanded state.
function ToolCard({
  tool,
  target,
  status,
  expanded,
  onToggle,
}: {
  tool: string;
  target: string;
  status: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const label = TOOL_LABELS[tool] ?? `Run ${tool}`;
  const isFile = tool === "read" || tool === "write" || tool === "edit";
  const filename = isFile ? target.split("/").pop() ?? target : target;
  const extension = isFile && filename.includes(".") ? filename.split(".").pop()!.toUpperCase() : null;

  return (
    <div className="self-start">
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 text-sm font-medium text-ink hover:text-accent"
      >
        <ChevronRightIcon expanded={expanded} className="text-muted" />
        {label}
      </button>

      {expanded && (
        <div className="ml-1.5 mt-2 flex flex-col">
          <div className="flex items-center gap-2 pb-2 text-sm text-ink">
            {isFile ? (
              <>
                <FileIcon className="shrink-0 text-muted" />
                <span className="truncate">{filename}</span>
                {extension && (
                  <span className="rounded border border-border px-1 text-[10px] text-muted">
                    {extension}
                  </span>
                )}
              </>
            ) : (
              <code className="whitespace-pre-wrap break-all rounded-md bg-surface px-2 py-1 text-xs text-ink">
                {target}
              </code>
            )}
          </div>
          <div className="ml-[6.5px] h-3 w-px bg-border" />
          <div className="flex items-center gap-2 pt-2 text-xs text-muted">
            {status === "error" ? (
              <>
                <XIcon className="shrink-0 text-red-500" />
                Failed
              </>
            ) : status === "completed" ? (
              <>
                <CheckCircleIcon className="shrink-0" />
                Done
              </>
            ) : (
              <>
                <SpinnerIcon className="shrink-0" />
                Running…
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// The agent's edit already succeeded and is sitting in deck_copy.pptx —
// only rendering it for review failed (e.g. a soffice hiccup). Distinct
// from ApprovalCard on purpose: there's nothing to approve/reject yet,
// just a render to retry — retrying doesn't redo the agent's work.
function RenderFailedCard({
  error,
  resolved,
  onRetry,
}: {
  error: string;
  resolved?: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="self-start rounded-2xl border border-red-200 bg-red-50 p-5">
      <p className="text-sm font-medium text-ink">Failed to render the review preview</p>
      <p className="mt-1 text-sm text-muted">{error}</p>
      <p className="mt-2 text-xs text-muted">
        Your edit was applied — only generating the before/after preview failed.
      </p>
      {resolved ? (
        <p className="mt-4 text-sm text-muted">Retried — review card above.</p>
      ) : (
        <button
          onClick={onRetry}
          className="mt-4 rounded-md bg-accent px-3.5 py-1.5 text-sm text-white hover:bg-accent-hover"
        >
          Retry rendering
        </button>
      )}
    </div>
  );
}
