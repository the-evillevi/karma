# Karma POS

Offline-first point of sale for Karma, a single-branch café in Mexico (MXN). One PWA covers the register, menu, kitchen tickets (comandas), inventory and reports. The network must never block a sale.

- Linear project: https://linear.app/evillevi/project/karma-pos-93089f28b35a
- Business decisions log: [EVL-111](https://linear.app/evillevi/issue/EVL-111) (VAT, tables, tips, roles, backups)
- Roles: **Admin**, **Barra**, **Mesero**

## Specs live in Linear issues

There are no spec files in this repo. The Linear issue is the spec:

- **Historia**: who wants what, and why.
- **Criterios de aceptación**: Given/When/Then scenarios (_Dado / Cuando / Entonces_) with real values.
- **Rebanadas** (slices) [A], [B]…: large stories are delivered one slice per PR, in order.

Each scenario becomes at least one test, named after the scenario title. Keep the Spanish title in the test name so it can be traced back to the issue:

```ts
it("[A] Propina libre muestra su porcentaje sin rechazarla", () => { … });
```

If a scenario is ambiguous or missing, stop and ask; don't invent behavior. Only issues in the user-story template are ready to build. Older issues get rewritten into the template when someone picks them up.

## TDD loop

1. Pick an issue (or one slice) and read every scenario.
2. Write a failing test for the first scenario.
3. `pnpm test:domain` should show it red, for the right reason.
4. Write the minimum code to make it green.
5. Refactor while green, then move to the next scenario.
6. `pnpm check` before opening the PR.

| Command            | Use                                                          |
| ------------------ | ------------------------------------------------------------ |
| `pnpm test:domain` | Fast inner loop (pure domain tests, about a second)          |
| `pnpm test`        | All tests                                                    |
| `pnpm check`       | Full gate: format, lint, types, tests, build. CI runs this.  |
| `pnpm test:e2e`    | Real-browser flows (Playwright) against the production build |

## Code layout

Three layers. Each one is tested on its own, and rules live only in the first.

| Layer  | Path          | What goes here                                                                                                                         | Tests                                                  |
| ------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Domain | `src/domain/` | Pure TypeScript: money, catalog, order lines, payments, the journal and its commands. No React, no I/O, no clock, no randomness.       | `*.test.ts` next to the code, node environment         |
| Data   | `src/data/`   | `PosStore` (journal + replayed state) and its storage: RxDB over IndexedDB in the browser, memory in tests.                            | `storage-contract.ts` runs against every storage       |
| App    | `src/app/`    | Screens in TSX built from `src/components/ui/` and `DESIGN.md`. Screens call domain functions; they hold no price or permission logic. | Testing Library per screen (`*.test.tsx`), plus `e2e/` |

Read `docs/architecture.md` before changing the journal, a command or the store.

- `catalog/catalog.json`: the menu, generated from the workbook Carlos validated (see `catalog/README.md`). The SKU is the product ID.
- `src/PosApp.jsx`, `src/ComandaApp.jsx`, `src/karma-data.js`, `prototype*.html`: the original prototype. A visual reference only. Don't extend it.

Reference docs: `docs/architecture.md` (how the layers fit), `DESIGN.md` (visual system), `docs/decisions/ADR-001-offline-first-storage.md` (RxDB + Supabase), `docs/domain/order-lifecycle.md` (order states and events).

## Where the project stands

The Linear document **"Estado del piloto"** (in the Karma POS project) lists what has shipped, the next slices in order and the open questions for Carlos. Update it when a slice merges.

## Adding a slice, step by step

1. Read the slice's scenarios in its Linear issue. If one is missing or unclear, fix the issue first (ask Levi for business rules).
2. Branch from `main` as `evl-<number>-<slice letter>-<short-name>`, for example `evl-125-a-cancelar-con-motivo`.
3. **Red.** Add the function signatures with bodies that `throw new Error("not implemented")`, and one `it()` per scenario titled exactly like the scenario. Shared fixtures are in `src/domain/testing.ts` (domain) and `src/app/testing.tsx` (`renderApp`). Run `pnpm test:domain`, confirm the failures say "not implemented", and commit `test(EVL-nnn [X]): … (red)`.
4. **Green.** Implement without touching the tests. A new operation is a command: a pure function `(state, meta, input) => CommandBatch` that checks permissions with `can()` first, throws `CommandRejectedError` for rule violations, and returns events; then add the event's case to `applyBatch` in `journal.ts`. Commit `feat(EVL-nnn [X]): …`.
5. `pnpm check`, and `pnpm test:e2e` if a screen or storage changed.
6. Open the PR titled `EVL-nnn [X]: short summary` with a scenario → test table. Merge with a merge commit when CI (`quality` and `e2e`) is green.
7. Comment on the Linear issue with the PR link. **Linear closes an issue when any PR that names it merges**: if slices remain, move the issue back to In Progress.

Operator-facing text is Spanish. New rejection reasons need their message in `src/app/errors.ts`.

## Rules that tests must protect

- Money is **integer centavos**. Never use floats for money. Percentages are display-only.
- Prices include IVA. Captured prices are snapshots and never change when the catalog changes.
- Payment state and kitchen preparation state are independent.
- Closed sales are never edited or deleted. Corrections are new compensating events with actor, time and reason.
- Every operation has a stable ID, and retries must not duplicate it.

## Conventions

- Linear text in Spanish; code, identifiers and commit messages in English.
- Branch: use the issue's `gitBranchName` from Linear (for example `evl-123-cobrar-una-orden…`).
- One issue or slice per PR. PR title: `EVL-123 [A]: short summary`.
- Add a dependency only in the PR that first needs it.
- No comments in our code; ESLint rejects them. The code is the documentation: if something needs explaining, rename or extract until it doesn't. Only tool directives are allowed (`// @vitest-environment …`, `/// <reference types="…" />`). Vendored shadcn components in `src/components/ui/` are exempt.
- No `useEffect` or `useLayoutEffect` in `src/app/`; ESLint rejects them. Derive values during render, act in the event handler, or subscribe with `useSyncExternalStore`.
