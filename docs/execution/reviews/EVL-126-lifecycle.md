# Root code-review --fix · EVL-126 lifecycle

## Findings fixed and rereviewed

- Malformed stored history action types could bypass an allowlist. Explicit text validation, unique command identities, one opening event, exact revision count and final-head identity now fail closed; local PostgreSQL corruption cases pass.
- A previously discounted order could become unknown-priced through a line edit in the TS reducer. SQL and reducer now reject unknown or below-discount subtotals; domain/local/hosted parity cases pass.
- The legacy read emitted gross lines without the captured discount. The forward migration now rejects every currently visible open discounted projection, independently of its cursor; new lifecycle reads include the full discount and cancellation facts. Hosted creator-only reads do not expose other creators' discounts.
- Hosted lifecycle tests incorrectly reused an actor session after a register switch and tested post-discount invariants before recording the discount. The proof now rebinds at each actual operator switch and exercises line edits at discounted revision 2. No authorization relaxation, deadline increase or skip was used.

## Review and acceptance

No blocking findings remain in this bounded server family. Atomic commit/rollback/retry, terminal retention, reason/actor history, strict safe-money rules, current role/device scope and sanitized cash reads are met by real local SQL and 10/10 hosted cases. Private ACL/RLS and authenticated-only function grants passed locally. Performance retains bounded input/feed sizes, branch sequence serialization and existing aggregate indexes; the legacy guard is a branch/creator-scoped existence query. Security checks occur before exact retry; payloads and captured provenance remain strict. Forward migration history and exact hashes are immutable. Readability/operational evidence and limitations are documented.

Whole EVL-126 remains partially met: no preparation/split/sale/refund server families, POS runtime bridge, cross-device UI synchronization, or full startup recovery yet. The hosted fixture uses only existing isolated synthetic identities; no invitations or real-person messages were sent.
