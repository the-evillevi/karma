# EVL-126 operational IndexedDB journal

**Status:** implementation checkpoint for a local operational journal. It uses the reviewed EVL-126 v1 pure command contract, remains separate from the earlier draft/open snapshot database, and is not connected to POS UI, server RPCs, receipts, or synchronization.

## Transaction and identity boundary

Each database is named from a stable digest of the exact branch and logical-device IDs and uses a versioned `karma-pos-operations-v1-` prefix. Every persisted record also carries the original branch/device scope and is checked against the open handle. The phase-1 `karma-pos-journal-v1-` store and its `order.snapshot.saved` contract remain untouched; no snapshot is converted into an operational fact.

An append first validates the strict business envelope and uses the caller's fresh verified actor/branch/device/role/capability context. This applies to identical retries as well as new commands. The session and lease remain outside the immutable command. A changed reuse of a command ID conflicts. Pending history always keeps its original actor; this local journal does not upload it under a different identity.

One IndexedDB read/write transaction covers the command ledger, aggregate-event index, every changed head/projection, and any retained revision-conflict evidence. All expected aggregate revisions are checked, including read-only dependencies; only aggregates whose deterministic transition advances are written. IDB serializes overlapping writers across tabs. The command and all changed aggregates commit atomically; the result is exposed only after transaction completion. Failure or abort returns no projection as a successful write.

## Integrity and bounded reads

Opening and reading a snapshot loads the scoped immutable command history, replays it deterministically without reauthorizing historical actors, and compares the derived aggregate set, per-aggregate event revisions, heads, and projection contents with every saved record. Missing, extra, out-of-scope, malformed, conflicting, or divergent state fails closed.

An append/retry starts from the exact aggregates named by the command and expands through the immutable multi-aggregate references to the connected order/preparation/sale component. It reads those indexed event histories, replays only that component, and checks each component head/projection before the pure reducer runs. Unrelated branch aggregates are not loaded on each write. The full scoped replay remains the cold-start and explicit snapshot integrity check. Aggregate histories are the bounded replay unit; if one aggregate's event history reaches a measured latency/size limit, add reviewed replay checkpoints with explicit command-chain validation before raising that limit.

## Current boundary

The journal writes local business commands and derived local projections only. A saved projection or local diagnostic does not prove remote receipt, provider settlement, cross-device sync, or trusted catalog/tax validation. Server acknowledgements, authenticated upload, permanent server blocks, shared sanitized reads, SQL, and UI success wiring remain future gates. UI may not restore only open accounts from this journal; startup must consume a complete verified snapshot so closed, cancelled, refunded, split, and in-progress kitchen facts are retained.

The currently supported families and explicit unsupported actions are listed in `EVL-126-operations.md`. Current PosApp tip semantics require an explicit adapter because its payment `netAmountCents` includes allocated tip while the v1 operational sale records the sale due separately from tips; the journal does not silently reinterpret that prototype shape.

## Verification

The local Chromium lane covers cold restart of a split account with a manually recorded cash payment, refund, cancelled child, and still-ready kitchen ticket; retry identity after authority loss and with changed content; branch/device storage isolation; concurrent two-tab revision contention with retained conflict evidence; projection, event-index, and immutable-command tampering; and a late multi-store write failure followed by a clean retry. The focused domain suite also verifies replay and business invariants. These checks demonstrate local IndexedDB behavior only; there is no receipt, server sync, payment-provider, or POS UI proof in this slice.

Root review completed against26663eff. Five actual Chromium journal cases now pass, including explicit preservation of an unsupported future-version database. See `reviews/EVL-126-operations-journal.md` for exact verification and remaining acceptance gates.
