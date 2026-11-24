import { useSyncExternalStore } from "react";

export function localIso(date: Date = new Date()): string {
  const pad = (value: number, length = 2) =>
    String(value).padStart(length, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const absolute = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  );
}

export function timeOfDay(iso: string): string {
  return iso.slice(11, 16);
}

const NOW_REFRESH_MS = 15_000;
const nowListeners = new Set<() => void>();
let current: string | null = null;
let refreshTimer: ReturnType<typeof setInterval> | undefined;

function refreshNow() {
  current = localIso();
  for (const listener of nowListeners) listener();
}

function subscribeToNow(listener: () => void): () => void {
  nowListeners.add(listener);
  if (nowListeners.size === 1) {
    current = localIso();
    refreshTimer = setInterval(refreshNow, NOW_REFRESH_MS);
  }
  return () => {
    nowListeners.delete(listener);
    if (nowListeners.size === 0) {
      clearInterval(refreshTimer);
      refreshTimer = undefined;
      current = null;
    }
  };
}

function nowSnapshot(): string {
  current ??= localIso();
  return current;
}

export function useNow(): string {
  return useSyncExternalStore(subscribeToNow, nowSnapshot);
}
