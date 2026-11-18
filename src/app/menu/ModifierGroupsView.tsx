import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ModifierGroup, ModifierOption } from "../../domain/catalog.ts";
import { formatMXN } from "../../domain/money.ts";
import { useMenu } from "../context.tsx";
import { requirement } from "../station/ModifierDialog.tsx";
import { addOptionButtonId, editOptionButtonId } from "./OptionDialogs.tsx";

export function ModifierGroupsView({
  pending,
  onAdd,
  onEdit,
  onToggle,
}: {
  pending: boolean;
  onAdd: (group: ModifierGroup, trigger: HTMLElement) => void;
  onEdit: (
    group: ModifierGroup,
    option: ModifierOption,
    trigger: HTMLElement,
  ) => void;
  onToggle: (group: ModifierGroup, option: ModifierOption) => void;
}) {
  const menu = useMenu();

  return menu.modifierGroups.map((group) => {
    const headingId = `menu-grupo-${group.id}`;
    return (
      <section
        key={group.id}
        aria-labelledby={headingId}
        className="flex flex-col gap-2"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 id={headingId} className="text-base font-medium">
              {group.name}
            </h2>
            <p className="text-xs text-muted-foreground">
              {requirement(group)}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto min-h-11"
            id={addOptionButtonId(group.id)}
            aria-label={`Agregar opción a ${group.name}`}
            onClick={(event) => onAdd(group, event.currentTarget)}
          >
            Agregar opción
          </Button>
        </div>
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-card">
          {group.options.map((option) => {
            const hidden = option.active === false;
            return (
              <li
                key={option.id}
                aria-label={option.name}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2"
              >
                <p className="flex min-w-0 flex-1 flex-wrap items-center gap-2 py-1 text-sm font-medium">
                  <span className="min-w-0">{option.name}</span>
                  {hidden && <Badge variant="outline">Oculta</Badge>}
                </p>
                <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
                  <p className="text-right text-sm font-medium tabular-nums">
                    {formatMXN(option.priceDeltaCents)}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    id={editOptionButtonId(group.id, option.id)}
                    aria-label={`Editar ${option.name}`}
                    onClick={(event) =>
                      onEdit(group, option, event.currentTarget)
                    }
                  >
                    Editar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    aria-label={`${hidden ? "Mostrar" : "Ocultar"} ${option.name}`}
                    disabled={pending}
                    onClick={() => onToggle(group, option)}
                  >
                    {hidden ? "Mostrar" : "Ocultar"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    );
  });
}
