import { useEffect, useState } from "react";
import { getThumbnails } from "../api";

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

  const renderUrl = (filename: string) => `/api/sessions/${sessionId}/render/${filename}`;

  return (
    <>
      <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-border bg-canvas px-6 py-3">
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
