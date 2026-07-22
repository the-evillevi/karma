# Karma POS

Punto de venta para cafetería (Karma · Abboth). Imported from the Claude Design
project **"Karma POS para cafetería"**.

The app is a self-contained [Datacosm](https://claude.ai/design) (`.dc.html`)
prototype: declarative reactive templates driven by `support.js` (a React-based
runtime that auto-loads React / ReactDOM / Babel from unpkg) plus embedded logic.
No build step required.

## Files

| File | Purpose |
|------|---------|
| `Karma POS.dc.html` | Main app — login/PIN, punto de venta, órdenes abiertas, cobro, menú, inventario, reportes |
| `Comanda.dc.html` | Kitchen/bar ticket display (comanda), syncs live via `localStorage` |
| `karma-data.js` | Seed data — products, modifiers, users, inventory, movements, recipes, sales |
| `support.js` | Datacosm runtime (generated; do not edit) |

State is persisted in `localStorage` under the key `karma-pos-v1`, which is how
the POS and the Comanda screen stay in sync.

## Run

The files must be served over HTTP (not opened as `file://`) so the runtime and
`localStorage` work:

```sh
python3 -m http.server 8787
```

Then open:

- POS:     http://localhost:8787/Karma%20POS.dc.html
- Comanda: http://localhost:8787/Comanda.dc.html

## Demo logins (PIN)

- Sofía — `3333` (cajero / barista)
- Iván — `2222` (encargado)
- Marcela — `1111` (dueña)
