# EVL-126 open-order server boundary · Root review with fixes

Root inspected the full new migration, strict business envelope/payload validators, current Auth/membership/device/session/lease checks before immutable retry, private RLS/grants, deterministic reducer/head/event/projection transaction, scoped read/cursor semantics, hosted differential fixtures and local PostgreSQL regression runner.

## Findings fixed before application

- Blocking: nonexistent `pg_catalog.jsonb_object_length` made valid commands fail at runtime. Exact required/allowed-key checks now prove the schema directly, and optional details require an explicit allowed changed field. Root confirmed the missing function using the actual linked PostgreSQL17.6 catalog.
- Canonical UTC validation accepted PostgreSQL-normalized rollover/leap-second input. UTC calendar/time now round-trips, preserving the original valid timestamp string. Hostile timestamp regressions run against SQL.
- A failed SELECT on a missing public-schema table did not prove private table ACLs. Removed that misleading probe; SQL assertions check the actual private schema/table grants and RLS.

## Verification before application

Root independently executed the disposable PostgreSQL17.6.1.166 runner, applying immutable114/118 and the new candidate. Real SQL proof passed private ACL/RLS and RPC grant checks, open/details/read, immutable retry, strict keys/calendar timestamps, forced late failure preserving command/event/head/projection/branch sequence, then exactly-once retry. The owned network-none/no-port container was removed. Agent formatting/types/hosted-spec compilation passed;8 gated hosted cases remain unexecuted at this checkpoint.

Reviewed new migration SHA256:38527549de19c9f19db43b79dcdc24f690c524df6c01e7cadfa2f8a34a973cab. Applied114/118 SHA256 independently unchanged. No blocking findings remain in this bounded open-order slice. Root may apply exactly this file to the previously approved isolated karma-pos project and run hosted proof; never edit this migration after successful application.

## Acceptance limits

Only order.opened, line add/change/remove and details are supported. Discount/cancel/preparation/split/checkout/refund and authoritative catalog/tax are explicitly rejected or unavailable. No UI wiring, durable-sale or production-readiness claim. The read is a live scoped feed; consumers merge highest revision by orderId, and future multi-aggregate changes need additional sequence/pagination proof. Full EVL-126 acceptance remains open.

Root applied exactly the reviewed SHA to isolated karma-pos (`vwvlsayxsunefeehiavt`) successfully; hosted8case proof is running. Applied file is now immutable. Full acceptance and POS wiring remain open.

## Hosted conflict fix · Forward migration reviewed

Initial hosted suite passed7/8; concurrent stale edits timed out90s. Instrumentation reached the edit pair after successful Auth/bind/open. Actual PostgreSQL activity showed repeated fresh RPC transactions with no blocking locks. Supabase documents custom40001 RPC exceptions triggering repeated PostgREST transaction retries. Root reviewed a forward replacement that changes only the two business revision-conflict raises to PT409/HTTP409 while preserving message and safe revisions. Original applied SQL remains byte-identical. Root independently reran the updated local PostgreSQL proof successfully, including stale conflict with unchanged command/event/head/projection/sequence and late-failure rollback/retry. Hosted regression retains timeout and expectations, and now checks the actual HTTP response status.

Reviewed forward SHA256:8fef21b96d7881ea801e0f056cf1d1fbd8127d2a105093c21782030de034b140. No blocking findings remain in this narrow fix; exact application and hosted rerun follow. Source:[Supabase RPC retry troubleshooting](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b).
