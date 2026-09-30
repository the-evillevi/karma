# EVL-126 phase 3: atomic POS operation contract

**Status:** first pure-domain checkpoint. POS UI, IndexedDB transactions, server RPCs, migrations, and remote synchronization remain unconnected and unimplemented here.

## Immutable command boundary

`PosOperationCommand` is a versioned business fact with a stable command ID, branch, original actor, logical device, occurrence time, action, bounded reason, action payload, and the canonical expected revision for each touched aggregate. Session IDs, register leases, role claims, and current capabilities are excluded from the command and its retry identity.

New append and identical retry both receive the caller's current verified actor/branch/device/role/capabilities separately. The reducer checks that context against the immutable command, then checks the action capability and role before consulting the command-ID ledger. This preserves original actor attribution when staff switch while ensuring a stale or revoked identity cannot create or retry a privileged mutation. The pure historical replay path validates the immutable schema, revisions, and domain transitions without reauthorizing old facts; a later role change must not erase paid sales, refunds, or kitchen work. Pending upload and every server retry will need a fresh original-actor authorization check in the transport/RPC layer.

Each action has a strict field allowlist. Order creation and line edits cannot smuggle in discounts, payment facts, session credentials, or server keys. Catalog-versioned price evidence requires an explicit product and price-version ID. Prototype or legacy prices retain their unverified provenance with no fabricated catalog version; unknown prices contain no amount. Tax can remain unknown and must not gain an invented rate or policy ID. Explicit currency is MXN only, cents are non-negative safe integers, and modifier identity is the `(groupId, optionId)` pair.

The state preserves the five observed POS order types (`local`, `mesa`, `llevar`, `recoger`, and `DOMICILIO`) and table IDs. Delivery requires captured name, phone, and address. Inline customer contact is an order snapshot only; customer-directory, credit, merge, and profile operations are unsupported.

## Implemented checkpoint

The pure append/replay implementation currently supports `order.opened` and `order.line-added`. It checks scoped actor/device context, current `openOrder` role and capability, stable command retry content, exact aggregate revision guards, safe aggregate money totals, original creator, and append-only actor history. A failed transition returns no new state and cannot partially mutate the input.

The discriminated contract now declares the next action families—line change/removal and details; authorized discount; preparation send/transition/cancellation; account cancellation; split; checkout; and sale refund—with bounded payload types and runtime field/currency/amount validators. Their aggregate touch sets and deterministic transitions are not implemented yet; attempts fail closed. A refund cannot yet be recorded, and no payment success is implied.

## Explicitly unsupported families

- `editMenu`, inventory receive/adjust/consume/compensation, and stock projections.
- Standalone customer directory/credit/merge operations. A limited inline contact snapshot may be stored on an order.
- Sale void/reversal, card-provider authorization/settlement, invoice, and persisted provider reference data.
- Arbitrary whole-order/sale/preparation snapshot replacement, client role claims, session/lease fields in immutable commands, and unknown operation actions.

## Storage and server boundary

This module is a deterministic business transition layer only. It is not a persistence transaction, cross-tab revision lock, trusted authorization service, or server idempotency proof. The next checkpoint must add bounded transition planners and test rollback/conservation across every aggregate before local transaction wiring. Later local and server adapters must append the complete immutable command and update every touched revision/projection atomically; they must never replay only open orders and thereby resurrect paid or cancelled accounts. Supabase session/lease binding remains transport authorization, separate from business-command identity. Applied EVL-114 and EVL-118 SQL remains immutable; future server behavior requires a reviewed forward migration.
