export type UpdateSafetyStatus = "unknown" | "blocked" | "safe";

export interface UpdateSafetySnapshot {
  status: UpdateSafetyStatus;
  reason: string;
}

const unknownSafety: UpdateSafetySnapshot = {
  status: "unknown",
  reason: "No se pudo comprobar si hay una captura activa.",
};

let currentSafety = unknownSafety;
let safetyRevision = 0;
const listeners = new Set<() => void>();

export function getUpdateSafety(): UpdateSafetySnapshot {
  return currentSafety;
}

/** Changes even when the app later returns to the same safe snapshot. */
export function getUpdateSafetyRevision(): number {
  return safetyRevision;
}

export function reportUpdateSafety(next: UpdateSafetySnapshot): void {
  if (
    next.status === currentSafety.status &&
    next.reason === currentSafety.reason
  )
    return;
  currentSafety = next;
  safetyRevision += 1;
  for (const listener of listeners) listener();
}

export function subscribeToUpdateSafety(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The service worker can activate only after an explicit operator confirmation and a verified safe state. */
export function canActivateUpdate(
  safety: UpdateSafetySnapshot,
  explicitlyConfirmed: boolean,
): boolean {
  return safety.status === "safe" && explicitlyConfirmed;
}

export const unknownUpdateSafety = unknownSafety;
