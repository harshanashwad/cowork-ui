import type { PermissionPreview } from "../hooks/useSessionSocket";

// Renders one permission request. If the backend attached a before/after
// preview (a finished turn's deck changes), shows the two rendered slide
// sets side by side; otherwise (a bash command) falls back to plain text.
export function ApprovalCard({
  sessionId,
  summary,
  preview,
  resolved,
  onApprove,
  onReject,
}: {
  sessionId: string;
  summary: string;
  preview?: PermissionPreview;
  resolved?: string;
  onApprove: () => void;
  onReject: () => void;
}) {
  const renderUrl = (filename: string) =>
    // GET /api/sessions/{sessionId}/render/{filename} -> FastAPI backend
    `/api/sessions/${sessionId}/render/${filename}`;

  return (
    <div className="self-start rounded-2xl border border-border bg-white p-5">
      <p className="text-sm font-medium text-ink">{summary}</p>

      {preview && (
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Before</p>
            <div className="flex flex-col gap-2 overflow-hidden rounded-lg border border-border">
              {preview.before.map((filename) => (
                <img key={filename} src={renderUrl(filename)} alt="before" className="w-full" />
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">After</p>
            <div className="flex flex-col gap-2 overflow-hidden rounded-lg border border-border">
              {preview.after.map((filename) => (
                <img key={filename} src={renderUrl(filename)} alt="after" className="w-full" />
              ))}
            </div>
          </div>
        </div>
      )}

      {resolved ? (
        <p className="mt-4 text-sm text-muted">
          {resolved === "reject" ? "Rejected" : "Approved"}
        </p>
      ) : (
        <div className="mt-4 flex gap-2">
          <button
            onClick={onApprove}
            className="rounded-md bg-accent px-3.5 py-1.5 text-sm text-white hover:bg-accent-hover"
          >
            Approve
          </button>
          <button
            onClick={onReject}
            className="rounded-md border border-border px-3.5 py-1.5 text-sm text-ink hover:bg-surface"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
