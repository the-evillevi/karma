// The order being captured at the station, before it is saved as an account.
// It lives in localStorage so a reload or a change of user does not lose it.
import { useCallback, useState } from "react";
import type { OrderLine } from "../domain/order.ts";

export type Draft = { lines: OrderLine[] };

const STORAGE_KEY = "karma.draft.v1";

export const EMPTY_DRAFT: Draft = { lines: [] };

export function loadDraft(): Draft {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return EMPTY_DRAFT;
    const parsed: unknown = JSON.parse(stored);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "lines" in parsed &&
      Array.isArray(parsed.lines)
    ) {
      return { lines: parsed.lines as OrderLine[] };
    }
  } catch {
    // Unreadable or blocked storage: start with an empty order.
  }
  return EMPTY_DRAFT;
}

function storeDraft(draft: Draft): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // The draft is a convenience; saved accounts go through the journal.
  }
}

/** The draft plus a setter that persists every change. */
export function useDraft(): [Draft, (next: Draft) => void] {
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const update = useCallback((next: Draft) => {
    storeDraft(next);
    setDraft(next);
  }, []);
  return [draft, update];
}
