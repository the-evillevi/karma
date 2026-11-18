import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { can } from "../../domain/access.ts";
import { findProduct, modifierGroupsFor } from "../../domain/catalog.ts";
import type { Product } from "../../domain/catalog.ts";
import { closeSale } from "../../domain/checkout.ts";
import type { CloseSaleInput } from "../../domain/checkout.ts";
import { sendComanda } from "../../domain/comanda.ts";
import { saveOrder } from "../../domain/commands.ts";
import type { Order } from "../../domain/journal.ts";
import { editLine } from "../../domain/modifiers.ts";
import { formatMXN } from "../../domain/money.ts";
import {
  addLine,
  changeQuantity,
  orderTotals,
  removeLine,
} from "../../domain/order.ts";
import type { LineModifier, OrderLine } from "../../domain/order.ts";
import { tableNumbers } from "../../domain/tables.ts";
import { catalog } from "../catalog.ts";
import { CheckoutDialog } from "../checkout/CheckoutDialog.tsx";
import { Ticket } from "../checkout/Ticket.tsx";
import { useCommand, usePosState, useSession } from "../context.tsx";
import { EMPTY_DRAFT, loadDraft, useDraft } from "../draft.ts";
import type { Draft } from "../draft.ts";
import { errorMessage } from "../errors.ts";
import { newId } from "../ids.ts";
import { HeaderEditor } from "../station/HeaderEditor.tsx";
import { ModifierDialog } from "../station/ModifierDialog.tsx";
import { OrderPanel, itemCountLabel } from "../station/OrderPanel.tsx";
import { ProductGrid } from "../station/ProductGrid.tsx";
import { useToast } from "../toast.tsx";

