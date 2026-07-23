# Karma POS

Punto de venta para cafetería (Karma · Abboth) — a **Vite + React** app.

Originally imported from the Claude Design project **"Karma POS para cafetería"**
as a self-contained [Datacosm](https://claude.ai/design) (`.dc.html`) prototype,
then migrated to a standard Vite React app: the declarative `<x-dc>` templates
were converted to native JSX and the custom `support.js` runtime (which loaded
React/ReactDOM/Babel from a CDN) was dropped. React is now a bundled dependency —
no CDN, no runtime Babel, no network needed to run.

## Structure

```
index.html            POS entry     → src/pos-main.jsx
comanda.html          Comanda entry → src/comanda-main.jsx
src/
  PosApp.jsx          Main app — login/PIN, punto de venta, órdenes, cobro,
                      menú, inventario, reportes, usuarios (React.Component)
  ComandaApp.jsx      Kitchen/bar ticket display
  karma-data.js       Seed data (products, modifiers, users, inventory, sales…)
  css.js              css("a:b;c:d") → React style object (bridges the many
                      inline-style strings ported from the templates)
  styles.css          Global CSS (resets, keyframes; body bg per page)
vite.config.js        Multi-page build (POS + Comanda entries)
design/               Original .dc.html + support.js, kept for reference
```

The two pages share state through `localStorage` (key `karma-pos-v1`); the POS
and Comanda screens stay in sync live (via `storage` events + polling).

## Run

This project uses **pnpm**.

```sh
pnpm install      # first time
pnpm dev          # dev server (Vite)
pnpm build        # production build → dist/
pnpm preview      # serve the production build
```

Then open the printed URL (POS at `/`, Comanda at `/comanda.html`).

> `pnpm-workspace.yaml` approves `esbuild`'s install script via `allowBuilds`
> (pnpm 11 blocks dependency build scripts until approved). Commit
> `pnpm-lock.yaml` for reproducible installs. If you ever bump Vite/esbuild and
> see an "ignored build scripts" warning again, run `pnpm approve-builds`.

## Demo logins (PIN)

- Sofía — `3333` (cajero / barista)
- Iván — `2222` (encargado)
- Marcela — `1111` (dueña)
