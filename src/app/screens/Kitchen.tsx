import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  NEXT_ACTION_LABELS,
  advancePreparation,
  nextPreparationStatus,
  pendingComandas,
} from "../../domain/comanda.ts";
import type { Comanda } from "../../domain/journal.ts";
import { headerLabel } from "../../domain/order-header.ts";
import { timeOfDay, useNow } from "../clock.ts";
import { useCommand, usePosState } from "../context.tsx";
import { errorMessage } from "../errors.ts";
import { StatusPill } from "../kitchen/StatusPill.tsx";

export function Kitchen() {
  const state = usePosState();
  const run = useCommand();
  const [failure, setFailure] = useState("");
  const comandas = pendingComandas(state);
  const now = useNow();

  async function advance(comanda: Comanda) {
    const to = nextPreparationStatus(comanda.status);
    if (!to) return;
    setFailure("");
    try {
      await run((current, meta) =>
        advancePreparation(current, meta, {
          comandaId: comanda.comandaId,
          to,
        }),
      );
    } catch (error) {
      setFailure(errorMessage(error));
    }
  }

  return (
    <section className="flex w-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-medium">Cocina</h1>
        <p className="text-sm text-muted-foreground">
          {comandas.length === 1
            ? "1 comanda pendiente"
            : `${comandas.length} comandas pendientes`}
        </p>
      </div>
      <p role="alert" className="min-h-5 text-sm font-medium">
        {failure}
      </p>

      {comandas.length === 0 ? (
        <div className="flex flex-col items-center gap-1 py-16 text-center">
          <p className="text-sm font-medium">Sin comandas pendientes</p>
          <p className="text-sm text-muted-foreground">
            Las comandas aparecen aquí en cuanto caja las envía.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] items-start gap-3">
          {comandas.map((comanda) => (
            <li
              key={comanda.comandaId}
              aria-label={`Comanda ${comanda.folio}`}
              className="flex flex-col gap-3 rounded-[var(--radius-card-large)] border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-lg leading-tight font-medium">
                    {headerLabel(comanda.header)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {comanda.folio} · {timeOfDay(comanda.sentAt)} ·{" "}
                    {comanda.sentBy.name}
                  </p>
                </div>
                <StatusPill comanda={comanda} now={now} />
              </div>
              <ul className="flex flex-col gap-2 border-y border-border py-3">
                {comanda.lines.map((line) => (
                  <li key={line.lineId} className="flex gap-3">
                    <span className="min-w-8 text-lg leading-tight font-medium tabular-nums">
                      {line.quantity}×
                    </span>
                    <div className="min-w-0">
                      <p className="text-base leading-tight font-medium">
                        {line.name}
                      </p>
                      {line.modifiers.length > 0 && (
                        <p className="text-sm">{line.modifiers.join(" · ")}</p>
                      )}
                      {line.note !== "" && (
                        <p className="mt-1 rounded-[var(--radius-sm)] bg-accent px-2 py-1 text-sm font-medium">
                          Nota: {line.note}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <Button size="lg" onClick={() => advance(comanda)}>
                {NEXT_ACTION_LABELS[comanda.status]}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
