import {
  canActivateUpdate,
  getUpdateSafetyRevision,
  type UpdateSafetySnapshot,
} from "./update-safety";

export function registerAppWorker(
  onRegistered: (registration: ServiceWorkerRegistration) => void,
  onWaiting: () => void,
  onFailure: () => void,
): () => void {
  if (
    !import.meta.env.PROD ||
    !import.meta.env.KARMA_PWA_ENABLED ||
    !("serviceWorker" in navigator)
  ) {
    return () => undefined;
  }

  let disposed = false;
  let registration: ServiceWorkerRegistration | undefined;
  const showWaitingWorker = (): void => {
    if (
      !disposed &&
      navigator.serviceWorker.controller &&
      registration?.waiting
    )
      onWaiting();
  };

  void navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    })
    .then((nextRegistration) => {
      if (disposed) return;
      registration = nextRegistration;
      onRegistered(nextRegistration);
      showWaitingWorker();
      registration.addEventListener("updatefound", () => {
        const installing = registration?.installing;
        installing?.addEventListener("statechange", showWaitingWorker);
      });
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        showWaitingWorker,
      );
      document.addEventListener("visibilitychange", checkForUpdate);
    })
    .catch(() => {
      if (!disposed) onFailure();
    });

  function checkForUpdate(): void {
    if (document.visibilityState === "visible")
      void registration?.update().catch(() => onFailure());
  }

  return () => {
    disposed = true;
    navigator.serviceWorker?.removeEventListener(
      "controllerchange",
      showWaitingWorker,
    );
    document.removeEventListener("visibilitychange", checkForUpdate);
  };
}

export async function activateWaitingWorker(
  registration: ServiceWorkerRegistration,
  safety: UpdateSafetySnapshot,
  explicitlyConfirmed: boolean,
  currentSafety: () => UpdateSafetySnapshot = () => safety,
  expectedConfirmationRevision?: number,
): Promise<boolean> {
  const confirmedAtRevision =
    expectedConfirmationRevision ?? getUpdateSafetyRevision();
  if (
    confirmedAtRevision !== getUpdateSafetyRevision() ||
    !canActivateUpdate(safety, explicitlyConfirmed) ||
    !canActivateUpdate(currentSafety(), explicitlyConfirmed)
  ) {
    throw new Error(
      "Update is blocked while application state is not confirmed safe.",
    );
  }
  const worker = registration.waiting;
  if (!worker) throw new Error("No waiting application update is available.");

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      worker.removeEventListener("statechange", onStateChange);
      reject(new Error("The waiting application update did not activate."));
    }, 15_000);
    const onStateChange = (): void => {
      if (worker.state !== "activated") return;
      window.clearTimeout(timeout);
      worker.removeEventListener("statechange", onStateChange);
      resolve();
    };
    worker.addEventListener("statechange", onStateChange);
    worker.postMessage({ type: "SKIP_WAITING" });
    onStateChange();
  });
  return (
    getUpdateSafetyRevision() === confirmedAtRevision &&
    canActivateUpdate(currentSafety(), explicitlyConfirmed)
  );
}
