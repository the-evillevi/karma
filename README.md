# Karma POS

Offline-first point of sale for a single-branch café in Mexico (MXN). One PWA covers the register, menu, kitchen tickets (comandas), inventory and reports.

**Working on this repo? Read [`AGENTS.md`](AGENTS.md) first.** Specs live in Linear issues; every scenario becomes a test.

## Run

This project uses **pnpm**.

```sh
pnpm install      # first time
pnpm dev          # dev server (Vite)
pnpm test:domain  # fast inner loop
pnpm check        # full gate: format, lint, types, tests, build
```

| URL                       | What                                                           |
| ------------------------- | -------------------------------------------------------------- |
| `/`                       | The app (`src/app`). The kitchen view is `/#/cocina`.          |
| `/prototype.html`         | The original prototype, kept as a visual reference.            |
| `/prototype-comanda.html` | The prototype's kitchen screen. Shares `localStorage` with it. |

## Layout

```
src/domain/          Pure business logic in TypeScript, tests next to code
src/app/             The app: screens in TSX built from src/components/ui
src/components/ui/   shadcn/ui primitives styled from DESIGN.md
catalog/             catalog.json, generated from the workbook Carlos validated
docs/                ADRs and the order lifecycle contract
src/PosApp.jsx, src/ComandaApp.jsx, src/karma-data.js, src/css.js
                     The prototype. Reference only; do not extend it.
design/              Original design export, kept for reference
```

> `pnpm-workspace.yaml` approves `esbuild`'s install script via `allowBuilds` (pnpm 11 blocks dependency build scripts until approved).
