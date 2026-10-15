import { useState, type SetStateAction } from "react";
import type { CodeAnchor } from "./types";

interface Draft {
  body: string;
  selection: (CodeAnchor & { hunk: number }) | null;
}
const empty: Draft = { body: "", selection: null };

/** Keep a draft when switching files, versions or tabs; scoped to this person. */
export function useReviewDraft(key: string) {
  const storageKey = `nanohub:code-review-draft:${key}`;
  const [draft, setState] = useState<Draft>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (
        saved &&
        typeof saved.body === "string" &&
        saved.body.length <= 16000 &&
        saved.selection &&
        typeof saved.selection.path === "string" &&
        ["LEFT", "RIGHT"].includes(saved.selection.side) &&
        Number.isSafeInteger(saved.selection.hunk)
      )
        return saved;
    } catch {
      /* Storage is optional; the current draft still works. */
    }
    return empty;
  });
  const update = (next: SetStateAction<Draft>) =>
    setState((previous) => {
      const value = typeof next === "function" ? next(previous) : next;
      try {
        if (value.body || value.selection)
          sessionStorage.setItem(storageKey, JSON.stringify(value));
        else sessionStorage.removeItem(storageKey);
      } catch {
        /* Restricted browser storage does not block commenting. */
      }
      return value;
    });
  return [draft, update] as const;
}
