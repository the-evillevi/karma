# Root code-review --fix · EVL-126/123 payment bridge

## Findings fixed and rereviewed

- Individually valid cash rows could carry a combined tender/change above safe integer cents while their net stayed small. The bridge now checks aggregate gross and change sums plus their relationship to all-in net. The overflow regression rejects that impossible current PosApp capture.
- The new JS module declaration omitted existing exported helpers and Spanish tender aliases. Root completed the declaration to preserve the existing module API; current code and tests typecheck. Runtime behavior is unchanged.

## Result and acceptance

No blocking findings in this bounded translator. It reconciles captured legacy all-in net with operation-v1 food net plus separately allocated tip, retains exact paired payment/tender identity, preserves zero-net returned cash from its captured tender ID, and keeps card/transfer explicitly manual/unverified. Missing facts, unknown provenance, unsupported currency, conflicting aliases, unmatched IDs, per-row/aggregate overflow and unsupported tip-only zero-food checkout fail closed. The current source sale shape is tested through an actual mounted PosApp checkout, not inferred from historical display values. Inputs are read, not mutated; Map identity lookup and constant field keys avoid untrusted object-key writes. Bounded50row maps and linear sums are adequate here. Error messages explain the violated capture invariant, and the versioned API documents its caller-provided order-due boundary.

Root independent8bridge domain tests and1actual mounted checkout-to-bridge test passed; typecheck/lint/format/diff passed. Agent172full domain tests and production build passed. Final scoped bridge source Snyk0medium+. No whole-projectsecurity claim.

Whole EVL-126/123 remains partially met. This library is unwired: no journal/local transaction, server write/receipt, provider settlement, customer credit/prepaid/birthday transaction, runtime synchronization or full restore. Caller-provided expected food due must come from verified captured operation order/discount facts; it is not independent server authority. Existing reports/payment semantics are unchanged. Draft only; no main merge or Linear write.
