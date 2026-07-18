import type { FeedEntry } from "../hooks/useSessionSocket";
import { ApprovalCard } from "./ApprovalCard";
import { FileIcon } from "./icons";

// Renders whatever useSessionSocket has already turned OpenCode's events
// into. This component never touches the websocket itself — approve/reject
// clicks call back up to onReplyPermission, which the parent wires to
// useSessionSocket's replyPermission.
export function ActivityFeed({
  sessionId,
  entries,
  onReplyPermission,
}: {
  sessionId: string;
  entries: FeedEntry[];
  onReplyPermission: (requestId: string, reply: "once" | "reject") => void;
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
