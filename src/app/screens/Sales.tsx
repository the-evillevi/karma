import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PAYMENT_METHOD_LABELS } from "../../domain/checkout.ts";
import type { Order } from "../../domain/journal.ts";
import { formatMXN } from "../../domain/money.ts";
import { headerLabel } from "../../domain/order-header.ts";
import type { PaymentMethod } from "../../domain/payment.ts";
import { daySummary } from "../../domain/sales.ts";
import { localIso, timeOfDay } from "../clock.ts";
import { usePosState } from "../context.tsx";
import { TicketDialog } from "./Station.tsx";

const METHODS: PaymentMethod[] = ["cash", "card", "transfer"];

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-card p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/** Today's closed sales and what was collected per method (EVL-130 [B]). */
export function Sales({ today = localIso().slice(0, 10) }: { today?: string }) {
  const state = usePosState();
  const [ticket, setTicket] = useState<Order | null>(null);
  const summary = daySummary(state, today);

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-4 overflow-y-auto p-4">
      <h1 className="text-xl font-medium">Ventas de hoy</h1>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Ventas" value={String(summary.count)} />
        <Tile label="Vendido" value={formatMXN(summary.salesCents)} />
        <Tile label="Propinas" value={formatMXN(summary.tipsCents)} />
        {METHODS.map((method) => (
          <Tile
            key={method}
            label={PAYMENT_METHOD_LABELS[method]}
            value={formatMXN(summary.byMethod[method])}
          />
        ))}
      </dl>

      {summary.sales.length === 0 ? (
        <p className="py-16 text-center text-sm font-medium">
          Aún no hay ventas cerradas hoy
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-card">
          {summary.sales.map((order) => {
            const sale = order.sale;
            if (!sale) return null;
            return (
              <li
                key={order.orderId}
                aria-label={`Venta ${order.folio}`}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {order.folio} · {headerLabel(order.header)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {timeOfDay(sale.closedAt)} · {sale.closedBy.name} ·{" "}
                    {PAYMENT_METHOD_LABELS[sale.settlement.method]}
                    {sale.tipCents > 0 &&
                      ` · propina ${formatMXN(sale.tipCents)}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-base font-medium tabular-nums">
                    {formatMXN(sale.totals.totalCents)}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Ver ticket de ${order.folio}`}
                    onClick={() => setTicket(order)}
                  >
                    Ver ticket
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {ticket && (
        <TicketDialog order={ticket} onClose={() => setTicket(null)} />
      )}
    </section>
  );
}
