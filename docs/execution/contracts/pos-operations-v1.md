# EVL-126 implementation contract: atomic operational commands

This is the next implementation boundary after the reviewed local journal and compatible snapshot adapter. It does not change the immutable, applied EVL-114/118 migrations, grant a client direct table writes, or certify prototype catalog/tax data. Implement it through new forward migrations and scoped modules, then review and prove it before connecting POS mutation success to it.

## Identity, authority and retry

An immutable business command contains schemaVersion, commandId, branchId, original actorId, deviceId, occurredAt, action, bounded reason where required, and action-specific payload. Session ID and the currently valid register lease are transport authorization, not immutable business facts; renewal must not change retry identity. The RPC derives its caller from auth.uid and requires that caller to equal the original actor. A new actor cannot upload another actor's pending commands. Both initial calls and identical retries recheck current active membership, device capability/revocation, bound session and current lease. Returning a prior acknowledgement must never bypass current authority.

Use the command's entire canonical business content for identical retry checks. A reused ID with changed scope, actor, occurrence, action, expected revisions or payload is a conflict, never success. Acknowledgements contain the stored command ID, committed server sequence and server received time. Client queue status changes to acknowledged only after this authenticated response. Locally generated receipts remain test fixtures, never sync evidence.

## Atomic state and concurrency

Each action declares every aggregate it touches, with expected revision and aggregate kind/ID. Acquire locks in a deterministic order by branch/kind/ID, including absent aggregate creation through a unique head row. Recheck all expected revisions after locks. Append the complete immutable command and advance all affected projections/revisions in one transaction. Preserve conflicting local attempts and their expected/current revisions for intervention; rollback every write on any failure. A command retry must be recognized before comparing its old expected revisions to already-advanced heads.

The same rules apply to one IndexedDB transaction across immutable commands, heads and projections, using browser transactions rather than an in-memory queue. Startup reconstructs and validates every operational projection from complete command replay. It must never replay only open-order saves while excluding checkout or cancellation, which would resurrect closed accounts.

## Mutation families and permissions

| Family                         | Atomic business effect                                                                                                                                                                  | Authority                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Order create/edit/send         | Current account plus one linked preparation ticket when sent; preserve captured lines, contact, table, discount authority and original creator                                          | openOrder; cash register                                               |
| Discount                       | Order revision, bounded amount and reason/authorizer; captured financial facts remain explicit                                                                                          | discountWithReason; owner/manager cash register                        |
| Account split                  | Source and child accounts plus shared preparation lineage; conserve quantities, subtotal and discount cents; never create a second physical preparation                                 | openOrder (existing reviewed split authority); cash register           |
| Checkout                       | Close source account, append immutable sale, payments/tenders/tips/change, preserve unfinished preparation, update operational projections                                              | checkout; owner/manager/barra cash register                            |
| Order/preparation cancellation | Append actor/reason/time event and close only the authorized target, retaining history; inventory inverse only when an actual consumption record exists                                 | cancelWithReason or cancelPreparationWithReason; approved capabilities |
| Preparation transition         | Enforce allowed prior/next state on the linked ticket, independent of payment                                                                                                           | prepareOrder; approved cash/preparation capability                     |
| Refund/void                    | Append allocations against original payment net, never tender/change; preserve sale and its original payment snapshots; inverse consumption is a separately identified linked operation | refundSaleWithReason; owner/manager cash register                      |
| Inventory/catalog              | Append audited item metadata/opening/movement/threshold operation; exact integer base units and revision guards; never rewrite history                                                  | adjustInventory/editMenu as applicable; owner/manager cash register    |

Implement one family at a time with explicit server validators and replay tests. Reject unsupported actions until their full validator exists. A client-provided projection or whole-state snapshot is not an authorized arbitrary replacement. Servers derive or compare transitions from prior state, prohibit changed immutable sale/payment data and enforce bounded values, safe integer cents/base units, currency MXN, exact field allowlists and size/count limits. Unknown price-version/tax facts retain unknown provenance and cannot become verified merely by uploading.

## Shared reads

Raw historical commands contain contact and financial information; do not broaden EVL-118 command history policy to solve shared operational views. A dedicated bounded incremental read RPC returns sanitized projections for an authenticated, currently enrolled session with active membership. Preparation devices receive kitchen-safe line/modifier/note and preparation fields without contact, financial records, staff credentials or raw command history. Cash operators receive the account fields needed by their role; report/history access remains owner/manager. Scope every cursor and projection to the authenticated branch and version; validate stale/cross-branch cursors and revocation on each request.

## Required proof before UI integration

Prove multi-aggregate rollback, changed-content retry rejection, identical retry after lease renewal, two-client revision contention, immutable sale/refund allocation constraints, current actor/session/membership/device revocation, capability/role denial, cross-branch reads, preparation data minimization, offline close/reopen replay, storage-failure retention and authenticated exact-once server acknowledgement. Use only the approved isolated karma-pos project and synthetic fixtures. Save migration hashes, remote history and exact evidence. No main merges or claims of full EVL-126 acceptance until these paths are implemented and tested.
