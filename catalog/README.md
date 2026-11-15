# Catalog

`catalog.json` is Karma's menu (schema `karma.catalog/v2`). It is generated from `products-Today.xlsx`, the workbook Carlos validated, which is attached to Linear EVL-112 and is not stored in this repo.

- The workbook wins for products, SKUs and prices. The SKU is the stable product ID.
- Prices are integer centavos and include 16 % IVA.
- The workbook's `Disponible?` column is ignored: every product starts available.
- Modifier groups (milk, flavour shots, sides, dressings, sweet extras) come from the menu photos on EVL-112. Paid extras that exist in the workbook reuse its SKU and price. Which products get which group is an assumption recorded in EVL-112 until Carlos confirms it.

`src/domain/catalog.ts` (`parseCatalog`) validates the file; the app refuses to start with an invalid catalog.
