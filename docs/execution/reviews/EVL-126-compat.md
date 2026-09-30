# EVL-126 compatible snapshot: root review with fixes

No blocking findings remain in this sanitized compatibility-view checkpoint. Root reviewed ae11b00 after the initial4a8959c candidate failed fidelity checks. This is not a journal payload, validated server operation, restore implementation or synchronization integration.

## Fixes

Rich current checkout lineSnapshots take precedence over lossy report items and reconcile their available quantities, names, modifiers and totals. Captured product/line identities, notes, table, preparation links/shared state, cancellation facts and legacy audit display tuples survive. Catalog price versions and missing tax remain unknown, without invented IDs, actors, reasons or timestamps. Money aliases and explicit non-MXN currency conflict instead of silently changing facts.

Complete payment identity sets now validate refund allocations, selected payment, method, unique payment/command/allocation IDs and cumulative remaining net. Root added a regression against changing the selected payment while retaining another valid allocation. Unresolved legacy facts retain partial evidence. Session, PIN, staff, password and credential state is excluded through field allowlists.

## Evidence and acceptance

Root independently passed5 domain adapter cases after fixes and the scoped security scan returned0 medium+ findings. Agent passed82 domain/69 component tests, typecheck, lint, formatting and production build. The modified existing actual POS payment test exercises serialization; root current integration serialization proof follows integration because its checkout has richer snapshots than the older foundation worktree.

Met: bounded versioned/scope-tagged, sanitized compatibility view with explicit unknown provenance and available-money consistency. Open: actual restore, all-family local transactions/replay, protected server writes/reads, authoritative acknowledgements, conflicts, enrollment and hosted offline recovery. Do not wire open-only replay or claim EVL-126 complete.
