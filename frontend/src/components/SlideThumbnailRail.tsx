import { useEffect, useState } from "react";
import { exportUrl, getThumbnails } from "../api";

// Spatial navigation within the current deck's content — unrelated to
// version history. Always shows whatever's currently on disk; refreshKey
// (bumped by the parent after an approved turn or a revert) is the only
// way this refetches, since nothing here tracks deck state itself.
export function SlideThumbnailRail({ sessionId, refreshKey }: { sessionId: string; refreshKey: number }) {
  const [filenames, setFilenames] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    getThumbnails(sessionId)
      .then((res) => setFilenames(res.filenames))
      .catch(() => {});
  }, [sessionId, refreshKey]);

  if (filenames.length === 0) return null;

  // render_deck() always writes the same filenames ("slide.001.png", ...)
  // for the thumbnail rail specifically, unlike the review cards' unique
  // per-turn names — so the <img src> string never changes between renders
  // and the browser never re-fetches at all, no matter what cache headers
  // say, since no new request is even issued. ?v= forces a new URL every
  // time the deck might have changed.
  const renderUrl = (filename: string) => `/api/sessions/${sessionId}/render/${filename}?v=${refreshKey}`;

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-canvas px-6 py-3">
        <div className="flex gap-2 overflow-x-auto">
          {filenames.map((name, index) => (
            <button
              key={name}
              onClick={() => setSelected(name)}
              className="shrink-0 overflow-hidden rounded-md border border-border transition-shadow hover:shadow-md"
            >
              <img src={renderUrl(name)} alt={`Slide ${index + 1}`} className="h-16 w-auto" />
            </button>
          ))}
        </div>
        {/* Lives here for layout convenience (this is the only persistent
            chrome around "the current deck") — not conceptually part of
            thumbnail navigation. */}
        <a
          href={exportUrl(sessionId)}
          download
          className="shrink-0 text-xs font-medium text-muted hover:text-ink"
        >
          Export .pptx
        </a>
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-10"
          onClick={() => setSelected(null)}
        >
          <img
            src={renderUrl(selected)}
            alt="Slide preview"
            className="max-h-full max-w-full rounded-lg shadow-xl"
          />
        </div>
      )}
    </>
  );
}
