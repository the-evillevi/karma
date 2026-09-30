# EVL-130 local CSV export review with fixes

Root reviewed the pure builder checkpoint `b39c1a7` and the actual download path, with an independent read-only Luna xhigh review. Full EVL-130 acceptance remains open.

## Findings fixed

- A report route and ticket detail remained visible after current viewReports permission was lost. Root gated both rendering paths with the current permission and added a secure owner-to-Barra regression. Download itself independently rechecks current authority, including captured callback attempts.
- Refund CSV rows omitted their captured reason, original allocated payment ID and completeness evidence. Those fields are now explicit. Captured payment-link completeness is distinguished from external provider verification.
- The initial renderer tried to parse preserved legacy display dates as real dates. Real-date columns now require valid UTC ISO evidence; original recorded text remains separate, with unknown-date warnings and no fabricated day offset. Tips are emitted once on the sale summary, rather than duplicated into the same amount column on payment rows.
- The source scan flagged untrusted export content flowing into an unnecessary appended download anchor. Root removed the DOM insertion; detached-anchor downloads still pass actual Chromium proof. Final new CSV source scan has zero medium+ findings; PosApp has only four unchanged baseline Reports sinks. See adjacent evidence; no whole-project clean claim.

## Evidence

Three export domain tests and 29 actual screen regressions passed (27 shared POS plus two export/current-role cases). The checkout regression now asserts a valid persisted occurrence timestamp. Types, scoped lint/format and production build passed. Actual Chromium saved a .csv file with no page errors; a separate standard-library CSV reader confirmed aligned sale/payment columns, $50 net cash, $100 tender, $50 change and non-duplicated tips. This validates CSV download and parsing, not native Microsoft Excel application behavior. The sample uses only synthetic data.

## Acceptance

- Met in bounded local scope: generated CSV/download rather than simulated toast, quoted UTF-8 text and spreadsheet-formula neutralization, explicit currency/recorded-date columns and supplied branch timezone rendering, preserved cash/change/refund/payment audit evidence, current-role export/read denial, new checkout real timestamp and source immutability. No contact profiles, PIN/session/roster, or privileged credentials are exported.
- Open: true predefined/custom period selection and complete gross/refund/void/net/method dashboard reconciliation. Current selection is openly labeled the prototype relative-day view; historical date-less rows are not certified accounting periods. Refund dates remain actual captured facts.
- Open: remote acknowledgement and cross-device authoritative reporting, native Excel witnessed acceptance, and full backup/recovery. Every export row labels local status without treating a simulated sync field as authenticated server evidence.

Recommendation: accept this bounded export draft; continue the real-period and accounting work. Do not mark EVL-130 complete.
