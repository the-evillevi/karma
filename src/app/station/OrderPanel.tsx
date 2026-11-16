import { Minus, Pencil, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { formatMXN } from "../../domain/money.ts";
import { lineTotalCents, orderTotals } from "../../domain/order.ts";
import type { OrderLine } from "../../domain/order.ts";

type OrderPanelProps = {
  lines: OrderLine[];
  taxRateBps: number;
  /** "Cuenta A-0001" when editing a saved account. */
  title?: string;
  /** Quantity of each line already sent to the kitchen, by lineId. */
  sentQuantities?: Record<string, number>;
  /** Order type, table and customer editor. */
  header?: ReactNode;
  /** Save, send and charge actions. */
  actions?: ReactNode;
  onChangeQuantity: (lineId: string, delta: number) => void;
  onRemove: (lineId: string) => void;
  onEdit: (line: OrderLine) => void;
};

/** "2 productos" / "1 producto". */
export function itemCountLabel(count: number): string {
  return count === 1 ? "1 producto" : `${count} productos`;
}

export function OrderPanel({
  lines,
  taxRateBps,
  title = "Orden actual",
  sentQuantities = {},
  header,
  actions,
  onChangeQuantity,
  onRemove,
  onEdit,
}: OrderPanelProps) {
  const totals = orderTotals(lines, taxRateBps);

  return (
    <section aria-label="Orden actual" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-baseline justify-between gap-2 px-4 pt-4 pb-2">
        <h2 className="text-base font-medium">{title}</h2>
        <span className="text-xs text-muted-foreground">
          {itemCountLabel(totals.itemCount)}
        </span>
      </div>

      {header}

      {lines.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 py-10 text-center">
          <p className="text-sm font-medium">Sin productos</p>
          <p className="text-sm text-muted-foreground">
            Toca un producto del menú para agregarlo.
          </p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto px-4">
          {lines.map((line) => (
            <li key={line.lineId} className="flex flex-col gap-2 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm leading-snug font-medium">
                    {line.name}
                  </p>
                  {line.modifiers.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {line.modifiers
                        .map((modifier) => modifier.name)
                        .join(" · ")}
                    </p>
                  )}
                  {(sentQuantities[line.lineId] ?? 0) > 0 && (
                    <p className="text-xs text-muted-foreground">
                      En cocina: {sentQuantities[line.lineId]}
                    </p>
                  )}
                  {line.note !== "" && (
                    <p className="text-xs text-foreground italic">
                      Nota: {line.note}
                    </p>
                  )}
                </div>
                <p className="text-sm font-medium tabular-nums">
                  {formatMXN(lineTotalCents(line))}
                </p>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`Quitar uno de ${line.name}`}
                    disabled={
                      line.quantity <= (sentQuantities[line.lineId] ?? 0)
                    }
                    onClick={() => onChangeQuantity(line.lineId, -1)}
                  >
                    <Minus />
                  </Button>
                  <output
                    aria-label={`Cantidad de ${line.name}`}
                    className="min-w-9 text-center text-sm font-medium tabular-nums"
                  >
                    {line.quantity}
                  </output>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`Agregar uno de ${line.name}`}
                    onClick={() => onChangeQuantity(line.lineId, 1)}
                  >
                    <Plus />
                  </Button>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Editar ${line.name}`}
                    disabled={(sentQuantities[line.lineId] ?? 0) > 0}
                    onClick={() => onEdit(line)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Eliminar ${line.name}`}
                    disabled={(sentQuantities[line.lineId] ?? 0) > 0}
                    onClick={() => onRemove(line.lineId)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <dl className="flex flex-col gap-1 border-t border-border px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-sm">Total</dt>
          <dd
            data-testid="order-total"
            className="font-display text-3xl leading-none tabular-nums"
          >
            {formatMXN(totals.totalCents)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground tabular-nums">
          <dt>Base {formatMXN(totals.netCents)}</dt>
          <dd>
            IVA {taxRateBps / 100} % {formatMXN(totals.taxCents)}
          </dd>
        </div>
      </dl>
      {actions}
    </section>
  );
}
