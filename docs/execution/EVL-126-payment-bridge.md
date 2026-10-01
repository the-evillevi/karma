# EVL-126/123 — legacy payment bridge checkpoint

**Status:** translator-only checkpoint; not connected to checkout, the local journal, server writes, or synchronization.

`src/domain/posapp-payment-operation-bridge-v1.ts` translates a captured `PosApp.register()` sale into operation-v1 `PosPaymentInput[]`. Its contract is deliberately versioned and separate from the existing compatibility snapshot. It accepts only explicit MXN, manual-record captures and requires the caller to provide the current order's food due in safe integer centavos. It does not infer missing sale facts from display amounts or historical fields.

The legacy `sale.payments[].netAmountCents` and paired `sale.tenders[].netAmountCents` include allocated tip. The operation reducer models order food net and tip separately, so the bridge subtracts each captured row's explicit `tipCents` from its legacy net and reconciles both the aggregate food due and sale tip. Cash keeps captured gross tender and change. Card/transfer tender and change are checked against the captured tender rows, then represented with null cash-only fields and `manual-unverified` provenance; this does not assert provider authorization or settlement. The mounted regression exercises the current `PosApp.register()` path and passes the persisted sale directly to the bridge.

`register()` omits payment rows whose captured net is zero but keeps a positive cash tender row. The bridge accepts that unmatched row only when it is explicitly cash, has zero net and tip, and its entire tender is returned as change. Since the legacy sale has no payment ID for that row, its existing captured tender ID is retained as the operation payment identity. Payment/tender IDs must be folio-scoped and paired by their captured suffix. Per-row and aggregate net, tip, gross tender, and change sums must reconcile within safe centavos; unknown fields, conflicting aliases, missing capture facts, unsupported verification, bad scope, and overflow reject.

An empty zero-food/zero-tip capture can map to an empty operation payment list. Tip-only or tendered zero-food checkouts remain unsupported because operation-v1 does not permit those payment rows on a zero-due sale. The reducer contract is unchanged.

This checkpoint does not change reports or legacy payment handling. It does not create a journal command, commit a local transaction, produce a server receipt, contact a provider, settle a card/transfer, alter customer balances, or make a production durability claim. UI wiring remains gated on the full approved operation family and server integration. EVL-126/129 atomic checkout, refund, inventory, customer-credit, and hosted offline/retry/revocation acceptance remain open.

## Focused evidence

- `src/domain/posapp-payment-operation-bridge-v1.test.ts`: pure current-tender calculation, bridge, and reducer differential cases for mixed tender/tip/change, zero-net returned cash, empty zero sale, unsupported tip-only sale, invalid or conflicting capture evidence, ID mismatch, and aggregate overflow.
- `src/domain/posapp-payment-operation-bridge-ui.test.jsx`: mounted `PosApp.register()` captures an actual sale record, then the bridge consumes that saved record and reconciles the captured food due, tip, and payment facts.

Root code-review --fix completed: safe aggregate gross/change proof and complete legacy-module type declaration. Root8focused domain and1actual mounted checkout-to-bridge cases, types/lint/format/diff passed; final scoped bridge scan0medium+. See reviews/EVL-126-payment-bridge.md for explicit partial acceptance.
