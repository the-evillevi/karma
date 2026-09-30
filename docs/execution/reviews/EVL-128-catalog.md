# EVL-128 catalog root review with fixes

No blocking findings remain in the bounded audited item-management slice after review of389c3b9 and root fixes. This stacks on the reviewed manual ledger, preserves untouched v1 ledgers and does not certify remote authority or fixture balances.

## Findings fixed

- Catalog snapshots included independently mutable low-stock thresholds. Editing, then changing a threshold invalidated saved history. Thresholds now remain in their own immutable movement history, while catalog snapshots contain only catalog metadata. Regression interleaves edit/threshold/edit and proves reload.
- Item catalog source revision is captured and compared on retries. Changed expected item revisions cannot report identical-command success.
- Operator opening records bind to the matching creation command, actor, name, occurrence and reason. Tampered opening identity fails validation.
- Identical movement retries retain historical item snapshots through renames, and old v1 retries do not invent missing snapshots. Explicit invalid snapshot inputs fail closed.

## Evidence

Root independently passed16 ledger domain tests and13 actual inventory UI cases; agent passed95 domain/102 components plus normal/PWA builds. The final scoped inventory security rescan found0 medium+; PosApp has only the four unchanged Reports sinks attributable to baselineef10819184c1fe7769b316c8a259f00c4391d79e. Adjacent evidence records scope and attribution; no whole-project clean claim.

## Acceptance

Met locally: owner/manager item creation with an explicit real zero-or-positive opening count, audited metadata edits, compatible display-unit changes, no base-unit migration, archive only at zero stock while retaining visible history, role/revision/reason checks, write-before-success and stable retry. Anonymous seed balances remain unverified and historical fixtures remain separate.

Open for full EVL-128: EVL-126 cross-device transactions/acknowledgement and EVL-129 consumption/compensation, physical seed stock verification and real catalog acceptance. Archive does not erase item history or hide positive stock. Publish as a draft and verify combined split/refund/inventory behavior before integration acceptance.

Combined root integration at899b153 passed107 domain/108 component/10 Edge/7 journal and1 PWA cold restart, both builds, format/lint/types and credential scans. DraftPR25/26 GitHub quality passed. Actual rich checkout serialization and legacy checkout were independently strengthened and passed.
