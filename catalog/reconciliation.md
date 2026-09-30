# EVL-112 source reconciliation ledger

Status: **open**. This ledger records what can be established from the repository and current Linear evidence. It does not certify a real menu.

| Source or field | Available evidence | Current handling | Required resolution |
| --- | --- | --- | --- |
| Prototype catalog | `src/karma-data.js` | Normalized into `catalog.json`; values retain prototype provenance | Compare each row and value with Carlos's source and review |
| `ReporteDeStock_52000822_2026-8-6-1813618144.xlsx` | EVL-112 contains an embedded file reference; its signed URL had expired and the attachment API could not resolve its upload ID | Not read; no values inferred from its name | Attach a retrievable copy to the work session, then map stock rows to products and units |
| `products-Today.xlsx` | EVL-112 contains an embedded file reference; its signed URL had expired and the attachment API could not resolve its upload ID | Not read; no values inferred | Attach a retrievable copy to the work session, then compare names, prices, options, and availability |
| Three embedded product photos | EVL-112 contains three signed image references; links were no longer retrievable | Not inspected or used to infer fields | Provide readable image references/files and map images to catalog rows |
| Carlos's catalog approval | No approval or review record was present in EVL-112 or its comments | Explicitly pending | Carlos must validate names, categories/order, prices, availability, modifier rules, and stock behavior |
| IVA decision (EVL-111) | Decision record dated 2026-07-30 says menu prices include IVA and IVA breakdown is always shown | Recorded as a business rule; does not validate any seed price or amount | Preserve this rule in checkout implementation; confirm the menu values separately |
| Inventory timing and reversals (EVL-111) | Inventory is deducted when a comanda is sent; cancellation/refund must record the inverse movement in inventory and reports with reason and traceability | Recorded as a separate operational rule; no recipe quantities are treated as approved by it | Confirm product recipes/piece mappings and quantities; EVL-129 should implement the send/reversal lifecycle |
| Recipe-controlled stock | Prototype recipes exist for five products | Products with a recipe record are labeled `recipe`, with `validated: false` | Confirm recipe completeness, quantities, units, option-dependent ingredients, and consumption trigger |
| Piece-controlled stock | Prototype finished-good inventory contains a name-matching Brownie item | Brownie is labeled `piece`, with `validated: false` | Confirm that this is the sellable inventory item and establish other piece mappings |
| All other stock behavior | No unambiguous prototype mapping found | `unknown` | Carlos must classify each product as recipe, piece, or no stock control |

## Known open comparisons

* No workbook row was compared with a seed row. Duplicate names, category mismatches, missing prices, real availability, and actual option lists are therefore unresolved.
* The current prototype contains 9 categories, 78 products, and 13 modifier groups. These counts describe only the prototype and must not be treated as the validated menu size.
* Money is represented as integer MXN centavos, as explicitly requested for this catalog. The seed's values still have prototype provenance and are not validated business prices; the EVL-111 IVA decision does not validate their amounts.
* Required-group defaults are explicit in the JSON because the current POS initializes a required group to its first option. That is a preservation of prototype behavior, not confirmation that the business wants that default.
* The seed lists certain products as unavailable. Those flags are preserved as prototype values pending source reconciliation.

No Carlos validation is marked complete by this implementation.
