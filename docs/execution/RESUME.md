# Manual resume checkpoint

Continue this implementation from the saved worktrees and branch stacks, not from main. The main checkout remains clean at the audit baseline. No draft PR has been merged into main. No automation is scheduled.

## Reviewed and published

Draft PRs 1–10 cover EVL-154, 113, 117, 112, 114, 139, 119, 120 the current EVL-156 slice and EVL-116 foundation preparation. Every PR is attached to the task. The manifest maps exact branches, worktrees, commits, checks and remaining gates. A published draft or a pure-domain checkpoint does not mean the issue is complete.

The integration branch combines reviewed EVL-113/114/154/117/112 and the first two EVL-156 batches. Combining the UI/sync setup required package/config/lock resolution. All four HTML entries build, four actual-component/POS tests pass, and 22 domain/normalizer tests pass. Vitest only discovers JSX tests; Node and Playwright suites remain separate. Catalog 119/120 and Bluetooth 139 are published preparations but are not yet merged into integration.

The new Supabase project and reviewed POC schema are recorded in `backend.json`. Eight real hosted browser/RLS checks passed independently by root. Private synthetic credentials live in ignored mode-0600 files or outside the repository; never print or commit them. The applied migration is immutable. Renew the synthetic lease using the documented setup when repeating hosted proof; do not mistake logical device ownership for physical enrollment.

## Next actions

1. Inspect the EVL-116 checkpoint in the foundation worktree, its recorded test results and root-review state in the manifest. Its bounded root review and strengthened offline boot proof are recorded. Complete the remaining quality/update/preview work and review it before acceptance; reconcile configurations before integration or preview publication. Its quality/PWA slice still has incomplete legacy type/lint coverage, operator-safe update UI, hosting and diagnostics gates.
2. Reconcile reviewed EVL-116 with the integration configuration: retain Tailwind/aliases, all four HTML entries, private-fixture denial and separate UI/Node/Playwright discovery. Repeat only relevant checks after this merge. Verify the actual preview URL and `/karma/` navigation before claiming a reachable preview.
3. Complete EVL-118 authorization/enrollment and EVL-126 production persistence. Then wire the prepared catalog commands and immutable snapshots into actual UI/storage. The existing POS payment/kitchen/cash/cancellation defects remain application work; domain helpers alone have not fixed them.
4. Continue EVL-156 checkout/menu/inventory/report/configuration/editor mappings and wider flow regression. EVL-158 owns responsive app navigation/shell. Preserve the current reviewed focus and startup regressions.
5. Dispatch the remaining chains from reviewed dependency anchors, one managed worktree per chain, stacked `codex/` branches, GPT-6 Luna High agents. Root uses `/code-review --fix` for every completed issue, records fixes and acceptance evidence, then publishes draft PRs without merging main.

Keep hardware/device acceptance and Carlos catalog/photo/business approval gates open. Keep customer credit before pilot with the recorded role decisions. Do not create the three deferred standalone issues unless the user resumes that request. Do not move/merge accounts or message other people.

Run `node scripts/execution-status.mjs` and inspect the manifest before dispatch. Resume manually when the user asks; agents are stopped at committed checkpoints near the rate limit. Prefer finishing reviews and pushing checkpoints over starting new work near the allowance boundary.
