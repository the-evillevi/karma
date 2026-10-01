import assert from "node:assert/strict";
import test from "node:test";
import {
  CustomerBirthdayError,
  createCustomerBirthdayPolicyLedger,
  customerBirthdayPolicySnapshot,
  evaluateCustomerBirthdayEligibility,
  planCustomerBirthdayPolicyCommand,
  validateCustomerBirthdayPolicy,
  validateCustomerBirthdayPolicyLedger,
  validateCustomerBirthDate,
} from "./customer-birthday.mjs";

const owner = { actorId: "owner-1", role: "duena" };
let sequence = 0;
const disabled = {
  enabled: false,
  timeZone: null,
  window: null,
  leapDayRule: null,
  benefit: null,
};
function configured(overrides = {}) {
  return {
    enabled: true,
    timeZone: "America/Mexico_City",
    window: { kind: "window", daysBefore: 2, daysAfter: 3 },
    leapDayRule: "feb28",
    benefit: { kind: "maximum_cents", maxCoveredCents: 25000 },
    ...overrides,
  };
}
function save(ledger, policy, overrides = {}, actor = owner) {
  const command = {
    commandId: `birthday-policy:${++sequence}`,
    kind: "birthday.policy.set.v1",
    expectedRevision: customerBirthdayPolicySnapshot(ledger).revision,
    actorId: actor.actorId,
    actorName: "Dueña",
    roleSnapshot: actor.role,
    occurredAt: "2026-09-30T18:00:00.000Z",
    reason: "Configuración aprobada",
    payload: policy,
    ...overrides,
  };
  return planCustomerBirthdayPolicyCommand(ledger, command, actor);
}

test("birth dates are strict optional Gregorian calendar dates", () => {
  assert.equal(validateCustomerBirthDate(null), null);
  assert.equal(validateCustomerBirthDate("2000-02-29"), "2000-02-29");
  assert.equal(validateCustomerBirthDate("0001-01-01"), "0001-01-01");
  for (const value of [
    "1900-02-29",
    "2026-02-29",
    "2026-04-31",
    "2026-2-01",
    "0000-01-01",
    "2026-09-30T00:00:00Z",
  ]) {
    assert.throws(
      () => validateCustomerBirthDate(value),
      CustomerBirthdayError,
    );
  }
});

test("new policy ledgers are disabled and incomplete or ambiguous policies cannot activate", () => {
  const empty = createCustomerBirthdayPolicyLedger();
  assert.deepEqual(customerBirthdayPolicySnapshot(empty), {
    policy: disabled,
    revision: 0,
  });
  assert.equal(
    evaluateCustomerBirthdayEligibility({
      birthDate: "1990-01-02",
      policyLedger: empty,
      now: "2026-01-02T12:00:00.000Z",
    }).eligible,
    false,
  );
  assert.throws(
    () =>
      validateCustomerBirthdayPolicy({
        ...configured(),
        timeZone: "Local/Device",
      }),
    /invalid_time_zone/,
  );
  assert.throws(
    () => validateCustomerBirthdayPolicy({ ...configured(), benefit: null }),
    /incomplete_policy/,
  );
  assert.throws(
    () =>
      validateCustomerBirthdayPolicy({
        ...configured(),
        window: { kind: "window", daysBefore: 31, daysAfter: 0 },
      }),
    /invalid_policy/,
  );
  assert.throws(
    () =>
      validateCustomerBirthdayPolicy({ ...configured(), leapDayRule: null }),
    /incomplete_policy/,
  );
});

test("owner policy changes are audited, revision-guarded and safely idempotent", () => {
  const empty = createCustomerBirthdayPolicyLedger();
  const commandId = "birthday-policy:stable";
  const first = save(empty, configured(), { commandId });
  assert.equal(first.event.actorId, owner.actorId);
  assert.equal(first.event.reason, "Configuración aprobada");
  assert.equal(customerBirthdayPolicySnapshot(first.ledger).revision, 1);
  assert.equal(
    save(first.ledger, configured(), { commandId, expectedRevision: 0 })
      .duplicate,
    true,
  );
  assert.throws(
    () =>
      save(first.ledger, configured({ window: { kind: "exact_day" } }), {
        commandId,
      }),
    /command_conflict/,
  );
  assert.throws(
    () =>
      save(first.ledger, configured(), {
        commandId: "stale",
        expectedRevision: 0,
      }),
    /stale_revision/,
  );
  assert.throws(
    () =>
      save(
        empty,
        configured(),
        { commandId: "manager" },
        { actorId: "manager-1", role: "encargado" },
      ),
    /not_authorized/,
  );
  const corrupt = structuredClone(first.ledger);
  corrupt.events[0].payload.timeZone = "not-a-zone";
  assert.throws(
    () => validateCustomerBirthdayPolicyLedger(corrupt),
    /invalid_time_zone/,
  );
  assert.throws(
    () =>
      save(empty, configured(), {
        commandId: "bad-date",
        occurredAt: "2026-02-30T18:00:00.000Z",
      }),
    /invalid_timestamp/,
  );
  assert.throws(
    () =>
      save(empty, configured(), {
        commandId: "bad-hour",
        occurredAt: "2026-09-30T24:00:00Z",
      }),
    /invalid_timestamp/,
  );
});

