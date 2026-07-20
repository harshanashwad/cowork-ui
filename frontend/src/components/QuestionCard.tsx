import { useState } from "react";
import type { QuestionInfo } from "../hooks/useSessionSocket";

// The agent asking the user something mid-turn — not a permission, not a
// deck review. One card can carry several questions at once; answers are
// submitted together as one array (one entry per question, in order).
export function QuestionCard({
  questions,
  resolved,
  onSubmit,
  onReject,
}: {
  questions: QuestionInfo[];
  resolved?: boolean;
  onSubmit: (answers: string[][]) => void;
  onReject: () => void;
}) {
  const [selected, setSelected] = useState<string[][]>(questions.map(() => []));

  const toggle = (questionIndex: number, label: string, multiple?: boolean) => {
    setSelected((prev) => {
      const next = [...prev];
      const current = next[questionIndex];
      if (multiple) {
        next[questionIndex] = current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label];
      } else {
        next[questionIndex] = [label];
      }
      return next;
    });
  };

  if (resolved) {
    return (
      <div className="self-start rounded-2xl border border-border bg-white p-5">
        <p className="text-sm text-muted">Question answered</p>
      </div>
    );
  }

  return (
    <div className="self-start rounded-2xl border border-border bg-white p-5">
      <div className="flex flex-col gap-4">
        {questions.map((q, questionIndex) => (
          <div key={questionIndex}>
            <p className="text-sm font-medium text-ink">{q.question}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {q.options.map((option) => (
                <button
                  key={option.label}
                  title={option.description}
                  onClick={() => toggle(questionIndex, option.label, q.multiple)}
                  className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    selected[questionIndex].includes(option.label)
                      ? "border-accent bg-accent text-white"
                      : "border-border text-ink hover:bg-surface"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => onSubmit(selected)}
          disabled={selected.some((a) => a.length === 0)}
          className="rounded-md bg-accent px-3.5 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
        >
          Submit
        </button>
        <button
          onClick={onReject}
          className="rounded-md border border-border px-3.5 py-1.5 text-sm text-ink hover:bg-surface"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
