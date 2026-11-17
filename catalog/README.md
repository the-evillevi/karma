# Catalog

`catalog.json` is Karma's menu (schema `karma.catalog/v2`). Products and SKUs come from `products-Today.xlsx`, the workbook Carlos validated, which is attached to Linear EVL-112 and is not stored in this repo.

- The workbook wins for products and SKUs. The SKU is the stable product ID.
- Prices come from the printed menu (the "Menú" photos on EVL-112), per Levi's decision of 16 Nov 2026 (EVL-112 [C]). Products the printed menu doesn't list keep the workbook price.
- Duplicate workbook rows were removed (SKUs …169, …171, …204) and obvious typos fixed (Latte Honey, Crepa Hawaiana, Maple). Other naming questions are listed for Carlos in the Linear document "Estado del piloto".
- Prices are integer centavos and include 16 % IVA.
- The workbook's `Disponible?` column is ignored: every product starts available.
- Modifier groups (milk, flavour shots, sides, dressings, sweet extras) come from the menu photos. Paid extras reuse the SKU and price of the matching product. Which products get which group, and the price assumptions for products the menu groups together, are recorded in EVL-112 until Carlos confirms them.

`src/domain/catalog.ts` (`parseCatalog`) validates the file; the app refuses to start with an invalid catalog.
