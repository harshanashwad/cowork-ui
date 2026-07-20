import { useLayoutEffect, useRef, useState } from "react";
import { uploadFile } from "../api";
import { FileIcon, PaperclipIcon, SendIcon, XIcon } from "./icons";

// Purely local state + two outbound calls: onSend (wired to
// useSessionSocket's sendMessage) and a direct upload REST call when a
// file is picked. disabled is set by the parent while a turn is in flight
// or its review card hasn't been approved/rejected yet.
//
// A .pptx picked here is special: the backend loads it as the deck itself
// (see api.ts's uploadFile), not a chat attachment, so it never becomes a
// chip — onDeckImported just tells the parent to refresh the thumbnail
// rail / version history instead.
export function ChatInput({
  sessionId,
  onSend,
  onDeckUploadStart,
  onDeckImported,
  disabled,
}: {
  sessionId: string;
  onSend: (text: string, attachments: string[]) => void;
  onDeckUploadStart: () => void;
  onDeckImported: () => void;
  disabled: boolean;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grows the textarea with content up to max-h-40 (see className
  // below), then lets the textarea's own scrollbar take over — re-measured
  // on every keystroke since height must shrink back down as text is
  // deleted, not just grow.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const canSend = !disabled && (text.trim().length > 0 || attachments.length > 0);

  const submit = () => {
    if (!canSend) return;
    onSend(text, attachments);
    setText("");
    setAttachments([]);
  };

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // lets the same file be picked again later
    if (!file) return;

    const isDeck = file.name.toLowerCase().endsWith(".pptx");
    if (isDeck) onDeckUploadStart(); // fires immediately, before the request even lands
    const { filename } = await uploadFile(sessionId, file);
    if (isDeck) {
      onDeckImported();
    } else {
      setAttachments((prev) => [...prev, filename]);
    }
  };

  return (
    <div
      className={`rounded-3xl border border-border px-4 pb-2.5 pt-3.5 shadow-sm transition-colors ${
        disabled ? "bg-surface" : "bg-white"
      }`}
    >
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((name) => (
            <FileChip key={name} name={name} onRemove={() => setAttachments((prev) => prev.filter((n) => n !== name))} />
          ))}
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        disabled={disabled}
        placeholder={disabled ? "Waiting on the agent or a pending review..." : "Write a message..."}
        rows={1}
        className="max-h-40 w-full resize-none overflow-y-auto bg-transparent text-sm text-ink placeholder-muted outline-none disabled:text-muted"
      />

      <div className="mt-2 flex items-center justify-between">
        <button
          className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-ink disabled:opacity-40"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          aria-label="Attach a file"
        >
          <PaperclipIcon />
        </button>
        <input ref={fileInputRef} type="file" hidden onChange={handleFilePick} />

        <button
          onClick={submit}
          disabled={!canSend}
          aria-label="Send message"
          className={`flex h-7 w-7 items-center justify-center rounded-full bg-accent text-white transition-all duration-150 hover:bg-accent-hover ${
            canSend ? "scale-100 opacity-100" : "pointer-events-none scale-75 opacity-0"
          }`}
        >
          <SendIcon />
        </button>
      </div>
    </div>
  );
}

function FileChip({ name, onRemove }: { name: string; onRemove: () => void }) {
  const extension = name.includes(".") ? name.split(".").pop()!.toUpperCase() : "FILE";
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1 text-xs text-ink">
      <FileIcon className="shrink-0 text-muted" />
      <span className="max-w-[10rem] truncate">{name}</span>
      <span className="rounded border border-border px-1 text-[10px] text-muted">{extension}</span>
      <button onClick={onRemove} className="text-muted hover:text-ink" aria-label={`Remove ${name}`}>
        <XIcon />
      </button>
    </div>
  );
}
