import type { Role } from "./access.ts";
import type { Category, ModifierOption, Product } from "./catalog.ts";
import type {
  CategoryChanges,
  GroupOptionEdits,
  MenuState,
  OptionChanges,
  ProductChanges,
} from "./menu.ts";
import { emptyMenu } from "./menu.ts";
import type { OrderLine, OrderTotals } from "./order.ts";
import type { Settlement } from "./payment.ts";

export type Actor = { userId: string; name: string; role: Role };

export type CommandMeta = {
  commandId: string;
  at: string;
  actor: Actor;
  deviceId: string;
};

export type OrderType = "mostrador" | "mesa" | "recoger" | "entrega";

export type Customer = { name: string; phone: string; address: string };

export type OrderHeader = {
  type: OrderType;
  table: number | null;
  customer: Customer;
};

export type PreparationStatus = "queued" | "preparing" | "ready" | "served";

export type ComandaLine = {
  lineId: string;
  name: string;
  quantity: number;
  modifiers: string[];
  note: string;
};

export type PosEvent =
  | {
      type: "order-saved";
      orderId: string;
      folio: string;
      header: OrderHeader;
      lines: OrderLine[];
    }
  | {
      type: "comanda-sent";
      orderId: string;
      comandaId: string;
      lines: ComandaLine[];
    }
  | {
      type: "preparation-advanced";
      comandaId: string;
      status: PreparationStatus;
    }
  | {
      type: "sale-closed";
      orderId: string;
      tipCents: number;
      settlement: Settlement;
      totals: OrderTotals;
    }
  | { type: "tables-configured"; count: number }
  | { type: "product-updated"; productId: string; changes: ProductChanges }
  | { type: "product-created"; product: Product }
  | { type: "category-created"; category: Category }
  | { type: "category-updated"; categoryId: string; changes: CategoryChanges }
  | { type: "categories-reordered"; categoryIds: string[] }
  | { type: "products-reordered"; categoryId: string; productIds: string[] }
  | {
      type: "modifier-option-updated";
      groupId: string;
      optionId: string;
      changes: OptionChanges;
    }
  | { type: "modifier-option-added"; groupId: string; option: ModifierOption };

export type CommandBatch = CommandMeta & { events: PosEvent[] };

export type ClosedSale = {
  closedAt: string;
  closedBy: Actor;
  tipCents: number;
  settlement: Settlement;
  totals: OrderTotals;
};

export type Order = {
  orderId: string;
  folio: string;
  header: OrderHeader;
  lines: OrderLine[];
  status: "open" | "paid";
  version: number;
  openedAt: string;
  openedBy: Actor;
  updatedAt: string;
  updatedBy: Actor;
  sentQuantities: Record<string, number>;
  sale: ClosedSale | null;
};

export type Comanda = {
  comandaId: string;
  orderId: string;
  folio: string;
  header: OrderHeader;
  lines: ComandaLine[];
  status: PreparationStatus;
  sentAt: string;
  sentBy: Actor;
  updatedAt: string;
};

export type PosState = {
  orders: Record<string, Order>;
  comandas: Record<string, Comanda>;
  tableCount: number;
  lastFolioNumber: number;
  menu: MenuState;
  applied: Record<string, string>;
};

export const DEFAULT_TABLE_COUNT = 8;

export class JournalConflictError extends Error {
  readonly commandId: string;

  constructor(commandId: string) {
    super(`Command ${commandId} was already applied with different content`);
    this.name = "JournalConflictError";
    this.commandId = commandId;
  }
}

export function emptyState(): PosState {
  return {
    orders: {},
    comandas: {},
    tableCount: DEFAULT_TABLE_COUNT,
    lastFolioNumber: 0,
    menu: emptyMenu(),
    applied: {},
  };
}

export function folioFor(folioNumber: number): string {
  return `A-${String(folioNumber).padStart(4, "0")}`;
}

function fingerprint(batch: CommandBatch): string {
  return JSON.stringify(batch, (_key, value: unknown) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, record[key]]),
      );
    }
    return value;
  });
}

function groupOptionEdits(menu: MenuState, groupId: string): GroupOptionEdits {
  return Object.hasOwn(menu.modifierOptions, groupId)
    ? menu.modifierOptions[groupId]
    : { changes: {}, added: [] };
}

