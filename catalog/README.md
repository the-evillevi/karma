# Catalog

`catalog.json` is Karma's menu (schema `karma.catalog/v2`). It is generated from `products-Today.xlsx`, the workbook Carlos validated, which is attached to Linear EVL-112 and is not stored in this repo.

- The workbook wins for products, SKUs and prices. The SKU is the stable product ID.
- Prices are integer centavos and include 16 % IVA.
- The workbook's `Disponible?` column is ignored: every product starts available.
- Modifier groups come from the menu photos on EVL-112 (slice [B]).

`src/domain/catalog.ts` (`parseCatalog`) validates the file; the app refuses to start with an invalid catalog.