test("eligibility uses branch-local calendar dates and handles a year-crossing window", () => {
  let ledger = createCustomerBirthdayPolicyLedger();
  ledger = save(
    ledger,
    configured({ window: { kind: "window", daysBefore: 2, daysAfter: 3 } }),
  ).ledger;
  const beforeBirthdayAtUtc = evaluateCustomerBirthdayEligibility({
    birthDate: "1990-01-01",
    policyLedger: ledger,
    now: "2025-12-30T18:30:00.000Z", // Dec 30 in Mexico City.
  });
  assert.equal(beforeBirthdayAtUtc.localDate, "2025-12-30");
  assert.equal(beforeBirthdayAtUtc.eligible, true);
  assert.equal(beforeBirthdayAtUtc.birthdayOccurrenceDate, "2026-01-01");
  assert.equal(beforeBirthdayAtUtc.birthdayCycleYear, 2026);
  assert.equal(beforeBirthdayAtUtc.reservationStatus, "preview_only");

  const utcBoundary = evaluateCustomerBirthdayEligibility({
    birthDate: "1990-01-01",
    policyLedger: ledger,
    now: "2026-01-01T05:30:00.000Z", // Dec 31 in Mexico City.
  });
  assert.equal(utcBoundary.localDate, "2025-12-31");
  assert.equal(utcBoundary.eligible, true);
  assert.equal(utcBoundary.birthdayOccurrenceDate, "2026-01-01");
});

test("February 29 uses the owner selected occurrence rule", () => {
  const withRule = (rule) =>
    save(
      createCustomerBirthdayPolicyLedger(),
      configured({ leapDayRule: rule }),
    ).ledger;
  const feb28 = evaluateCustomerBirthdayEligibility({
    birthDate: "2000-02-29",
    policyLedger: withRule("feb28"),
    now: "2025-02-28T18:00:00.000Z",
  });
  assert.equal(feb28.eligible, true);
  assert.equal(feb28.birthdayOccurrenceDate, "2025-02-28");
  const mar1 = evaluateCustomerBirthdayEligibility({
    birthDate: "2000-02-29",
    policyLedger: withRule("mar01"),
    now: "2025-03-01T18:00:00.000Z",
  });
  assert.equal(mar1.eligible, true);
  assert.equal(mar1.birthdayOccurrenceDate, "2025-03-01");
  const leapOnly = evaluateCustomerBirthdayEligibility({
    birthDate: "2000-02-29",
    policyLedger: withRule("leap_years_only"),
    now: "2025-02-28T18:00:00.000Z",
  });
  assert.equal(leapOnly.eligible, false);
  const leapYear = evaluateCustomerBirthdayEligibility({
    birthDate: "2000-02-29",
    policyLedger: withRule("leap_years_only"),
    now: "2028-02-29T18:00:00.000Z",
  });
  assert.equal(leapYear.eligible, true);
});

test("supports owner-selected product/category snapshots and explains missing birth dates", () => {
  const localPolicy = (benefit) =>
    save(
      createCustomerBirthdayPolicyLedger(),
      configured({
        window: { kind: "exact_day" },
        benefit,
      }),
    ).ledger;
  const productPolicy = localPolicy({
    kind: "product",
    id: "product-42",
    nameSnapshot: "Pastel del día",
  });
  const productPreview = evaluateCustomerBirthdayEligibility({
    birthDate: "1990-09-30",
    policyLedger: productPolicy,
    now: "2026-09-30T18:00:00.000Z",
  });
  assert.equal(productPreview.eligible, true);
  assert.equal(productPreview.benefit, "producto: Pastel del día");

  const categoryPolicy = localPolicy({
    kind: "category",
    id: "cat-7",
    nameSnapshot: "Bebidas frías",
  });
  assert.equal(
    customerBirthdayPolicySnapshot(categoryPolicy).policy.benefit.nameSnapshot,
    "Bebidas frías",
  );
  const missing = evaluateCustomerBirthdayEligibility({
    birthDate: null,
    policyLedger: categoryPolicy,
    now: "2026-09-30T18:00:00.000Z",
  });
  assert.equal(missing.eligible, false);
  assert.match(missing.reason, /no tiene fecha de nacimiento/);
});

test("rejects a birth date later than the branch-calendar date and validates the evaluation instant", () => {
  const policyLedger = save(
    createCustomerBirthdayPolicyLedger(),
    configured({ window: { kind: "exact_day" } }),
  ).ledger;
  for (const birthDate of ["2030-09-30", "2026-10-01"]) {
    const preview = evaluateCustomerBirthdayEligibility({
      birthDate,
      policyLedger,
      now: "2026-09-30T18:00:00.000Z",
    });
    assert.equal(preview.eligible, false);
    assert.match(preview.reason, /después de la fecha de la sucursal/);
  }
  assert.throws(
    () =>
      evaluateCustomerBirthdayEligibility({
        birthDate: "1990-09-30",
        policyLedger,
        now: "2026-02-30T18:00:00.000Z",
      }),
    /invalid_timestamp/,
  );
});