type Editing =
  | { kind: "add"; product: Product }
  | { kind: "edit"; product: Product; line: OrderLine };

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
  const state = usePosState();
  const run = useCommand();
  const notify = useToast();
  const { user } = useSession();
  const [draft, setDraft] = useDraft();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [charging, setCharging] = useState<string | null>(null);
  const [ticket, setTicket] = useState<Order | null>(null);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const chargingOrder = charging ? state.orders[charging] : undefined;

  const { lines } = draft;
  const totals = orderTotals(lines, catalog.taxRateBps);
  const account = draft.orderId ? state.orders[draft.orderId] : undefined;
  const sentQuantities = account?.sentQuantities ?? {};
  const mayCharge = user ? can(user.role, "charge") : false;

  function setLines(next: OrderLine[]) {
    if (busyRef.current) return;
    setFailure("");
    setDraft({ ...draft, lines: next });
  }

  function pick(product: Product) {
    if (busyRef.current) return;
    if (modifierGroupsFor(catalog, product).length > 0) {
      setEditing({ kind: "add", product });
      return;
    }
    setLines(addLine(lines, product, { lineId: newId() }));
  }

  function confirmLine(modifiers: LineModifier[], note: string) {
    if (!editing || busyRef.current) return;
    setLines(
      editing.kind === "add"
        ? addLine(lines, editing.product, { lineId: newId(), modifiers, note })
        : editLine(lines, editing.line.lineId, { modifiers, note }),
    );
    setEditing(null);
  }

  async function save(): Promise<{
    order: Order;
    orderId: string;
    savedDraft: Draft | null;
  }> {
    const captured = draft;
    const orderId = captured.orderId ?? newId();
    const after = await run((current, meta) =>
      saveOrder(current, meta, {
        orderId,
        expectedVersion: captured.baseVersion,
        header: captured.header,
        lines: captured.lines,
      }),
    );
    const order = after.orders[orderId];
    const savedDraft =
      loadDraft() === captured
        ? { ...captured, orderId, baseVersion: order.version }
        : null;
    if (savedDraft) setDraft(savedDraft);
    return { order, orderId, savedDraft };
  }

  function clearSavedDraft(saved: Draft | null) {
    if (saved && loadDraft() === saved) setDraft(EMPTY_DRAFT);
  }

  async function attempt(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFailure("");
    try {
      await action();
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const saveAccount = () =>
    attempt(async () => {
      const { order, savedDraft } = await save();
      clearSavedDraft(savedDraft);
      setSheetOpen(false);
      notify(`Cuenta ${order.folio} guardada`);
    });

  const sendToKitchen = () =>
    attempt(async () => {
      const { order, orderId, savedDraft } = await save();
      await run((current, meta) =>
        sendComanda(current, meta, { orderId, comandaId: newId() }),
      );
      clearSavedDraft(savedDraft);
      setSheetOpen(false);
      notify(`Comanda de ${order.folio} enviada a cocina`);
    });

  const startCharge = () =>
    attempt(async () => {
      const { order } = await save();
      setSheetOpen(false);
      setCharging(order.orderId);
    });

  async function confirmCharge(input: CloseSaleInput) {
    const captured = loadDraft();
    const after = await run((current, meta) =>
      closeSale(current, meta, input, catalog.taxRateBps),
    );
    setCharging(null);
    clearSavedDraft(captured);
    setTicket(after.orders[input.orderId]);
  }

  const empty = lines.length === 0;
  const actions = (
    <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
      <p role="alert" className="min-h-5 text-sm font-medium">
        {failure}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          disabled={empty || busy}
          onClick={saveAccount}
        >
          Guardar cuenta
        </Button>
        <Button
          variant="outline"
          disabled={empty || busy}
          onClick={sendToKitchen}
        >
          Enviar comanda
        </Button>
      </div>
      {mayCharge && (
        <Button size="lg" disabled={empty || busy} onClick={startCharge}>
          Cobrar · {formatMXN(totals.totalCents)}
        </Button>
      )}
      {(draft.orderId !== null || !empty) && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            setFailure("");
            setDraft(EMPTY_DRAFT);
          }}
        >
          {draft.orderId !== null
            ? "Dejar de editar la cuenta"
            : "Vaciar orden"}
        </Button>
      )}
    </div>
  );

  const panel = (
    <OrderPanel
      title={account ? `Cuenta ${account.folio}` : "Orden actual"}
      lines={lines}
      busy={busy}
      taxRateBps={catalog.taxRateBps}
      sentQuantities={sentQuantities}
      header={
        <HeaderEditor
          header={draft.header}
          tables={tableNumbers(state)}
          onChange={(header) => {
            if (busyRef.current) return;
            setFailure("");
            setDraft({ ...draft, header });
          }}
        />
      }
      actions={actions}
      onChangeQuantity={(lineId, delta) => {
        if (!busyRef.current) setLines(changeQuantity(lines, lineId, delta));
      }}
      onRemove={(lineId) => {
        if (!busyRef.current) setLines(removeLine(lines, lineId));
      }}
      onEdit={(line) => {
        if (!busyRef.current)
          setEditing({ kind: "edit", product: productOf(line), line });
      }}
    />
  );

  return (
    <div className="flex min-h-0 flex-1">
      <h1 className="sr-only">Venta</h1>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col p-4">
        <ProductGrid catalog={catalog} onPick={pick} busy={busy} />
      </div>

      <aside className="hidden w-[24rem] shrink-0 flex-col border-l border-border bg-card lg:flex">
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
          onConfirm={confirmLine}
        />
      )}

      {chargingOrder && (
        <CheckoutDialog
          order={chargingOrder}
          taxRateBps={catalog.taxRateBps}
          onCancel={() => setCharging(null)}
          onConfirm={confirmCharge}
          errorText={errorMessage}
        />
      )}

      {ticket && (
        <TicketDialog order={ticket} onClose={() => setTicket(null)} />
      )}
    </div>
  );
}

export function TicketDialog({
  order,
  onClose,
}: {
  order: Order;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[95dvh] flex-col gap-4 overflow-hidden sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Venta {order.folio} cobrada</DialogTitle>
          <DialogDescription>
            El ticket se muestra en pantalla; la impresión llega después del
            piloto.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Ticket order={order} />
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Listo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
