# Karma Bluetooth command-batch protocol

**Protocol:** `karma-ble/1` (draft)  
**Status:** Serialization and acceptance contract; no Bluetooth transport or cryptographic handshake is implemented.  
**Domain basis:** EVL-113 [`EventEnvelope` and `CommandBatchDocument`](../../src/domain/contracts.ts), [order lifecycle](../domain/order-lifecycle.md), and `validateEvent` / `applyEventBatch` in `src/domain/order-domain.js`.

## Transfer unit and identity

Transport one complete immutable `CommandBatchDocument` at a time. Preserve the source `eventId`, `commandId`, `aggregateId`, `actorId`, `deviceId`, `occurredAt`, `schemaVersion`, event order, and captured payloads exactly. Do not mint new order/event IDs, re-sort by device clocks, or split a batch into separate domain commits.

A `karma-ble/1` message has `protocol`, `sessionId`, `senderDeviceId`, `recipientDeviceId`, strictly increasing direction-local `sequence`, unique attempt `messageId`, `kind`, and `body`. `messageId` is a transport attempt; `commandId` remains the idempotency key. V1 message kinds are:

| Kind | Required body | Purpose |
| --- | --- | --- |
| `HELLO` | device ID, branch ID, configured coordinator ID/epoch, supported protocol versions | Negotiate a common version and compare authority. |
| `COMMAND_BATCH` | one complete command batch and its byte length | Transfer an immutable domain commit unit. |
| `ACK` | command ID, content digest, `committed`, `duplicate`, or `conflict` | Confirm the receiver's durable outcome. |
| `ERROR` | stable error code, retryable boolean, optional command ID | Report a bounded protocol/validation/permission failure. |

A separate encrypted byte-chunk layer can fragment a serialized `COMMAND_BATCH` to the maximum characteristic write length supported by the connected devices. Its framing must carry a stable command ID, chunk offset/index and total length. Never assume a fixed ATT MTU. This design leaves native GATT service UUIDs and characteristic flags to the adapter implementation; no UUID has been deployed or validated.

## Pairing and replay protection requirements

Pairing is initiated in the foreground by an operator on both devices. The native adapter must use a maintained, reviewed authenticated key-exchange implementation, bind first pairing to a one-time QR or matching short-authentication-string confirmation on both screens, and store approved peer identity/keys in platform-protected storage. Later sessions must authenticate both paired identities. Unknown/revoked peers and mismatched confirmation abort before order data is sent.

All post-handshake messages and chunks must have application-layer authenticated encryption, direction-separated session keys, and authenticated protocol/device/session/sequence/command metadata. Each fresh session has new key material; each direction starts at sequence zero and rejects repeats, gaps, wrong session/sender, and unauthenticated frames. Resumption after disconnect creates a fresh authenticated session and references only the original command ID and exact serialized bytes. Use platform/library cryptography; no cryptographic primitive, nonce scheme, or key derivation is implemented here.

BLE pairing alone is not application authorization. Android's BLE guidance specifically recommends application-layer protection for sensitive data; the advertising payload must not contain order/customer data, actor IDs, register IDs, or stable device IDs. ([Android BLE security guidance](https://developer.android.com/develop/connectivity/bluetooth/ble/ble-overview))

## Serialization and validation guards

V1 serializes JSON command batches with recursively sorted object keys and unchanged array order, then encodes UTF-8. The maximum canonical document is **64 KiB** and the maximum command batch is **100 events**. Reject non-JSON values, invalid UTF-8/JSON, empty or oversized batches, invalid event envelopes, duplicate event IDs, and metadata that differs between the outer batch and any event. Event schema must be supported by the receiver; unsupported versions return `UNSUPPORTED_SCHEMA` without partial application.

A receiver validates the entire ordered batch before passing it to the domain's atomic `applyEventBatch`/storage commit. A repeated `commandId` with the same batch is a no-op (`duplicate`). The same command ID with different content, partial overlap, or an event ID already used by another command is `CONFLICT`. Do not acknowledge a command before the receiver's storage layer has durably persisted the complete command-batch document. These rules preserve EVL-113's single-document commit and retry semantics; actual durability awaits EVL-114's reviewed persistence contract.

