import assert from "node:assert/strict";
import test from "node:test";
import {
  createCustomerLedger,
  customerAccounts,
  customerStatement,
  customerLimitCents,
  planCustomerCommand,
  validateCustomerLedger,
  customerAmountCents,
} from "./customer-ledger.mjs";

const owner = { actorId: "owner-1", role: "duena" };
let seq = 0;
function command(kind, payload, revision, overrides = {}) {
  return {
    commandId: `cmd-${++seq}`,
    customerId: "customer-1",
    kind,
    expectedRevision: revision,
    actorId: owner.actorId,
    actorName: "Owner",
    roleSnapshot: owner.role,
    occurredAt: "2026-09-30T12:00:00.000Z",
    reason: "Revisión operativa",
    payload,
    ...overrides,
  };
}
function append(state, kind, payload, overrides = {}) {
  const revision =
    customerAccounts(state).find((item) => item.customerId === "customer-1")
      ?.revision || 0;
  return planCustomerCommand(
    state,
    command(kind, payload, revision, overrides),
    owner,
  ).ledger;
}
function registered() {
  return append(createCustomerLedger(), "profile.create", {
    name: "Ana",
    phone: null,
  });
}
const movement = (amountCents, saleId = null, paymentId = null) => ({
  amountCents,
  saleId,
  paymentId,
});
const manualPayment = (amountCents, paymentId, paymentMethod = "cash") => ({
  amountCents,
  saleId: null,
  paymentId,
  paymentMethod,
  receiptStatus: "operator_reported_unverified",
});

test("separates debt from prepaid and requires an owner limit before a credit charge", () => {
  let state = registered();
  assert.throws(
    () => append(state, "debt.charge", movement(1, "sale-1")),
    /credit_limit_exceeded/,
  );
  state = append(state, "credit.limit", { limitCents: 10000 });
  state = append(state, "debt.charge", movement(5000, "sale-1"));
  state = append(
    state,
    "prepaid.deposit",
    manualPayment(1200, "receipt-1", "transfer"),
  );
  state = append(
    state,
    "debt.repayment",
    manualPayment(2500, "receipt-2", "cash"),
  );
  assert.deepEqual(customerAccounts(state)[0], {
    customerId: "customer-1",
    name: "Ana",
    phone: null,
    archived: false,
    creditLimitCents: 10000,
    debtCents: 2500,
    prepaidCents: 1200,
    revision: 5,
  });
  assert.deepEqual(state.events[3].payload, {
    amountCents: 1200,
    saleId: null,
    paymentId: "receipt-1",
    paymentMethod: "transfer",
    receiptStatus: "operator_reported_unverified",
  });
  assert.throws(
    () => append(state, "debt.repayment", manualPayment(2501, "receipt-3")),
    /invalid_amount/,
  );
  assert.throws(
    () => append(state, "prepaid.apply", movement(1201, "sale-2")),
    /invalid_amount/,
  );
  assert.throws(
    () => append(state, "credit.limit", { limitCents: 2499 }),
    /limit_below_debt/,
  );
});

test("preserves immutable history through linked partial reversals and blocks excess returns", () => {
  let state = registered();
  state = append(state, "prepaid.deposit", manualPayment(5000, "receipt-3"));
  const original = state.events.at(-1);
  state = append(state, "balance.reverse", {
    amountCents: 2000,
    reversesCommandId: original.commandId,
  });
  assert.equal(customerAccounts(state)[0].prepaidCents, 3000);
  assert.deepEqual(state.events[1], original);
  assert.throws(
    () =>
      append(state, "balance.reverse", {
        amountCents: 3001,
        reversesCommandId: original.commandId,
      }),
    /excess_reversal/,
  );
  state = append(state, "balance.reverse", {
    amountCents: 3000,
    reversesCommandId: original.commandId,
  });
  state = append(state, "profile.archive", {});
  assert.equal(customerAccounts(state)[0].archived, true);
  assert.equal(customerStatement(state, "customer-1").length, 5);
  assert.throws(
    () => append(state, "prepaid.deposit", manualPayment(1, "receipt-4")),
    /invalid_history/,
  );
});

