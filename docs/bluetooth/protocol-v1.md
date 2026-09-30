# Karma Bluetooth command-batch protocol

**Protocol:** `karma-ble/1` (draft)  
**Status:** Serialization and acceptance contract; no Bluetooth transport or cryptographic handshake is implemented.  
**Domain basis:** EVL-113 [`EventEnvelope` and `CommandBatchDocument`](../../src/domain/contracts.ts), [order lifecycle](../domain/order-lifecycle.md), and `validateEvent` / `applyEventBatch` in `src/domain/order-domain.js`.

## Transfer unit and identity

Transport one complete immutable EVL-114 `CommandBatchDocument` at a time, including its required `branchId` and `leaseId`. Preserve the source `eventId`, `commandId`, `aggregateId`, `actorId`, `deviceId`, `occurredAt`, `schemaVersion`, event order, and captured payloads exactly. Each source event ID is `${commandId}:${zeroBasedBatchIndex}`. Do not mint new order/event IDs, re-sort by device clocks, or split a batch into separate domain commits.

A `karma-ble/1` message has `protocol`, `sessionId`, `senderDeviceId`, `recipientDeviceId`, strictly increasing direction-local `sequence`, unique attempt `messageId`, `kind`, and `body`. `messageId` is a transport attempt; `commandId` remains the idempotency key. V1 message kinds are:

| Kind | Required body | Purpose |
| --- | --- | --- |
| `HELLO` | device ID, branch ID, lease ID, supported protocol versions | Negotiate a common version and compare branch/lease context. |
| `COMMAND_BATCH` | one complete command batch and its byte length | Transfer an immutable domain commit unit. |
| `ACK` | command ID, content digest, `committed`, `duplicate`, or `conflict` | Confirm the receiver's durable outcome. |
| `ERROR` | stable error code, retryable boolean, optional command ID | Report a bounded protocol/validation/permission failure. |

A separate encrypted byte-chunk layer can fragment a serialized `COMMAND_BATCH` to the maximum characteristic write length supported by the connected devices. Its framing must carry a stable command ID, chunk offset/index and total length. Never assume a fixed ATT MTU. This design leaves native GATT service UUIDs and characteristic flags to the adapter implementation; no UUID has been deployed or validated.

## Pairing and replay protection requirements

Pairing is initiated in the foreground by an operator on both devices. The native adapter must use a maintained, reviewed authenticated key-exchange implementation, bind first pairing to a one-time QR or matching short-authentication-string confirmation on both screens, and store approved peer identity/keys in platform-protected storage. Later sessions must authenticate both paired identities. Unknown/revoked peers and mismatched confirmation abort before order data is sent.

All post-handshake messages and chunks must have application-layer authenticated encryption, direction-separated session keys, and authenticated protocol/device/session/sequence/command metadata. Each fresh session has new key material; each direction starts at sequence zero and rejects repeats, gaps, wrong session/sender, and unauthenticated frames. Resumption after disconnect creates a fresh authenticated session and references only the original command ID and exact serialized bytes. Use platform/library cryptography; no cryptographic primitive, nonce scheme, or key derivation is implemented here.

BLE pairing alone is not application authorization. Android's BLE guidance specifically recommends application-layer protection for sensitive data; the advertising payload must not contain order/customer data, actor IDs, register IDs, or stable device IDs. ([Android BLE security guidance](https://developer.android.com/develop/connectivity/bluetooth/ble/ble-overview))

## Serialization and validation guards

V1 serializes JSON command batches with recursively sorted object keys and unchanged array order, then encodes UTF-8. The maximum canonical document is **64 KiB**, maximum nesting is **64 levels**, and maximum command batch is **100 events**. The required outer identity is `commandId`, `branchId`, `aggregateId`, `actorId`, `deviceId`, `leaseId`, `schemaVersion`, `occurredAt`, and `events`, matching EVL-114. Event IDs must equal `${commandId}:${zeroBasedBatchIndex}`. `occurredAt` is a valid millisecond ISO-8601 UTC timestamp (`toISOString()` form). Reject unknown outer fields, non-JSON values, sparse arrays, cycles, over-deep values, invalid UTF-8/JSON, empty or oversized batches, invalid event envelopes, duplicate/misderived event IDs, and metadata that differs between the outer batch and any event. Event schema must be supported by the receiver; unsupported versions return `UNSUPPORTED_SCHEMA` without partial application.

A receiver validates the entire ordered batch before passing it to the domain's atomic `applyEventBatch`/storage commit. A repeated `commandId` with the same batch is a no-op (`duplicate`). The same command ID with different content, partial overlap, or an event ID already used by another command is `CONFLICT`. Do not acknowledge a command before the receiver's storage layer has durably persisted the complete command-batch document. These rules preserve EVL-113's single-document commit and retry semantics; actual durability awaits EVL-114's reviewed persistence contract.

