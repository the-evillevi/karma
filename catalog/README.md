# Catalog seed format

`catalog.json` is a portable snapshot of the current POS prototype seed. Its IDs, ordering, availability, option lists, selection rules, and prices preserve the existing demo behavior. Money is stored as integer MXN centavos; prototype prices remain unverified until compared with Carlos's source files and approved.

Regenerate after changing `src/karma-data.js`:

```sh
node scripts/catalog/normalize-seed.mjs
```

Check that the committed JSON matches the current prototype seed:

```sh
node scripts/catalog/normalize-seed.mjs --check
node --test scripts/catalog/catalog-normalizer.test.mjs
```

Reconcile the local source workbooks and keep row-level prices, SKUs, and source mappings in a private output directory (the script writes aggregate counts only to stdout):

```sh
python3 scripts/catalog/reconcile_sources.py
```

Pass `--stock`, `--products`, `--seed`, or `--private-dir` to use alternate inputs or output location. The default output directory is `~/.codex/karma-private/catalog` with private permissions. Do not commit its generated JSON files.

The JSON has an importable data shape, but the current POS does not load it. Wiring it into the running app as a seed remains open for runtime-loader work. A structurally valid file is not a business-validated catalog: `importGate.readyForValidatedBusinessUse` stays false while source reconciliation and Carlos review are open. Do not publish those seed prices/options as the real menu before the gate is cleared.

`validateCatalog` checks structure and types without treating unresolved business review as a schema error. `importGate` reports business readiness separately. A later approved catalog may mark stock control validated or set its mode to `none` while the business-use gate remains closed for other unresolved fields.

Stable category, product, group, and option IDs are explicit in the JSON. Existing product IDs are retained for references in demo orders and local data. Renaming a display name should not change its ID; new or corrected source rows need an explicit reconciliation entry and a deliberate ID mapping.