test("checks current identity, owner-only limits, stable retries and source revisions", () => {
  const state = registered();
  assert.throws(
    () => planCustomerCommand(state, null, owner),
    /invalid_record/,
  );
  const cmd = command("credit.limit", { limitCents: 5000 }, 1);
  const first = planCustomerCommand(state, cmd, owner);
  assert.equal(planCustomerCommand(first.ledger, cmd, owner).duplicate, true);
  assert.equal(first.ledger.events.length, 2);
  assert.throws(
    () =>
      planCustomerCommand(
        first.ledger,
        { ...cmd, payload: { limitCents: 5001 } },
        owner,
      ),
    /command_conflict/,
  );
  assert.throws(
    () =>
      planCustomerCommand(
        first.ledger,
        { ...cmd, occurredAt: "2026-09-30T13:00:00.000Z" },
        owner,
      ),
    /command_conflict/,
  );
  assert.throws(
    () => planCustomerCommand(state, cmd, { actorId: "other", role: "duena" }),
    /not_authorized/,
  );
  assert.throws(
    () =>
      planCustomerCommand(
        state,
        { ...cmd, actorId: "manager", roleSnapshot: "encargado" },
        { actorId: "manager", role: "encargado" },
      ),
    /not_authorized/,
  );
  assert.throws(
    () =>
      planCustomerCommand(
        first.ledger,
        command("profile.update", { name: "Nueva", phone: null }, 1),
        owner,
      ),
    /stale_revision/,
  );
  assert.equal(state.events.length, 1);
  assert.equal(customerAccounts(state)[0].creditLimitCents, 0);
});

test("prevents a second sale charge or reusing a received payment across debt and prepaid", () => {
  let state = registered();
  state = append(state, "credit.limit", { limitCents: 5000 });
  state = append(state, "debt.charge", movement(1000, "sale-unique"));
  assert.throws(
    () => append(state, "debt.charge", movement(1000, "sale-unique")),
    /sale_already_linked/,
  );
  state = append(state, "debt.repayment", manualPayment(500, "receipt-unique"));
  assert.throws(
    () =>
      append(state, "prepaid.deposit", manualPayment(500, "receipt-unique")),
    /payment_already_linked/,
  );
  assert.throws(
    () => append(state, "profile.archive", {}),
    /unsettled_balance/,
  );
});

test("allows a manager to archive only a zero-balance account without changing its history", () => {
  let state = registered();
  state = append(state, "credit.limit", { limitCents: 1000 });
  state = append(state, "debt.charge", movement(1000, "sale-before-archive"));
  const manager = { actorId: "manager-1", role: "encargado" };
  const archiveCommand = (revision) =>
    command("profile.archive", {}, revision, {
      commandId: "manager-archive-customer",
      actorId: manager.actorId,
      actorName: "Encargado",
      roleSnapshot: manager.role,
    });
  assert.throws(
    () => planCustomerCommand(state, archiveCommand(3), manager),
    /unsettled_balance/,
  );

  state = append(
    state,
    "debt.repayment",
    manualPayment(1000, "receipt-before-archive"),
  );
  const priorEvents = structuredClone(state.events);
  const archived = planCustomerCommand(
    state,
    archiveCommand(4),
    manager,
  ).ledger;
  assert.equal(customerAccounts(archived)[0].archived, true);
  assert.deepEqual(archived.events.slice(0, priorEvents.length), priorEvents);
  assert.equal(archived.events.at(-1).actorId, manager.actorId);
  assert.equal(archived.events.at(-1).kind, "profile.archive");
});

test("rejects corrupt/unsupported history, unsafe amounts, extra secrets and fractional centavos", () => {
  const state = registered();
  const broken = structuredClone(state);
  broken.events[0].revision = 10;
  assert.throws(() => validateCustomerLedger(broken), /invalid_history/);
  assert.throws(
    () => validateCustomerLedger({ ...state, password: "never-copy" }),
    /invalid_record/,
  );
  assert.throws(
    () =>
      append(state, "profile.update", {
        name: "Ana",
        phone: null,
        password: "never-copy",
      }),
    /invalid_record/,
  );
  assert.throws(
    () =>
      append(state, "credit.limit", {
        limitCents: Number.MAX_SAFE_INTEGER + 1,
      }),
    /invalid_amount/,
  );
  assert.equal(customerAmountCents("12.34"), 1234);
  assert.equal(customerLimitCents("0.00"), 0);
  assert.throws(() => customerAmountCents("12.345"), /invalid_amount/);
  assert.throws(() => customerAmountCents("-1"), /invalid_amount/);
  assert.throws(
    () =>
      append(state, "prepaid.deposit", {
        ...manualPayment(100, "receipt-fake"),
        receiptStatus: "verified",
      }),
    /invalid_record/,
  );
});