## Session state and retry rules

```text
IDLE → PAIRING → AUTHENTICATED → NEGOTIATING → TRANSFERRING → COMPLETE
                                                  │
                                 disconnect ──────┴→ PAUSED → AUTHENTICATED → RESUMING
any active state → cancel, permission loss, auth failure, or validation error → STOPPED
```

- Sender keeps a separate peer-transfer receipt pending until it receives an authenticated `ACK` matching both `commandId` and content digest. That ACK never removes or marks complete the EVL-114 backend-sync outbox entry.
- Receiver stages partial bytes separately; partial transfer is never a domain event. On resume it reports the first missing chunk/offset. Sender retransmits from that point using the original serialized document.
- Receiver validates the complete digest and batch, commits atomically to its peer-received local store, then ACKs `committed`. If the ACK is lost, an exact replay returns `duplicate`; a changed replay returns `CONFLICT`.
- Peer copies and peer ACK receipts are **not server-uploadable outbox entries**. The originating actor/device retains its own EVL-114 server-sync batch and must upload it using that actor's authenticated identity. Current EVL-114 row-level security requires uploader `auth.uid` to match the original `actorId` and the original device to belong to that actor. Do not rewrite actor/device IDs, use a service key, or share an actor login. If the original device cannot upload a peer-authored event, EVL-140 needs an explicitly reviewed signed-relay endpoint and authorization contract; until then keep it pending and surface the gap.
- Disconnect, app suspension, disabled Bluetooth, denied permission, cancellation, and storage errors leave the sender's peer-transfer attempt pending. UI must distinguish `pending peer transfer`, `received locally, awaiting origin sync`, and `server synced`. A transport ACK is never displayed as a backend sync receipt or payment settlement.
- Backoff is bounded and only while the foreground sync interaction remains active. Do not continuously scan in the background. Persist resumable progress only as the EVL-114 storage contract allows.

## Coordinator authority

EVL-113 defines one active cash-register writer. V1 has no automatic leader election: signal strength, message arrival, and local timestamps cannot prove authority while offline. `HELLO` compares branch and lease context; EVL-114's server contract binds each batch to `branchId`, `deviceId`, and `leaseId`. The exact offline lease validity/renewal rule must come from the reviewed EVL-114 authority contract. Until then, a lease mismatch or uncertain authority stops order mutation with `COORDINATOR_CONFLICT`; no local epoch or timestamp may override it.

Only the configured coordinator may author line edits, discounts, payment/compensation, and cash-close commands. Other paired stations may submit only event types their authenticated business role is permitted to author, including allowed preparation events. The receiver validates branch, actor role, device authorization, event type, command/event IDs, and lease context before peer commit. Reconcile the exact role/event allowlist and offline lease-validity rule with reviewed EVL-114 before implementation. Never merge conflicting financial edits or use last-write-wins.

## Backend reconciliation

Bluetooth receipt means only “this peer durably received the batch.” It is separate from the backend receipt and from the originating device's server-sync outbox. Preserve original batch IDs/actor/device metadata through peer transfer. When internet returns, the originating authenticated actor/device uses EVL-114's idempotent backend reconciliation. The coordinator must not upload another device's batch using its own actor identity. Keep server-sync state pending until server confirmation; backend conflicts retain history and require resolution. Backend deduplication, retention, and outbox behavior must be reconciled with EVL-114 before production use.

## Error codes

| Code | Behavior |
| --- | --- |
| `UNSUPPORTED_VERSION` / `UNSUPPORTED_SCHEMA` | Stop and retain pending commands. |
| `PAIRING_REQUIRED` / `PAIRING_REJECTED` / `AUTH_FAILED` | Stop before order data; request explicit operator pairing/confirmation as appropriate. |
| `REPLAY_OR_ORDER` | Drop frame and close the session; do not apply it. |
| `INVALID_BATCH` / `TOO_LARGE` | Reject entire batch; no event is applied. |
| `CONFLICT` | Preserve both histories; stop the affected aggregate for review. |
| `COORDINATOR_CONFLICT` | Stop order mutations until branch/lease authority is resolved. |
| `PERMISSION_REQUIRED` / `BLUETOOTH_UNAVAILABLE` | Explain OS action; keep the command pending. |
| `DISCONNECTED` / `STORAGE_FAILED` | Send no commit ACK; preserve the sender outbox and resumable receiver staging where valid. |
| `BACKEND_PENDING` / `BACKEND_CONFLICT` | Show local receipt separately from server sync and surface conflict. |

The pure codec/state tests can verify these serialization and validation decisions only. They cannot satisfy the two-device test, validate actual cryptographic implementation, prove range/battery behavior, or certify durable storage. Those are native integration and physical acceptance gates.
