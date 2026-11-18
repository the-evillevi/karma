import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { OrderHeader, OrderType } from "../../domain/journal.ts";
import {
  ORDER_TYPE_LABELS,
  requiredCustomerFields,
} from "../../domain/order-header.ts";

type HeaderEditorProps = {
  header: OrderHeader;
  tables: number[];
  onChange: (header: OrderHeader) => void;
};

const TYPES: OrderType[] = ["mostrador", "mesa", "recoger", "entrega"];

const FIELD_LABELS = {
  name: "Nombre del cliente",
  phone: "Teléfono",
  address: "Dirección de entrega",
} as const;

const chipClass =
  "inline-flex min-h-11 items-center justify-center rounded-[var(--radius-button)] border border-border bg-background px-3 text-sm outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-ring";
const activeChip =
  "border-primary bg-primary font-medium text-primary-foreground";

export function HeaderEditor({ header, tables, onChange }: HeaderEditorProps) {
  const fields = requiredCustomerFields(header.type);
  const tableChoices =
    header.table !== null && !tables.includes(header.table)
      ? [...tables, header.table]
      : tables;

  return (
    <div className="flex flex-col gap-3 border-b border-border px-4 py-3">
      <div
        role="radiogroup"
        aria-label="Tipo de pedido"
        className="grid grid-cols-4 gap-1"
      >
        {TYPES.map((type) => (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={header.type === type}
            onClick={() =>
              onChange({
                ...header,
                type,
                table: type === "mesa" ? header.table : null,
              })
            }
            className={cn(
              chipClass,
              "px-1",
              header.type === type && activeChip,
            )}
          >
            {ORDER_TYPE_LABELS[type]}
          </button>
        ))}
      </div>

      {header.type === "mesa" && (
        <div
          role="radiogroup"
          aria-label="Mesa"
          className="flex flex-wrap gap-1"
        >
          {tableChoices.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No hay mesas configuradas.
            </p>
          )}
          {tableChoices.map((table) => (
            <button
              key={table}
              type="button"
              role="radio"
              aria-checked={header.table === table}
              aria-label={`Mesa ${table}`}
              onClick={() => onChange({ ...header, table })}
              className={cn(
                chipClass,
                "min-w-11 tabular-nums",
                header.table === table && activeChip,
              )}
            >
              {table}
            </button>
          ))}
        </div>
      )}

      {fields.map((field) => (
        <div key={field} className="flex flex-col gap-1">
          <Label htmlFor={`customer-${field}`}>{FIELD_LABELS[field]}</Label>
          <Input
            id={`customer-${field}`}
            type={field === "phone" ? "tel" : "text"}
            inputMode={field === "phone" ? "tel" : "text"}
            autoComplete="off"
            value={header.customer[field]}
            onChange={(event) =>
              onChange({
                ...header,
                customer: { ...header.customer, [field]: event.target.value },
              })
            }
          />
        </div>
      ))}
    </div>
  );
}
