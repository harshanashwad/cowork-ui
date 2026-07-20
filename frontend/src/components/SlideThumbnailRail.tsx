import { useEffect, useState } from "react";
import { exportUrl, getThumbnails } from "../api";
import { SpinnerIcon } from "./icons";

// Spatial navigation within the current deck's content — unrelated to
// version history. Always shows whatever's currently on disk; refreshKey
// (bumped by the parent after an approved turn or a revert) is the only
// way this refetches, since nothing here tracks deck state itself.
//
// uploading is set by the parent the moment a .pptx is picked (before the
// upload request even lands) and cleared once this component's own fetch —
// triggered by the refreshKey bump that follows a successful upload —
// actually resolves. The gap between those two points is exactly the
// "nothing on screen, was that received?" window the loading bar covers:
// import + commit on the backend, then the real cost, LibreOffice
// rendering the deck to PNGs for the first time.
export function SlideThumbnailRail({
  sessionId,
  refreshKey,
  uploading,
  onUploadSettled,
}: {
  sessionId: string;
  refreshKey: number;
  uploading: boolean;
  onUploadSettled: () => void;
}) {
  const [filenames, setFilenames] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  // Cache-busting version actually reflected in rendered <img> src's. Set
  // to refreshKey only once the fetch for that refreshKey resolves — NOT
  // read directly off the refreshKey prop. render_deck() is what regenerates
  // the on-disk PNG, and it only runs inside the getThumbnails() call below;
  // bumping the query param the instant refreshKey changes (before that call
  // finishes) fired the browser's image request while the file on disk was
  // still the old version, so it rendered the stale slide right after an
  // approve — confirmed directly: the "new" URL's response bytes were
  // byte-identical to the pre-approval image, while the file inspected on
  // disk moments later was already correct. Gating on fetch completion
  // guarantees the file is actually done being rewritten first.
  const [renderedVersion, setRenderedVersion] = useState(refreshKey);

  useEffect(() => {
    getThumbnails(sessionId)
      .then((res) => {
        setFilenames(res.filenames);
        setRenderedVersion(refreshKey);
      })
      .catch(() => {})
      .finally(onUploadSettled);
    // onUploadSettled is a plain state setter from the parent — stable
    // across renders, deliberately left out of the dependency list so this
    // only re-fetches on an actual sessionId/refreshKey change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, refreshKey]);

  if (uploading) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-canvas px-6 py-3 text-xs font-medium text-muted">
        <SpinnerIcon className="h-4 w-4 shrink-0" />
        Uploading and rendering your slides…
      </div>
    );
  }

  if (filenames.length === 0) return null;

  // render_deck() always writes the same filenames ("slide.001.png", ...)
  // for the thumbnail rail specifically, unlike the review cards' unique
  // per-turn names — so the <img src> string never changes between renders
  // and the browser never re-fetches at all, no matter what cache headers
  // say, since no new request is even issued. ?v= forces a new URL every
  // time the deck might have changed — using renderedVersion, not refreshKey
  // directly, so that new URL is only ever requested once the matching
  // render has actually finished (see the state comment above).
  const renderUrl = (filename: string) => `/api/sessions/${sessionId}/render/${filename}?v=${renderedVersion}`;

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
