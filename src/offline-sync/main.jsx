import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { safeDiagnostic } from "./sync-diagnostic.js";
import { openOfflineDatabase } from "./database.js";
import { captureCommandBatch, createDemoOrderBatch, createSupabaseClient, syncPendingCommandBatches } from "./command-sync.js";

const cachedContextKey = "karma-evl114-offline-context";
const databaseName = new URLSearchParams(window.location.search).get("db") || "karma-offline-demo-v1";
const failReceiptOnceFromUrl = new URLSearchParams(window.location.search).has("failReceiptOnce");
const branchId = import.meta.env.VITE_DEMO_BRANCH_ID || "karma-demo-branch";
const deviceId = import.meta.env.VITE_DEMO_DEVICE_ID || "karma-demo-cash-register";

function isNetworkUnavailable(error) {
  return error instanceof TypeError || error?.name === "FetchError";
}

function OfflineSyncDemo() {
  const databasePromise = useMemo(() => openOfflineDatabase(databaseName), []);
  const supabasePromise = useMemo(() => createSupabaseClient(), []);
  const [database, setDatabase] = useState(null);
  const [supabase, setSupabase] = useState(null);
  const [email, setEmail] = useState("cashier@karma.local");
  const [password, setPassword] = useState("");
  const [session, setSession] = useState(null);
  const [deviceContext, setDeviceContext] = useState(null);
  const [batches, setBatches] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [syncBlocks, setSyncBlocks] = useState([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Inicia sesión con la cuenta local de prueba para preparar la caja autorizada.");
  const [failNextReceipt, setFailNextReceipt] = useState(failReceiptOnceFromUrl);
  const [failNextLocalWrite, setFailNextLocalWrite] = useState(false);

  const refreshLocal = useCallback(async () => {
    if (!database) return;
    const [batchDocs, receiptDocs, blockDocs] = await Promise.all([
      database.commandBatches.find().sort({ occurredAt: "desc" }).exec(),
      database.syncReceipts.find().exec(),
      database.syncBlocks.find().exec(),
    ]);
    setBatches(batchDocs.map((doc) => doc.toJSON()));
    setReceipts(receiptDocs.map((doc) => doc.toJSON()));
    setSyncBlocks(blockDocs.map((doc) => doc.toJSON()));
  }, [database]);

  const resolveDeviceContext = useCallback(async (client, user) => {
    const cached = window.localStorage.getItem(cachedContextKey);
    try {
      const deviceQuery = await client.from("register_devices")
        .select("device_id,branch_id,owner_user_id,capability,revoked_at")
        .eq("device_id", deviceId)
        .eq("branch_id", branchId)
        .maybeSingle();
      if (deviceQuery.error) throw deviceQuery.error;
      const leaseQuery = await client.from("branch_register_leases")
        .select("lease_id,device_id,valid_from,expires_at,revoked_at")
        .eq("branch_id", branchId)
        .maybeSingle();
      if (leaseQuery.error) throw leaseQuery.error;
      if (!deviceQuery.data || !leaseQuery.data || deviceQuery.data.owner_user_id !== user.id || deviceQuery.data.revoked_at || leaseQuery.data.device_id !== deviceId || leaseQuery.data.revoked_at || Date.now() >= Date.parse(leaseQuery.data.expires_at) || Date.now() < Date.parse(leaseQuery.data.valid_from)) {
        window.localStorage.removeItem(cachedContextKey);
        setDeviceContext(null);
        throw new Error("Este dispositivo no tiene una autorización de caja activa.");
      }
      const context = {
        actorId: user.id,
        branchId,
        deviceId,
        leaseId: leaseQuery.data.lease_id,
        leaseExpiresAt: leaseQuery.data.expires_at,
        capability: deviceQuery.data.capability,
      };
      window.localStorage.setItem(cachedContextKey, JSON.stringify(context));
      return context;
    } catch (error) {
      // A denied query or missing/revoked lease is positive evidence and must
      // clear stale permission. Cached authorization is only for actual offline.
      if (cached && (!navigator.onLine || isNetworkUnavailable(error))) {
        const context = JSON.parse(cached);
        if (context.actorId === user.id && context.branchId === branchId && context.deviceId === deviceId && Date.now() < Date.parse(context.leaseExpiresAt)) return context;
      }
      if (!navigator.onLine || isNetworkUnavailable(error)) setDeviceContext(null);
      else window.localStorage.removeItem(cachedContextKey);
      throw error;
    }
  }, []);

  const restoreSession = useCallback(async (client) => {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    const activeSession = data.session;
    setSession(activeSession);
    if (!activeSession) return;
    const context = await resolveDeviceContext(client, activeSession.user);
    setDeviceContext(context);
    setMessage(navigator.onLine
      ? "Sesión restaurada y dispositivo verificado con Supabase."
      : "Sesión y permiso previamente verificados; sin conexión no se puede observar una revocación nueva.");
  }, [resolveDeviceContext]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([databasePromise, supabasePromise]).then(async ([db, client]) => {
      if (cancelled) return;
      setDatabase(db);
      setSupabase(client);
      try {
        await restoreSession(client);
      } catch (error) {
        setMessage(safeDiagnostic(error).message);
      }
    }).catch((error) => setMessage(safeDiagnostic(error).message));
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, [databasePromise, supabasePromise, restoreSession]);

  useEffect(() => {
    if (!database) return undefined;
    const batchesSub = database.commandBatches.find().$.subscribe(refreshLocal);
    const receiptsSub = database.syncReceipts.find().$.subscribe(refreshLocal);
    const blocksSub = database.syncBlocks.find().$.subscribe(refreshLocal);
    refreshLocal();
    return () => {
      batchesSub.unsubscribe();
      receiptsSub.unsubscribe();
      blocksSub.unsubscribe();
    };
  }, [database, refreshLocal]);

  const syncNow = useCallback(async () => {
    if (!database || !supabase || !session) return;
    setBusy(true);
    try {
      const outcomes = await syncPendingCommandBatches(database, supabase, {
        shouldInterruptAfterRemoteInsert: (() => {
          let remaining = failNextReceipt ? 1 : 0;
          return () => remaining-- > 0;
        })(),
        afterRemoteInsert: async () => {
          throw new Error("Simulación: respuesta remota recibida, recibo local interrumpido.");
        },
      });
      if (failNextReceipt) setFailNextReceipt(false);
      const acknowledged = outcomes.filter((item) => item.state === "acknowledged");
      const blocked = outcomes.filter((item) => item.state === "blocked");
      const pending = outcomes.filter((item) => item.state === "pending");
      if (acknowledged.length) setMessage(`Supabase confirmó ${acknowledged.length} lote(s); ${acknowledged.filter((item) => item.outcome === "identical-retry").length} ya existían con el mismo contenido.`);
      else if (blocked.length) setMessage(`Hay ${blocked.length} lote(s) detenidos para revisión manual (${blocked[0].code}); siguen guardados localmente y no se reintentan automáticamente.`);
      else if (pending.length) setMessage("El lote sigue pendiente. Reintenta cuando vuelva la conexión; no se eliminó la venta local.");
      else setMessage("No hay lotes pendientes por enviar.");
      await refreshLocal();
    } finally {
      setBusy(false);
    }
  }, [database, supabase, session, failNextReceipt, refreshLocal]);

  useEffect(() => {
    window.addEventListener("online", syncNow);
    return () => window.removeEventListener("online", syncNow);
  }, [syncNow]);

  async function signIn(event) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    const result = await supabase.auth.signInWithPassword({ email, password });
    if (result.error) {
      setMessage(`No se inició sesión: ${safeDiagnostic(result.error).message}`);
      setBusy(false);
      return;
    }
    setSession(result.data.session);
    try {
      const context = await resolveDeviceContext(supabase, result.data.session.user);
      setDeviceContext(context);
      setMessage("Sesión iniciada; Supabase confirmó la identidad, la sucursal y la caja activa.");
    } catch (error) {
      setMessage(safeDiagnostic(error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createOrder({ simulateLocalFailure = false } = {}) {
    if (!database || !deviceContext) return;
    if (deviceContext.capability !== "cash_register") {
      setMessage("Este dispositivo es de preparación o lectura; no puede capturar ventas.");
      return;
    }
    if (Date.now() > Date.parse(deviceContext.leaseExpiresAt)) {
      setMessage("La autorización de caja almacenada venció; hace falta reconectar y obtener una autorización nueva.");
      return;
    }
    const batch = createDemoOrderBatch(deviceContext);
    try {
      await captureCommandBatch(database, batch, simulateLocalFailure ? {
        beforeLocalInsert: async () => { throw new Error("Simulación: IndexedDB rechazó la escritura local."); },
      } : {});
      setMessage("Venta capturada en RxDB local. Su nombre, precio y desglose de IVA quedaron guardados como snapshots.");
    } catch (error) {
      setMessage(`La escritura local falló; no se marcó pendiente ni se envió a Supabase. ${safeDiagnostic(error).message}`);
    }
    await refreshLocal();
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
    setDeviceContext(null);
    window.localStorage.removeItem(cachedContextKey);
    setMessage("Sesión cerrada.");
  }

  async function refreshAuthorization() {
    if (!supabase || !session) return;
    try {
      const context = await resolveDeviceContext(supabase, session.user);
      setDeviceContext(context);
      setMessage("Supabase volvió a verificar el permiso de este dispositivo.");
    } catch (error) {
      setDeviceContext(null);
      setMessage(safeDiagnostic(error).message);
    }
  }

  const receiptByCommand = new Map(receipts.map((receipt) => [receipt.commandId, receipt]));
  const blockByCommand = new Map(syncBlocks.map((block) => [block.commandId, block]));
  return <main style={styles.page}>
    <header style={styles.header}>
      <div>
        <h1 style={{ margin: 0 }}>Karma · Sincronización offline</h1>
        <p style={{ margin: "8px 0 0", color: "#58616c" }}>Prototipo EVL-114: captura local con acuse real de Supabase.</p>
      </div>
      <strong data-testid="network-state" style={{ color: online ? "#176b3a" : "#a23a2f" }}>{online ? "En línea" : "Sin conexión"}</strong>
    </header>

    {!session ? <form onSubmit={signIn} style={styles.card} aria-label="Iniciar sesión">
      <h2 style={styles.heading}>Acceso a la caja de prueba</h2>
      <label style={styles.label}>Correo
        <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" required style={styles.input} />
      </label>
      <label style={styles.label}>Contraseña local de prueba
        <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required style={styles.input} />
      </label>
      <button disabled={busy || !supabase} style={styles.primary}>Iniciar sesión</button>
    </form> : <section style={styles.card}>
      <div style={styles.row}>
        <div>
          <h2 style={{ ...styles.heading, marginBottom: 4 }}>Caja autorizada</h2>
          <div>{session.user.email}</div>
          {deviceContext && <small style={{ color: "#58616c" }}>Sucursal {deviceContext.branchId} · dispositivo {deviceContext.deviceId} · vence {new Date(deviceContext.leaseExpiresAt).toLocaleTimeString()}</small>}
        </div>
        <button onClick={signOut} style={styles.secondary}>Cerrar sesión</button>
      </div>
      <button onClick={refreshAuthorization} disabled={!online} style={{ ...styles.secondary, marginTop: 12 }}>Volver a verificar permiso</button>
      <div style={styles.controls}>
        <button onClick={() => createOrder()} disabled={busy || !deviceContext} style={styles.primary}>Crear venta capturada</button>
        <button onClick={() => syncNow()} disabled={busy || !online || !session} style={styles.secondary}>Sincronizar pendientes</button>
      </div>
      <details style={{ marginTop: 12 }}>
        <summary>Pruebas de fallo de este prototipo</summary>
        <div style={styles.controls}>
          <button onClick={() => createOrder({ simulateLocalFailure: true })} style={styles.secondary}>Probar fallo al guardar localmente</button>
          <button onClick={() => setFailNextReceipt(true)} style={styles.secondary}>Simular interrupción del recibo local</button>
        </div>
      </details>
    </section>}

    <p role="status" aria-live="polite" data-testid="sync-message" style={styles.message}>{message}</p>
    <section style={styles.card}>
      <div style={styles.row}>
        <h2 style={styles.heading}>Ventas locales</h2>
        <span data-testid="pending-count">{batches.filter((batch) => !receiptByCommand.has(batch.commandId)).length} pendientes</span>
      </div>
      {batches.length === 0 ? <p style={{ color: "#58616c" }}>No hay ventas guardadas en este navegador.</p> : <ul style={styles.list}>
        {batches.map((batch) => {
          const receipt = receiptByCommand.get(batch.commandId);
          const block = blockByCommand.get(batch.commandId);
          const productName = batch.events[0]?.payload?.lines?.[0]?.productNameSnapshot ?? "Venta";
          return <li key={batch.commandId} data-testid="order-row" style={styles.orderRow}>
            <div>
              <strong>{productName}</strong>
              <small style={{ display: "block", color: "#58616c" }}>Orden {batch.aggregateId} · {new Date(batch.occurredAt).toLocaleString()}</small>
              <small style={{ display: "block", color: "#58616c" }}>Comando {batch.commandId}</small>
            </div>
            <strong data-testid="order-sync-status" style={{ color: receipt ? "#176b3a" : block ? "#a23a2f" : "#986400" }}>{receipt ? "Confirmada en Supabase" : block ? `Revisión requerida (${block.code})` : "Pendiente"}</strong>
          </li>;
        })}
      </ul>}
    </section>
    <aside style={styles.note}>
      <strong>Permiso desconectado:</strong> el dispositivo usa su autorización previamente cargada hasta el vencimiento mostrado. Una revocación remota no puede llegar mientras está offline; al reconectar, Postgres vuelve a validar la caja y puede bloquear lotes atrasados para conciliación.
    </aside>
  </main>;
}

const styles = {
  page: { fontFamily: "system-ui, sans-serif", maxWidth: 860, margin: "32px auto", padding: "0 20px", color: "#20252b" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, marginBottom: 24 },
  card: { background: "white", border: "1px solid #dfe3e8", borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: "0 3px 12px #1720330b" },
  heading: { fontSize: 18, margin: "0 0 16px" },
  label: { display: "block", fontSize: 14, fontWeight: 600, marginBottom: 12 },
  input: { display: "block", boxSizing: "border-box", width: "100%", marginTop: 6, padding: 10, border: "1px solid #c5ccd4", borderRadius: 6, font: "inherit" },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 },
  controls: { display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16 },
  primary: { background: "#203c60", color: "white", border: 0, borderRadius: 7, padding: "10px 14px", font: "inherit", cursor: "pointer" },
  secondary: { background: "#f4f6f8", color: "#20252b", border: "1px solid #cbd2d9", borderRadius: 7, padding: "9px 12px", font: "inherit", cursor: "pointer" },
  message: { minHeight: 24, padding: "0 4px", color: "#3f4a56" },
  list: { listStyle: "none", padding: 0, margin: 0 },
  orderRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, borderTop: "1px solid #edf0f2", padding: "14px 0" },
  note: { background: "#f3f5f7", borderRadius: 8, padding: 14, color: "#46505b", fontSize: 14, lineHeight: 1.5 },
};

createRoot(document.getElementById("root")).render(<OfflineSyncDemo />);
