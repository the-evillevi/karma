# Karma POS architecture

How the app is put together as of the pilot (17 November 2026). Business rules are in the Linear issues and in `docs/domain/order-lifecycle.md`; this document explains where code goes and why.

## One idea: an operations journal

Nothing in the app edits stored state. Every operation (save an account, send a comanda, advance its preparation, close a sale, change the table count) is appended to a journal as one immutable **command batch**:

```ts
type CommandBatch = {
  commandId: string; // stable across retries
  at: string;        // device local time, ISO 8601 with offset
  actor: { userId, name, role };
  deviceId: string;
  events: PosEvent[]; // what happened, e.g. { type: "sale-closed", … }
};
```

The current state (`PosState`: orders, comandas, table count) is rebuilt by **replaying** the batches in order (`replay` / `applyBatch` in `src/domain/journal.ts`). This gives the rules in `AGENTS.md` for free:

- **Retries don't duplicate.** Applying a `commandId` twice is a no-op; reusing it with different content throws `JournalConflictError`.
- **Closed sales are never edited.** There is no update path, only new events. Corrections (EVL-125) will be compensating events.
- **Captured prices are snapshots.** `order-saved` stores the full lines, with names, prices and modifiers as captured.
- **Payment and preparation are independent.** `sale-closed` touches the order; `comanda-sent` and `preparation-advanced` touch comandas.
- **Sync later is "send the batches".** EVL-126 [C]–[E] push the same documents to the server and mark them acknowledged.

## The path of an operation

```
screen ── useCommand(decide) ──▶ decide(state, meta)        src/domain/*.ts   pure, may throw CommandRejectedError
                                   │ returns CommandBatch
                                   ▼
                              PosStore.commit(batch)         src/data/pos-store.ts
                                   │ 1. applyBatch on a candidate state (catches conflicts)
                                   │ 2. storage.append(batch)  — if this fails: StorageWriteError, state unchanged
                                   │ 3. publish the new state, notify subscribers
                                   ▼
                              usePosState() re-renders screens (and other tabs, via storage.subscribe)
```

`useCommand` (in `src/app/context.tsx`) builds `meta`: a new `commandId`, the local time, the signed-in user as actor and the device ID. Domain code never reads the clock or generates IDs.

## Commands and events today

| Command (file) | Event | Who may |
| --- | --- | --- |
| `saveOrder` (`commands.ts`) | `order-saved` | all roles |
| `sendComanda` (`comanda.ts`) | `comanda-sent` | all roles |
| `advancePreparation` (`comanda.ts`) | `preparation-advanced` | all roles |
| `closeSale` (`checkout.ts`) | `sale-closed` | Admin, Barra |
| `configureTables` (`tables.ts`) | `tables-configured` | Admin |

Read-only helpers: `openOrders`, `accountSummary` (`accounts.ts`), `pendingComandas`, `hasUnsentLines` (`comanda.ts`), `closedSales` (`checkout.ts`), `daySummary` (`sales.ts`).

Pure calculation modules, usable without the journal: `money.ts`, `tip.ts`, `payment.ts`, `order.ts`, `modifiers.ts`, `catalog.ts`, `order-header.ts`, `access.ts`.

## Storage

`JournalStorage` (`src/data/pos-store.ts`) has three methods: `load`, `append`, `subscribe`. Two implementations pass the same contract suite (`src/data/storage-contract.ts`):

- `createMemoryStorage` for tests.
- `createRxdbStorage` (`src/data/rxdb-storage.ts`): RxDB collection `command_batches`, one document per batch, ordered by an append sequence. In the browser it uses the Dexie engine (IndexedDB), database name `karmapos`. `multiInstance` lets the kitchen tab hear inserts from the register tab.

Not in the journal:

- The **draft** order being captured (`src/app/draft.ts`) lives in `localStorage` until it is saved. It is a convenience, not a record.
- The **catalog** is bundled from `catalog/catalog.json` and validated by `parseCatalog` at start. Editing the menu in the app is EVL-119.
- **Users** for the pilot are constants with PIN digests (`src/app/users.ts`). Managing them is EVL-118 [C].

## Screens

Hash routes in `src/app/router.ts`: `#/` Venta, `#/cuentas` Cuentas abiertas, `#/cocina` Cocina, `#/ventas` Ventas de hoy. The kitchen is the same app in another tab of the same browser.

`src/app/main.tsx` opens the store before rendering and refuses to run if local storage cannot be opened. `App.tsx` shows the PIN screen until someone signs in. Screens hide what a role cannot do, and the commands refuse it regardless.

The service worker from `vite-plugin-pwa` precaches the app shell, so after one online visit the app opens with no network.

## What the pilot deliberately leaves out

One device, no cloud sync (EVL-126 [C]–[E]), no printing (EVL-124 [D]), one payment per order (EVL-192), no cancellations or discounts (EVL-125, EVL-189), no inventory (EVL-128, EVL-129), no menu or user editing (EVL-119, EVL-118 [C]).

## Known limits to revisit

- `applyBatch` clones the whole state per batch and startup replays the whole journal. Fine for weeks of a single café; add snapshots before it holds months of data.
- The journal order is the local append sequence. With a server, ordering and conflicts follow ADR-001.
- Data lives only in one browser profile's IndexedDB. Clearing site data erases it; there is no export yet (EVL-127).
