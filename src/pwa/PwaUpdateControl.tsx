import React, { useEffect, useState, useSyncExternalStore } from "react";
import { safeDiagnostic } from "../offline-sync/sync-diagnostic.js";
import {
  canActivateUpdate,
  getUpdateSafety,
  getUpdateSafetyRevision,
  subscribeToUpdateSafety,
} from "./update-safety";
import { activateWaitingWorker, registerAppWorker } from "./update-worker";

export function PwaUpdateControl(): React.ReactNode {
  const safety = useSyncExternalStore(
    subscribeToUpdateSafety,
    getUpdateSafety,
    getUpdateSafety,
  );
  const [registration, setRegistration] =
    useState<ServiceWorkerRegistration | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [confirmedAtRevision, setConfirmedAtRevision] = useState<number | null>(
    null,
  );
  const [dismissed, setDismissed] = useState(false);
  const [applying, setApplying] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const dispose = registerAppWorker(
      (value) => setRegistration(value),
      () => {
        setUpdateAvailable(true);
        setConfirmedAtRevision(null);
        setDismissed(false);
      },
      () =>
        setFailure("No se pudo comprobar si hay una actualización disponible."),
    );
    return dispose;
  }, []);

  useEffect(() => {
    setConfirmedAtRevision(null);
  }, [safety.status, safety.reason]);

  if (dismissed) return null;
  if (!updateAvailable) {
    return failure ? (
      <aside role="status" aria-live="polite" style={styles.failure}>
        La aplicación sigue disponible, pero no se pudo comprobar una
        actualización. {failure}
      </aside>
    ) : null;
  }
  const confirmed = confirmedAtRevision === getUpdateSafetyRevision();
  const canApply =
    canActivateUpdate(safety, confirmed) && registration !== null && !applying;
  const apply = async (): Promise<void> => {
    if (
      !registration ||
      confirmedAtRevision === null ||
      confirmedAtRevision !== getUpdateSafetyRevision() ||
      !canActivateUpdate(getUpdateSafety(), true)
    )
      return;
    setApplying(true);
    setFailure(null);
    try {
      const mayReload = await activateWaitingWorker(
        registration,
        getUpdateSafety(),
        true,
        getUpdateSafety,
        confirmedAtRevision,
      );
      if (mayReload) window.location.reload();
      else {
        setUpdateAvailable(false);
        setFailure(
          "La actualización se instaló, pero el estado de la estación cambió. Continúa y vuelve a abrir la app cuando termines.",
        );
      }
    } catch (error) {
      setFailure(safeDiagnostic(error).message);
      setApplying(false);
    }
  };

  return (
    <section
      role="status"
      aria-live="polite"
      data-testid="pwa-update-control"
      style={styles.notice}
    >
      <div style={styles.copy}>
        <strong>Hay una actualización lista</strong>
        {safety.status === "safe" ? (
          <span>
            Revisaste la estación y no hay cobro, edición ni orden activa sin
            guardar.
          </span>
        ) : safety.status === "blocked" ? (
          <span>
            {safety.reason} Guarda o termina ese trabajo; la actualización
            esperará.
          </span>
        ) : (
          <span>
            No se pudo comprobar el estado de la estación. Cierra la venta sin
            dejar capturas abiertas y vuelve a iniciar; no se actualizará de
            forma automática.
          </span>
        )}
        {failure && <span role="alert">{failure}</span>}
        {safety.status === "safe" && (
          <label style={styles.confirm}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) =>
                setConfirmedAtRevision(
                  event.currentTarget.checked
                    ? getUpdateSafetyRevision()
                    : null,
                )
              }
            />
            Confirmo que guardé o revisé el trabajo visible
          </label>
        )}
      </div>
      <button
        type="button"
        disabled={!canApply}
        onClick={() => void apply()}
        style={styles.action}
      >
        {applying ? "Preparando actualización…" : "Actualizar ahora"}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        style={styles.dismiss}
      >
        Más tarde
      </button>
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  notice: {
    position: "fixed",
    zIndex: 9998,
    left: 16,
    right: 16,
    bottom: 16,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    padding: 16,
    border: "1px solid #836953",
    borderRadius: 14,
    background: "#faf9f5",
    color: "#141413",
    boxShadow: "0 8px 32px #14141324",
    fontFamily: "system-ui, sans-serif",
  },
  failure: {
    position: "fixed",
    zIndex: 9998,
    left: 16,
    right: 16,
    bottom: 16,
    padding: 14,
    border: "1px solid #836953",
    borderRadius: 12,
    background: "#faf9f5",
    color: "#141413",
    fontFamily: "system-ui, sans-serif",
    fontSize: 13,
  },
  copy: { display: "grid", flex: "1 1 300px", gap: 6, fontSize: 13 },
  confirm: { display: "flex", alignItems: "center", gap: 8, marginTop: 4 },
  action: {
    border: 0,
    borderRadius: 9,
    padding: "10px 14px",
    background: "#836953",
    color: "#fff",
    font: "inherit",
    cursor: "pointer",
  },
  dismiss: {
    border: "1px solid #e2e0d6",
    borderRadius: 9,
    padding: "10px 14px",
    background: "#f0eee6",
    color: "#141413",
    font: "inherit",
    cursor: "pointer",
  },
};
