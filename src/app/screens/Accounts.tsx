import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { can } from "../../domain/access.ts";
import { accountSummary, openOrders } from "../../domain/accounts.ts";
import { hasUnsentLines } from "../../domain/comanda.ts";
import { formatMXN } from "../../domain/money.ts";
import { configureTables } from "../../domain/tables.ts";
import { catalog } from "../catalog.ts";
import { timeOfDay } from "../clock.ts";
import { useCommand, usePosState, useSession } from "../context.tsx";
import { useDraft } from "../draft.ts";
import { errorMessage } from "../errors.ts";
import { navigate } from "../router.ts";
import { itemCountLabel } from "../station/OrderPanel.tsx";

/** Saved accounts waiting to be continued or charged (EVL-122 [C]). */
export function Accounts() {
  const state = usePosState();
  const run = useCommand();
  const { user } = useSession();
  const [draft, setDraft] = useDraft();
  const [failure, setFailure] = useState("");
  const orders = openOrders(state);
  const mayConfigure = user ? can(user.role, "configure-tables") : false;

  function open(orderId: string) {
    const order = state.orders[orderId];
    if (draft.lines.length > 0 && draft.orderId !== orderId) {
      setFailure(
        "Hay una orden en captura. Guárdala o vacíala en Venta antes de abrir otra cuenta.",
      );
      return;
    }
    setDraft({
      orderId,
      baseVersion: order.version,
      header: order.header,
      lines: order.lines,
    });
    navigate("/");
  }

  async function setTables(count: number) {
    setFailure("");
    try {
      await run((current, meta) => configureTables(current, meta, { count }));
    } catch (error) {
      setFailure(errorMessage(error));
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-medium">Cuentas abiertas</h1>
        {mayConfigure && (
          <div className="flex items-center gap-2 text-sm">
            <span id="tables-label">Mesas configuradas</span>
            <Button
              variant="outline"
              size="icon"
              aria-label="Quitar una mesa"
              disabled={state.tableCount === 0}
              onClick={() => setTables(state.tableCount - 1)}
            >
              <Minus />
            </Button>
            <output
              aria-labelledby="tables-label"
              className="min-w-8 text-center font-medium tabular-nums"
            >
              {state.tableCount}
            </output>
            <Button
              variant="outline"
              size="icon"
              aria-label="Agregar una mesa"
              onClick={() => setTables(state.tableCount + 1)}
            >
              <Plus />
            </Button>
          </div>
        )}
      </div>

      <p role="alert" className="min-h-5 text-sm font-medium">
        {failure}
      </p>

      {orders.length === 0 ? (
        <div className="flex flex-col items-center gap-1 py-16 text-center">
          <p className="text-sm font-medium">No hay cuentas abiertas</p>
          <p className="text-sm text-muted-foreground">
            Captura una orden en Venta y toca «Guardar cuenta».
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
          {orders.map((order) => {
            const summary = accountSummary(order, catalog.taxRateBps);
            return (
              <li
                key={order.orderId}
                aria-label={`Cuenta ${summary.folio}`}
                className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-base font-medium">{summary.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {summary.folio} · {summary.typeLabel}
                    </p>
                  </div>
                  <p className="font-display text-2xl leading-none tabular-nums">
                    {formatMXN(summary.totalCents)}
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">
                  {itemCountLabel(summary.itemCount)} · {summary.responsible} ·{" "}
                  {timeOfDay(summary.openedAt)}
                </p>
                <div className="flex items-center justify-between gap-2">
                  {hasUnsentLines(state, order.orderId) ? (
                    <Badge variant="pending">Por enviar a cocina</Badge>
                  ) : (
                    <Badge variant="outline">Enviada a cocina</Badge>
                  )}
                  <Button onClick={() => open(order.orderId)}>Abrir</Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
