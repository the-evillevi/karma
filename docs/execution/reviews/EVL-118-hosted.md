# EVL-118 hosted policy verification — 2026-09-30

Root reviewed and applied only the already approved migration SHA `44d5214315b9a16261bf6ec66eb0a4c002c4e6515df3bd6bb6fec1bf3b056406` to isolated `karma-pos` (`vwvlsayxsunefeehiavt`). Preflight confirmed the project ref and only EVL-114 in remote history. Postflight confirmed the session table, active-membership column, append RPC and revoked authenticated direct-insert grant. CLI migration repair recorded `20260929000200`; a separate read verified both immutable migration versions. No other Supabase project was changed.

The fixture script created unique synthetic `.invalid` users directly with confirmed Auth identities; it did not send invites or email. Browser configuration uses the public anon key only. Passwords and the service key remain in ignored mode0600 test configuration, with HTTP access denied by Vite. Synthetic owners are restored after the destructive concurrency proof so subsequent proofs remain repeatable.

Root fixed an async sign-in/PIN readiness race in the hosted suite and aligned cash-register preparation expectations with the reviewed active-role policy. Public preview builds explicitly clear branch/device identifiers and force demo mode, even with a private secure fixture configured locally. The preview build and output credential scan passed.

## Results

`pnpm test:offline:e2e`: 12 passed, none skipped, 29 seconds. Evidence covers missing/null/numeric/unsupported event types; missing, oversized and non-string cancellation reasons; waiter preparation-cancellation denial and owner allowance; authenticated direct-insert denial; concurrent owner continuity; HTTP403 private fixture; failed local write without queue; offline capture/reconnect/reload; interrupted receipt idempotence; one interruption among multiple pending batches; known revocation clearing cached authority; valid cash/preparation operations with forged/mutable/malformed rejection; conflicting altered retries held for review.

## Review and acceptance

No blocking findings remain in this policy/fixture slice. Applied SQL is immutable: subsequent SQL corrections require a forward migration and root review. These proofs validate server policy and the small offline command client, not every POS mutation or production operations.

- Met: exact reviewed isolated migration, recorded history, role/event/RPC negative checks, owner-continuity concurrency, known revocation and actor-bound offline retry proof.
- Partially met: EVL-118 actual POS login/identity switching and every mutation boundary are being implemented separately by foundation_xhigh and still need root review.
- Not met: production enrollment/recovery and full durable POS app storage (EVL-126). No production readiness or hardware attestation is claimed.
