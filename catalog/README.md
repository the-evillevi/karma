# Catalog seed format

`catalog.json` is a portable snapshot of the current POS prototype seed. Its IDs, ordering, availability, option lists, selection rules, and prices preserve the existing demo behavior. Price and availability values are marked as prototype-only until compared with Carlos's source files and approved.

Regenerate after changing `src/karma-data.js`:

```sh
node scripts/catalog/normalize-seed.mjs
```

Check that the committed JSON matches the current prototype seed:

```sh
node scripts/catalog/normalize-seed.mjs --check
node --test scripts/catalog/catalog-normalizer.test.mjs
```

The JSON can be imported directly by a later runtime loader. This work does not change the current POS loader. A structurally valid file is not a business-validated catalog: `importGate.readyForValidatedBusinessUse` stays false while source reconciliation and Carlos review are open. Do not publish those seed prices/options as the real menu before the gate is cleared.

Stable category, product, group, and option IDs are explicit in the JSON. Existing product IDs are retained for references in demo orders and local data. Renaming a display name should not change its ID; new or corrected source rows need an explicit reconciliation entry and a deliberate ID mapping.