export function applyBatch(state: PosState, batch: CommandBatch): PosState {
  const identity = fingerprint(batch);
  if (Object.hasOwn(state.applied, batch.commandId)) {
    if (state.applied[batch.commandId] !== identity) {
      throw new JournalConflictError(batch.commandId);
    }
    return state;
  }
  const next = structuredClone(state);
  const snapshot = structuredClone(batch);
  for (const event of snapshot.events) {
    switch (event.type) {
      case "order-saved": {
        const existing = Object.hasOwn(next.orders, event.orderId)
          ? next.orders[event.orderId]
          : undefined;
        const order: Order = existing
          ? {
              ...existing,
              header: event.header,
              lines: event.lines,
              version: existing.version + 1,
              updatedAt: snapshot.at,
              updatedBy: snapshot.actor,
            }
          : {
              orderId: event.orderId,
              folio: event.folio,
              header: event.header,
              lines: event.lines,
              status: "open",
              version: 1,
              openedAt: snapshot.at,
              updatedAt: snapshot.at,
              openedBy: snapshot.actor,
              updatedBy: snapshot.actor,
              sentQuantities: {},
              sale: null,
            };
        next.orders = { ...next.orders, [event.orderId]: order };
        if (!existing) {
          next.lastFolioNumber = Math.max(
            next.lastFolioNumber,
            Number(event.folio.slice(2)),
          );
        }
        break;
      }
      case "tables-configured":
        next.tableCount = event.count;
        break;
      case "comanda-sent": {
        const order = next.orders[event.orderId];
        next.comandas = {
          ...next.comandas,
          [event.comandaId]: {
            comandaId: event.comandaId,
            orderId: event.orderId,
            folio: order.folio,
            header: structuredClone(order.header),
            lines: event.lines,
            status: "queued",
            sentAt: snapshot.at,
            sentBy: snapshot.actor,
            updatedAt: snapshot.at,
          },
        };
        for (const line of event.lines) {
          const sent = Object.hasOwn(order.sentQuantities, line.lineId)
            ? order.sentQuantities[line.lineId]
            : 0;
          order.sentQuantities = {
            ...order.sentQuantities,
            [line.lineId]: sent + line.quantity,
          };
        }
        break;
      }
      case "preparation-advanced":
        next.comandas[event.comandaId].status = event.status;
        next.comandas[event.comandaId].updatedAt = snapshot.at;
        break;
      case "sale-closed":
        next.orders = {
          ...next.orders,
          [event.orderId]: {
            ...next.orders[event.orderId],
            status: "paid",
            sale: {
              closedAt: snapshot.at,
              closedBy: snapshot.actor,
              tipCents: event.tipCents,
              settlement: event.settlement,
              totals: event.totals,
            },
          },
        };
        break;
      case "product-updated": {
        const existing = Object.hasOwn(next.menu.products, event.productId)
          ? next.menu.products[event.productId]
          : undefined;
        next.menu = {
          ...next.menu,
          products: {
            ...next.menu.products,
            [event.productId]: {
              changes: { ...existing?.changes, ...event.changes },
              lastEdit: { at: snapshot.at, by: snapshot.actor },
            },
          },
        };
        break;
      }
      case "product-created": {
        const { product } = event;
        const existing = Object.hasOwn(next.menu.products, product.id)
          ? next.menu.products[product.id]
          : undefined;
        next.menu = {
          ...next.menu,
          created: [...next.menu.created, product],
          products: {
            ...next.menu.products,
            [product.id]: {
              changes: existing?.changes ?? {},
              lastEdit: { at: snapshot.at, by: snapshot.actor },
            },
          },
        };
        break;
      }
      case "category-created":
        next.menu.createdCategories.push(event.category);
        break;
      case "category-updated": {
        const existing = Object.hasOwn(next.menu.categories, event.categoryId)
          ? next.menu.categories[event.categoryId]
          : undefined;
        next.menu.categories = {
          ...next.menu.categories,
          [event.categoryId]: { ...existing, ...event.changes },
        };
        break;
      }
      case "categories-reordered":
        next.menu.categoryOrder = event.categoryIds;
        break;
      case "products-reordered": {
        next.menu.productOrder = {
          ...next.menu.productOrder,
          [event.categoryId]: event.productIds,
        };
        break;
      }
      case "modifier-option-updated": {
        const edits = groupOptionEdits(next.menu, event.groupId);
        const previous = Object.hasOwn(edits.changes, event.optionId)
          ? edits.changes[event.optionId]
          : undefined;
        next.menu.modifierOptions = {
          ...next.menu.modifierOptions,
          [event.groupId]: {
            ...edits,
            changes: {
              ...edits.changes,
              [event.optionId]: { ...previous, ...event.changes },
            },
          },
        };
        break;
      }
      case "modifier-option-added": {
        const edits = groupOptionEdits(next.menu, event.groupId);
        next.menu.modifierOptions = {
          ...next.menu.modifierOptions,
          [event.groupId]: { ...edits, added: [...edits.added, event.option] },
        };
        break;
      }
      default: {
        const unhandled: never = event;
        throw new Error(`Unknown event: ${JSON.stringify(unhandled)}`);
      }
    }
  }
  next.applied = { ...next.applied, [snapshot.commandId]: identity };
  return next;
}

export function replay(batches: readonly CommandBatch[]): PosState {
  return batches.reduce(applyBatch, emptyState());
}
