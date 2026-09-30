# ADR-001: Offline-first storage and synchronization

**Status:** Proposed for EVL-114 review  
**Date:** 2026-09-29

## Decision

Use the existing Vite + React client, RxDB with the Dexie/IndexedDB storage adapter for device-local data, and Supabase Postgres for authenticated cloud acknowledgement and shared projections. Financial commands are written locally as one immutable document containing the complete ordered event batch. A single `command_batches` row is the server commit point; PostgreSQL commits the envelope and all its events atomically. Local views and future server projections are derived and replayable. This prototype does not claim a cross-collection transaction.

The client sends each batch with a stable `commandId`; events use `${commandId}:${zeroBasedIndex}`. A server unique constraint makes retries idempotent. If the server already has that command ID, the client compares the full canonical batch. Identical content records a local acknowledgement; different content is a command conflict for owner reconciliation. It is never overwritten. The server response is written to a separate local receipt collection only after acknowledgement. A crash after the server commit and before the local receipt therefore retries the same immutable batch and gets one stored server row.

The POC captures a synthetic product, quantity, line and modifier snapshots, integer centavos, catalog price version, tax rate in basis points, and whether IVA is included. It does not look up live catalog data when replaying an offline sale. Financial status remains independent of preparation status under the EVL-113 lifecycle contract. Preparation commands use the same immutable command envelope but must not alter financial totals.

## Alternatives considered

| Option | Tradeoff |
| --- | --- |
| Plain IndexedDB plus hand-written schemas | Small dependency set, but requires rebuilding local schema validation, migrations, reactive queries, and replication coordination. |
| RxDB built-in Supabase replication | Convenient for mutable documents. Its upsert/conflict model is a poor fit for append-only cash facts where last-write-wins could silently replace a sale. |
| Supabase as the only write store | Central validation is useful while connected but makes order capture unavailable during an outage. |
| SQLite/WASM on each device | Strong local relational transactions, but introduces extra packaging and migration work for this browser-first Vite POC. Revisit if IndexedDB transaction or size limits become a measured issue. |

RxDB’s Dexie adapter is used here because it persists in browser IndexedDB and is available in the project’s current browser target. Finance synchronization is custom insert-and-confirm code rather than generic document replication. [RxDB Dexie storage](https://rxdb.info/rx-storage-dexie.html), [RxDB replication](https://rxdb.info/replication.html), [RxDB Supabase replication](https://rxdb.info/replication-supabase.html).

## Identity, writer lease, and authorization window

The server binds a user to a branch membership and a logical registered-device ID. A branch has at most one cash-register lease, identified by device and lease IDs with a server-checked validity interval. This is not proof of physical-device identity: someone with the same account can copy a public device ID and lease into another browser. EVL-118 must add device enrollment/session binding and define how device replacement revokes old sessions before the system can claim one physical active writer. The prototype grants cash capture only to the registered active cash device and the `duena`, `encargado`, or `barra` roles. Preparation devices have a separate allowed event set and role check. This is a narrow proof, not the final EVL-118 role/action matrix or device enrollment flow.

While disconnected, a cashier can use a previously loaded lease until its locally observed expiration. A device cannot receive a server revocation while offline, and its wall clock is not trusted; a deliberate clock change or compromised device can extend local behavior. On reconnect Postgres rechecks device status and lease validity, and rejected batches remain local for reconciliation. The client clears cached authorization when it receives an online denial or discovers a missing, expired, or revoked lease. It uses cached authorization only when network access is actually unavailable. This is an availability window, not offline proof of current server authorization.

The browser receives only Supabase’s publishable/anon key and relies on RLS. The service-role key is used only by the ignored local fixture bootstrap and test runner. Supabase documents RLS as the mechanism for controlling access from browser clients; EVL-118 must harden each role/action and server-side device enrollment before production. [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Conflict handling and recovery

* Network failure: keep the immutable local command and retry it; show pending age and last sync result.
* Same command ID and byte-equivalent normalized content: accept the existing server row and write a local acknowledgement.
* Same command ID with changed batch contents: stop automatic retries for that command and require owner reconciliation; never update or discard either record.
* Known device/lease denial: keep the local batch, clear the cached online authorization, and require a manager to resolve device or lease state before resubmission.
* Local storage failure: report capture failure and do not label the order pending or attempt a cloud write.
* Server projections: rebuild from committed command batches. Reconcile projection gaps without changing source events.

The prototype exposes pending orders and a manual retry. Production observability still needs device health, last successful sync, pending count/age, command-level failure codes, backup/export status, and a guided manual recovery and reconciliation workflow. No financial recovery path may use last-write-wins or delete a pending source batch.

## Cost and operational notes

RxDB core and the Dexie adapter are open-source options for this POC; premium RxDB storage is not required. Supabase’s published pricing lists a Free plan at $0 and a Pro plan at $25/month, with additional project compute charged separately; verify current compute and backup details before a production budget. The Free plan is suitable for a short prototype but does not provide the operational backup/retention story required for launch. Pro advertises daily backups with seven days of retention; this is operational recovery, not the user-requested historical schedule. Continue the EVL-111 requirement for manual, owner-accessible reports/exports and define retention and tested restoration before pilot. [Supabase pricing](https://supabase.com/pricing), [Supabase backups](https://supabase.com/docs/guides/platform/backups).

## Consequences and follow-up

This POC proves browser persistence and a real Postgres acknowledgement boundary; it does not yet provide production cashier UI, payment processing, full menu projections, manager reconciliation, remote backup automation, secure device enrollment, or complete role permissions. EVL-116 owns technical setup; EVL-118 owns authorization; EVL-126 owns full RxDB/domain integration; EVL-127 owns recovery and backups. The schema and thin demo are intentionally isolated until those issues are reviewed.
