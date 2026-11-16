import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { findProduct, modifierGroupsFor } from "../../domain/catalog.ts";
import type { Product } from "../../domain/catalog.ts";
import { editLine } from "../../domain/modifiers.ts";
import { formatMXN } from "../../domain/money.ts";
import {
  addLine,
  changeQuantity,
  orderTotals,
  removeLine,
} from "../../domain/order.ts";
import type { LineModifier, OrderLine } from "../../domain/order.ts";
import { catalog } from "../catalog.ts";
import { useDraft } from "../draft.ts";
import { newId } from "../ids.ts";
import { ModifierDialog } from "../station/ModifierDialog.tsx";
import { OrderPanel, itemCountLabel } from "../station/OrderPanel.tsx";
import { ProductGrid } from "../station/ProductGrid.tsx";

type Editing =
  | { kind: "add"; product: Product }
  | { kind: "edit"; product: Product; line: OrderLine };

/** A product as it was captured, for re-editing a line whose product left the menu. */
function productOf(line: OrderLine): Product {
  return (
    findProduct(catalog, line.productId) ?? {
      id: line.productId,
      sku: line.productId,
      name: line.name,
      categoryId: "",
      priceCents: line.unitPriceCents,
      available: true,
      modifierGroupIds: [],
    }
  );
}

export function Station() {
  const [draft, setDraft] = useDraft();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { lines } = draft;
  const totals = orderTotals(lines, catalog.taxRateBps);

  function setLines(next: OrderLine[]) {
    setDraft({ ...draft, lines: next });
  }

  function pick(product: Product) {
    if (modifierGroupsFor(catalog, product).length > 0) {
      setEditing({ kind: "add", product });
      return;
    }
    setLines(addLine(lines, product, { lineId: newId() }));
  }

  function confirm(modifiers: LineModifier[], note: string) {
    if (!editing) return;
    setLines(
      editing.kind === "add"
        ? addLine(lines, editing.product, { lineId: newId(), modifiers, note })
        : editLine(lines, editing.line.lineId, { modifiers, note }),
    );
    setEditing(null);
  }

  const panel = (
    <OrderPanel
      lines={lines}
      taxRateBps={catalog.taxRateBps}
      onChangeQuantity={(lineId, delta) =>
        setLines(changeQuantity(lines, lineId, delta))
      }
      onRemove={(lineId) => setLines(removeLine(lines, lineId))}
      onEdit={(line) =>
        setEditing({ kind: "edit", product: productOf(line), line })
      }
    />
  );

  return (
    <div className="flex min-h-0 flex-1">
      <h1 className="sr-only">Venta</h1>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col p-4">
        <ProductGrid catalog={catalog} onPick={pick} />
      </div>

      <aside className="hidden w-[23rem] shrink-0 flex-col border-l border-border bg-card lg:flex">
        {panel}
      </aside>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
        <Button
          size="lg"
          className="w-full justify-between"
          onClick={() => setSheetOpen(true)}
        >
          <span>Ver orden · {itemCountLabel(totals.itemCount)}</span>
          <span className="tabular-nums">{formatMXN(totals.totalCents)}</span>
        </Button>
      </div>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 bg-card p-0 sm:max-w-md"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Orden actual</SheetTitle>
            <SheetDescription>
              Partidas y total de la orden en captura.
            </SheetDescription>
          </SheetHeader>
          {panel}
        </SheetContent>
      </Sheet>

      {editing && (
        <ModifierDialog
          key={
            editing.kind === "edit" ? editing.line.lineId : editing.product.id
          }
          catalog={catalog}
          product={editing.product}
          line={editing.kind === "edit" ? editing.line : undefined}
          onCancel={() => setEditing(null)}
          onConfirm={confirm}
        />
      )}
    </div>
  );
}
