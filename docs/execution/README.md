# Karma execution checkpoints

This branch coordinates the 39-issue roadmap. Do not merge it to production. Keep main untouched; publish draft PR stacks and reviewed integration checkpoints.

## Resume

1. Read manifest.json and the latest issue handoff. Inspect actual Git status, branch tips, managed worktree attachments, and PR bases before trusting recorded state.
2. Reclaim stale agent assignments. Never run two writers in one worktree or shared migration/package scope.
3. Select a queued issue with satisfied prerequisites. Resume a partial issue before starting a successor. Create/reuse the chain worktree and issue branch from the recorded reviewed base.
4. Use GPT-6 Luna High for implementation. Each issue records its source criteria, changes, exact checks and supporting commit, open gates, and next action in EVL-<number>.md.
5. GPT-6.1 Sol applies the code-review skill, fixes findings, verifies the fix, and reviews again. Record reviewed evidence before publishing the issue as implementation-ready.
6. Push bounded checkpoints and draft PRs. Root PRs target their dependency branch/checkpoint; descendants target the preceding issue. If prerequisites merge into main, rebase and retarget descendants, preserving the dependency map.
7. On rate limits, stop new delegation, preserve available changes and next steps, and resume when the user requests it. Do not schedule automatic wakes or repeatedly retry.

## Completion

Reviewed code can be integrated for preview without merging main. External acceptance is distinct from software readiness. Keep an issue open while merge, Carlos approval, real data, credentials, physical devices, or other stated criteria remain outstanding. No fake sync, print, backup, payment, or Bluetooth success messages count as evidence.

Deferred standalone issues remain covered by EVL-118 (owner-only user administration), EVL-128 (durable inventory movements), and EVL-122 (configurable tables). No new Linear issues are required.

## Shared policy

MXN integer centavos; independent preparation/payment states; immutable line snapshots; idempotent event IDs with original actor/device/time; consume stock at comanda send and compensate recorded consumption. One active cash-register writer. Roles: Dueña, Encargado, Barra, Mesero. Moving/merging accounts is deferred. Reprints require Dueña/Encargado and reason. Credit is before pilot: Dueña sets customer limits, Barra/Encargado use approved credit and record repayments, Dueña/Encargado make audited corrections. Manual export/recovery does not promise automatic historical backups.
