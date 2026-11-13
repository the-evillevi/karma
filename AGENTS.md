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

| Command            | Use                                                         |
| ------------------ | ----------------------------------------------------------- |
| `pnpm test:domain` | Fast inner loop (pure domain tests, about a second)         |
| `pnpm test`        | All tests                                                   |
| `pnpm check`       | Full gate: format, lint, types, tests, build. CI runs this. |

## Code layout

- `src/domain/`: pure business logic in TypeScript. No React and no I/O. Tests sit next to code as `*.test.ts`.
- `src/components/ui/`: shadcn/ui primitives styled from `DESIGN.md`.
- `src/PosApp.jsx`, `src/ComandaApp.jsx`, `src/karma-data.js`: the original prototype. It's a visual and behavioral reference, to be replaced screen by screen. Don't extend it.
- `catalog/catalog.json`: normalized menu (not yet validated, see EVL-112).

Reference docs: `DESIGN.md` (visual system), `docs/decisions/ADR-001-offline-first-storage.md` (RxDB + Supabase), `docs/domain/order-lifecycle.md` (order states and events).

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
