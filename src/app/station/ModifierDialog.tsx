import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { modifierGroupsFor } from "../../domain/catalog.ts";
import type { Catalog, ModifierGroup, Product } from "../../domain/catalog.ts";
import {
  ModifierError,
  defaultSelection,
  resolveModifiers,
} from "../../domain/modifiers.ts";
import type { ModifierSelection } from "../../domain/modifiers.ts";
import { formatMXN } from "../../domain/money.ts";
import type { LineModifier, OrderLine } from "../../domain/order.ts";

type ModifierDialogProps = {
  catalog: Catalog;
  product: Product;
  line?: OrderLine;
  onCancel: () => void;
  onConfirm: (modifiers: LineModifier[], note: string) => void;
};

function selectionOf(
  catalog: Catalog,
  product: Product,
  line: OrderLine | undefined,
): ModifierSelection {
  const selection = defaultSelection(catalog, product);
  if (!line) return selection;
  for (const groupId of Object.keys(selection)) {
    selection[groupId] = line.modifiers
      .filter((modifier) => modifier.groupId === groupId)
      .map((modifier) => modifier.optionId);
  }
  return selection;
}

function requirement(group: ModifierGroup): string {
  if (group.min === 0) {
    return group.max === 1 ? "Opcional" : `Opcional · hasta ${group.max}`;
  }
  return group.max === 1 ? "Obligatorio · elige 1" : "Obligatorio";
}

function problemText(reason: ModifierError["reason"], group: ModifierGroup) {
  if (reason === "too-many") return `Máximo ${group.max}.`;
  return "Elige una opción para continuar.";
}

export function ModifierDialog({
  catalog,
  product,
  line,
  onCancel,
  onConfirm,
}: ModifierDialogProps) {
  const groups = modifierGroupsFor(catalog, product);
  const [selection, setSelection] = useState(() =>
    selectionOf(catalog, product, line),
  );
  const [note, setNote] = useState(line?.note ?? "");
  const [problem, setProblem] = useState<ModifierError | null>(null);

  const unitCents = groups.reduce(
    (total, group) =>
      group.options.reduce(
        (sum, option) =>
          (selection[group.id] ?? []).includes(option.id)
            ? sum + option.priceDeltaCents
            : sum,
        total,
      ),
    line?.unitPriceCents ?? product.priceCents,
  );

  function toggle(group: ModifierGroup, optionId: string) {
    setProblem(null);
    setSelection((current) => {
      const chosen = current[group.id] ?? [];
      if (group.max === 1) {
        const cleared = chosen.includes(optionId) && group.min === 0;
        return { ...current, [group.id]: cleared ? [] : [optionId] };
      }
      if (chosen.includes(optionId)) {
        return {
          ...current,
          [group.id]: chosen.filter((id) => id !== optionId),
        };
      }
      if (chosen.length >= group.max) return current;
      return { ...current, [group.id]: [...chosen, optionId] };
    });
  }

  function confirm() {
    try {
      onConfirm(resolveModifiers(catalog, product, selection), note);
    } catch (error) {
      if (!(error instanceof ModifierError)) throw error;
      setProblem(error);
    }
  }

  const price = formatMXN(unitCents);

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-4 overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{line?.name ?? product.name}</DialogTitle>
          <DialogDescription>
            Precio de la partida:{" "}
            <span
              data-testid="modifier-price"
              className="font-medium text-foreground tabular-nums"
            >
              {price}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1">
          {groups.map((group) => {
            const single = group.max === 1;
            const invalid = problem?.groupId === group.id;
            const chosen = selection[group.id] ?? [];
            return (
              <fieldset
                key={group.id}
                role={single ? "radiogroup" : "group"}
                aria-label={group.name}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? `${group.id}-problem` : undefined}
                className="flex flex-col gap-2"
              >
                <legend className="flex w-full items-baseline justify-between gap-2 pb-2 text-sm font-medium">
                  {group.name}
                  <span className="text-xs font-normal text-muted-foreground">
                    {requirement(group)}
                  </span>
                </legend>
                <div className="flex flex-wrap gap-2">
                  {group.options.map((option) => {
                    const checked = chosen.includes(option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role={single ? "radio" : "checkbox"}
                        aria-checked={checked}
                        onClick={() => toggle(group, option.id)}
                        className={cn(
                          "inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-button)] border border-border bg-card px-3 text-sm outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-ring",
                          checked &&
                            "border-primary bg-primary font-medium text-primary-foreground",
                        )}
                      >
                        {option.name}
                        {option.priceDeltaCents > 0 && (
                          <span className="tabular-nums">
                            +{formatMXN(option.priceDeltaCents)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {invalid && problem && (
                  <p
                    id={`${group.id}-problem`}
                    role="alert"
                    className="text-sm font-medium text-foreground"
                  >
                    Falta «{group.name}». {problemText(problem.reason, group)}
                  </p>
                )}
              </fieldset>
            );
          })}

          <div className="flex flex-col gap-2">
            <Label htmlFor="line-note">Nota de preparación</Label>
            <Textarea
              id="line-note"
              rows={2}
              placeholder="Ej. sin azúcar"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button onClick={confirm}>
            {line ? "Guardar cambios" : "Agregar"} · {price}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
