import type { FeedEntry } from "../hooks/useSessionSocket";
import { ApprovalCard } from "./ApprovalCard";
import { QuestionCard } from "./QuestionCard";
import { FileIcon } from "./icons";

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
}: {
  sessionId: string;
  entries: FeedEntry[];
  onReplyPermission: (requestId: string, reply: "once" | "reject") => void;
  onReplyQuestion: (requestId: string, answers: string[][]) => void;
  onRejectQuestion: (requestId: string) => void;
  onRetryRender: (requestId: string) => void;
}) {
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