## Session state and retry rules

```text
IDLE → PAIRING → AUTHENTICATED → NEGOTIATING → TRANSFERRING → COMPLETE
                                                  │
                                 disconnect ──────┴→ PAUSED → AUTHENTICATED → RESUMING
any active state → cancel, permission loss, auth failure, or validation error → STOPPED
```

- Sender keeps a command in its normal outbox until it receives an authenticated `ACK` matching both `commandId` and content digest.
- Receiver stages partial bytes separately; partial transfer is never a domain event. On resume it reports the first missing chunk/offset. Sender retransmits from that point using the original serialized document.
- Receiver validates the complete digest and batch, commits atomically, then ACKs `committed`. If the ACK is lost, an exact replay returns `duplicate`; a changed replay returns `CONFLICT`.
- Disconnect, app suspension, disabled Bluetooth, denied permission, cancellation, and storage errors leave the sender's command pending. UI must say `pending/offline` or `received locally, awaiting server sync`; a transport ACK is never displayed as a backend sync receipt or payment settlement.
- Backoff is bounded and only while the foreground sync interaction remains active. Do not continuously scan in the background. Persist resumable progress only as the EVL-114 storage contract allows.

## Coordinator authority

EVL-113 defines one active cash-register writer. V1 has no automatic leader election: signal strength, message arrival, and local timestamps cannot prove authority while offline. `HELLO` compares a locally configured coordinator device and epoch. A mismatch stops order mutation with `COORDINATOR_CONFLICT`; an operator/setup flow must resolve it.

Only the configured coordinator may author line edits, discounts, payment/compensation, and cash-close commands. Other paired stations may submit only event types their authenticated business role is permitted to author, including allowed preparation events. The receiver validates branch, actor role, device authorization, event type, command IDs, and coordinator epoch before commit. Reconcile the exact role/event allowlist, writer lease and epoch persistence with reviewed EVL-114 before implementation. Never merge conflicting financial edits or use last-write-wins.

## Backend reconciliation

Bluetooth receipt means only “this peer durably received the batch.” It is separate from the backend receipt. Preserve original batch IDs from local store through peer transfer and later backend upload. When internet returns, the configured coordinator uses EVL-114's idempotent backend reconciliation. Keep local state visibly pending until server confirmation; backend conflicts retain history and require resolution. Backend deduplication, retention, and outbox behavior must be reconciled with EVL-114 before production use.

## Error codes

| Code | Behavior |
| --- | --- |
| `UNSUPPORTED_VERSION` / `UNSUPPORTED_SCHEMA` | Stop and retain pending commands. |
| `PAIRING_REQUIRED` / `PAIRING_REJECTED` / `AUTH_FAILED` | Stop before order data; request explicit operator pairing/confirmation as appropriate. |
| `REPLAY_OR_ORDER` | Drop frame and close the session; do not apply it. |
| `INVALID_BATCH` / `TOO_LARGE` | Reject entire batch; no event is applied. |
| `CONFLICT` | Preserve both histories; stop the affected aggregate for review. |
| `COORDINATOR_CONFLICT` | Stop order mutations until the configured owner/epoch is resolved. |
| `PERMISSION_REQUIRED` / `BLUETOOTH_UNAVAILABLE` | Explain OS action; keep the command pending. |
| `DISCONNECTED` / `STORAGE_FAILED` | Send no commit ACK; preserve the sender outbox and resumable receiver staging where valid. |
| `BACKEND_PENDING` / `BACKEND_CONFLICT` | Show local receipt separately from server sync and surface conflict. |

The pure codec/state tests can verify these serialization and validation decisions only. They cannot satisfy the two-device test, validate actual cryptographic implementation, prove range/battery behavior, or certify durable storage. Those are native integration and physical acceptance gates.
