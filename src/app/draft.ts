// The order being captured at the station, before or between saves. It lives
// in localStorage so a reload or a change of user does not lose it.
import { useCallback, useSyncExternalStore } from "react";
import type { OrderHeader } from "../domain/journal.ts";
import type { OrderLine } from "../domain/order.ts";

export type Draft = {
  /** The saved account this draft edits, or null for a new order. */
  orderId: string | null;
  header: OrderHeader;
  lines: OrderLine[];
};

const STORAGE_KEY = "karma.draft.v2";

export const EMPTY_HEADER: OrderHeader = {
  type: "mostrador",
  table: null,
  customer: { name: "", phone: "", address: "" },
};

export const EMPTY_DRAFT: Draft = {
  orderId: null,
  header: EMPTY_HEADER,
  lines: [],
};

function isDraft(value: unknown): value is Draft {
  return (
    typeof value === "object" &&
    value !== null &&
    "lines" in value &&
    Array.isArray(value.lines) &&
    "header" in value &&
    typeof value.header === "object" &&
    value.header !== null &&
    "orderId" in value
  );
}

let cached: Draft | null = null;
const listeners = new Set<() => void>();

export function loadDraft(): Draft {
  if (cached) return cached;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : null;
    cached = isDraft(parsed) ? parsed : EMPTY_DRAFT;
  } catch {
    // Unreadable or blocked storage: start with an empty order.
    cached = EMPTY_DRAFT;
  }
  return cached;
}

export function storeDraft(draft: Draft): void {
  cached = draft;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // The draft is a convenience; saved accounts go through the journal.
  }
  for (const listener of listeners) listener();
}

/** Forgets the in-memory copy so the next read comes from storage (tests). */
export function resetDraftCache(): void {
  cached = null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The draft plus a setter that persists every change. Shared by all screens. */
export function useDraft(): [Draft, (next: Draft) => void] {
  const draft = useSyncExternalStore(subscribe, loadDraft);
  const update = useCallback((next: Draft) => storeDraft(next), []);
  return [draft, update];
}
