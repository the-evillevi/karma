# EVL-126 phase 3: atomic POS operation contract

**Status:** pure domain command contract and deterministic replay checkpoint. The POS UI, IndexedDB transaction adapter, server RPCs, forward migrations, and remote synchronization are not connected. Passing these tests is not evidence of durable or hosted POS operations.

## Immutable command and authority boundary

`PosOperationCommand` carries schema version, stable command ID, branch, original actor, logical device, UTC occurrence time, action, bounded reason where required, strict action payload, and canonical expected revisions for every aggregate read or changed by that transition. Login sessions, leases, current role claims, and capabilities remain out of the command identity.

New append and identical retry both receive the caller's current verified actor/branch/device/role/capabilities separately. The reducer checks that identity against the command, then checks the action capability and role before looking at the command ledger. Reusing a command ID with different content is a conflict. Historical replay validates each immutable command and transition without reauthorizing the original actor; a later revocation must not erase completed sales, refunds, or kitchen facts. Replay validates structure and transitions, not that local history is authentic; the journal must enforce its own integrity and the server must provide authenticated acknowledgement. The future upload/RPC path still must reauthorize the original actor on every initial call and retry.

## Supported pure transitions

The strict schema and reducer currently cover:

- Open, line add/change/remove, and table/contact changes on an open account. An open account must retain at least one line. The serialized types remain `local`, `mesa`, `llevar`, `recoger`, and lowercase `domicilio`; `llevar` and `recoger` require name and phone, while `domicilio` also requires an address. Table IDs are preserved.
- Authorized discount with a bounded reason and cents allocated to the order. Cancellation records actor, time, and reason while retaining the order history.
- Send, transition, and cancel a preparation ticket. Line changes after send guard and advance both the order and linked preparation revisions. Splits share the one existing preparation ticket; they do not create another kitchen ticket. Preparation state remains independent from payment and order cancellation, so cancelling an account does not silently erase or cancel kitchen work.
- Split an account with exact source, child, and linked-preparation revision guards. Quantity, subtotal, discount, and due cents must conserve; the source retains a line and stable child-line IDs are required. Split authorization uses the existing `openOrder` role/capability policy, including Barra and Mesero where their verified context grants it.
- Checkout atomically closes the account and appends a closed sale with original creator, closing actor, captured order facts, manual payment rows, cash tender/change, and separate tips. Cash reconciles exactly; external card/transfer entries stay `manual-unverified`. No provider payment is executed or verified.
- Refund appends reasoned allocations to the closed sale against each original payment's net amount, excluding cash tender and change. Sale payments and closure remain unchanged, and the order never reopens. Only Dueña/Encargado authority is accepted for refunds.

All money is safe integer MXN cents. The payload field allowlists reject auth/session data and financial facts escaping their action; each serialized command is limited to 1 MB. Catalog and tax provenance can remain prototype-captured or unknown; unknown amounts stay null, and replay never upgrades them to verified. When modifier effects and total are all present, they must reconcile.

Every transition computes the required aggregate set from prior state and verifies canonical IDs and exact revisions before cloning/reducing. Reductions happen on a cloned projection, so a failed transition returns no state change. Duplicate retries are recognized by full command content before comparing already-advanced revisions, but only after current authority has been checked. Replay keeps historical facts after role revocation; new appends remain subject to current authority.

## Explicitly unsupported

- Menu and inventory create/edit/receive/adjust/consume/compensation operations, stock projections, and inventory rollback.
- Standalone customer directory, credit, merge, and profile operations. Only bounded inline contact snapshots are supported.
- Sale void/reversal, provider authorization/settlement, invoices, external provider references, automatic payment claims, and tip-refund allocations.
- Arbitrary whole-order/sale/preparation replacement, client role claims, session/lease fields in immutable commands, and unknown action names.

## Required next gates

This checkpoint has Node tests for stale multi-aggregate revision rollback, input immutability, split value conservation, role denial, revocation-safe historical replay, preparation lineage/progress, immutable checkout/refund facts, and contact, money, and provenance validation. It is a deterministic in-memory domain layer only; it is not the local journal transaction or a trusted authorization service.

Next, add a local atomic transaction across command ledger, aggregate heads, and projections, including cross-tab revision contention and complete replay validation. Then implement explicit forward server migrations/RPCs with deterministic multi-aggregate locks, rollback proof, current actor/session/device/lease authorization, idempotent acknowledgements, and sanitized reads. Only after those gates pass can POS UI success depend on this contract. Applied EVL-114/118 SQL remains immutable; no schema, hosted proof, durable UI behavior, or production synchronization is claimed here.
