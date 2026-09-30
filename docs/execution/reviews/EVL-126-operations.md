# EVL-126 operational reducers review with fixes

Root reviewed `413928e` against the atomic POS contract, actual reviewed POS role behavior, and immutable history/financial/preparation invariants. This is a bounded pure-domain slice, not full EVL-126 acceptance.

## Findings fixed

- Account cancellation left the preparation record intact but rejected later kitchen progression through that account. Root reproduced it and removed the financial-account-status gate; preparation's own transition rules, current capability and linked revision guards still apply. Paid/cancelled account facts stay closed.
- Historical replay silently accepted duplicate committed commands. Root reproduced it and made duplicates fail closed; a new authorized exact command retry remains idempotent.
- Duplicate modifier identity pairs were accepted, and line appends escaped the 200-line order limit enforced at opening. Root added identity and persistent order-size guards with regressions.
- A partial split copied an ambiguous captured tax amount into both lines. Root reproduced the duplicated amount and rejects partial known-amount tax splits until an explicit reviewed per-unit/per-line basis and rounding allocation exist. Unknown-tax prototype splits and whole-line moves remain supported. No tax policy or allocation is invented.

## Evidence

Nineteen focused operational tests pass after fixes. Scoped types and lint pass. The new source has zero medium-or-higher Snyk findings; raw evidence is adjacent. Agent pre-review full domain suite passed 97 cases. Combined integration checks follow after merging this exact reviewed code.

## Acceptance

- Met in pure local-domain scope: explicit schema/scope/original actor, current action/role denial before retry, complete immutable-content conflicts, exact touched/read aggregate revision guards, detached input mutation, order lifecycle, discount/quantity/value conservation, independent preparation, captured cash tender/change with separate tips, manual-unverified external records, payment-net refund caps and closed-order replay after revocation.
- Open: IndexedDB atomic persistence, authenticated server acknowledgements, current session/lease authorization, cross-device reconciliation/sanitized reads and actual POS wiring. Applied SQL remains immutable.
- Open price authority: internal captured amount consistency is not a trusted catalog lookup or authoritative tax validation. Never promote prototype values merely by persisting/uploading them.
- Open compatibility: current PosApp `netAmountCents` includes its allocated tip, while this operational schema records sale payment net excluding a separate `tipCents`. A future bridge must convert explicitly and reconcile total receipts; copying those fields directly would miscount.
- Open capability: shared preparation line editing, repeat/delta sends, inventory/customer effects, sale voids and tip refund allocations require separately reviewed operations. Known-tax partial splits require a defined amount basis. The current array/history cloning also needs a bounded/indexed storage design before production volume.

Recommendation: accept this reviewed pure-domain draft slice and continue storage/server implementation. Do not mark EVL-126 complete.
