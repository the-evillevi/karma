# EVL-136 birthday benefit implementation boundary

This is an implementation contract, not a completed benefit. EVL-135 customer administration is reviewed; atomic checkout and authoritative cross-device redemption remain EVL-126 gates. Never expose an application button or claim a completed free consumption before that transaction exists.

## First bounded delivery

Allow an optional birthday value in customer administration through a separately versioned, audited profile command. Preserve existing profile payloads/events and replay without guessing birthday values for historical customers. Validate the date and calendar exactly; do not silently normalize an invalid date. Keep this optional personal field behind current profile/account authorization, clear dialogs on actor/role loss, and keep the existing privacy and manual-retention boundary explicit.

The owner configures the rule; new installations remain disabled. Store a named policy revision with actor/time/reason, an explicit branch IANA time zone, an exact-day or explicitly approved window, and a supported benefit definition (product/category/maximum covered cents). Do not choose an arbitrary free product, amount, window, or February29 behavior on behalf of the owner. Unsupported or incomplete rules cannot become active. Evaluate eligibility against a passed branch-calendar date and validated policy rather than the device locale, UTC day, or an assumed elapsed365-day interval. Return concrete eligibility/ineligibility explanations. Eligibility planning alone cannot reserve or redeem the benefit.

Use integer centavos, immutable captured original prices and separate benefit allocations. A future redemption must name customer, birthday cycle, policy revision, sale, command ID, authorized actor/time/reason, allocated benefit, and any authorized exception. It must retain original prices and be distinguishable from discounts and payments in reports. Stable command identity alone does not stop different offline commands from redeeming the same birthday cycle: the real transaction must enforce that unique business constraint and reconcile losing offline attempts without pretending both succeeded.

## Deferred transaction and acceptance

No standalone local flag constitutes redemption or remote authority. The future EVL-126 multi-aggregate checkout commits order/sale/customer benefit facts atomically, performs current authorization, handles exact retries and changed-content conflicts, and enforces one redemption per approved birthday period. An exception requires a narrowly authorized role and nonblank reason with append-only history; no special approval UI until its server transaction is implemented.

Mounted tests protect actor/role changes, corrupt persisted records, failed save with preserved inputs, optional dates, and old-profile compatibility. Pure policy cases include time-zone boundaries, year crossing, leap birthdays, disabled/incomplete policies and same-cycle planning. Root code-review --fix must review the final bounded delivery and its explicit partial acceptance before any draft publication or integration. No Linear writes, main merge or real-person messages.
