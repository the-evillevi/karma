import { moneyToCents } from "../domain/payment-tender.js";

const kinds = new Set([
  "profile.create",
  "profile.update",
  "profile.archive",
  "credit.limit",
  "debt.charge",
  "debt.repayment",
  "prepaid.deposit",
  "prepaid.apply",
  "balance.reverse",
]);
const financialKinds = new Set([
  "debt.charge",
  "debt.repayment",
  "prepaid.deposit",
  "prepaid.apply",
]);
const managerKinds = new Set([
  "profile.create",
  "profile.update",
  "debt.repayment",
  "prepaid.deposit",
]);
const manualPaymentMethods = new Set(["cash", "card", "transfer"]);
const fields = [
  "commandId",
  "customerId",
  "kind",
  "expectedRevision",
  "actorId",
  "actorName",
  "roleSnapshot",
  "occurredAt",
  "reason",
  "payload",
];

export class CustomerLedgerError extends Error {
  constructor(code) {
    super(code);
    this.name = "CustomerLedgerError";
    this.code = code;
  }
}
const fail = (code) => {
  throw new CustomerLedgerError(code);
};
function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("invalid_record");
  return value;
}
function exact(value, keys) {
  record(value);
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail("invalid_record");
}
function text(value, max = 160, optional = false) {
  if (optional && (value === null || value === "")) return null;
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    value !== value.trim()
  )
    fail("invalid_text");
  return value;
}
function integer(value, min = 0) {
  if (!Number.isSafeInteger(value) || value < min) fail("invalid_amount");
  return value;
}
function amount(value) {
  try {
    return integer(moneyToCents(value), 1);
  } catch {
    fail("invalid_amount");
  }
}
function canonicalCommand(value) {
  exact(value, fields);
  const command = structuredClone(value);
  for (const key of ["commandId", "customerId", "actorId", "actorName"])
    text(command[key]);
  text(command.reason, 250);
  if (!kinds.has(command.kind)) fail("unsupported_action");
  if (
    command.roleSnapshot !== "duena" &&
    (command.roleSnapshot !== "encargado" || !managerKinds.has(command.kind))
  )
    fail("not_authorized");
  integer(command.expectedRevision);
  if (
    typeof command.occurredAt !== "string" ||
    command.occurredAt.length > 40 ||
    !Number.isFinite(Date.parse(command.occurredAt))
  )
    fail("invalid_timestamp");
  const payload = record(command.payload);
  if (command.kind === "profile.create" || command.kind === "profile.update") {
    exact(payload, ["name", "phone"]);
    text(payload.name, 120);
    text(payload.phone, 40, true);
  } else if (command.kind === "profile.archive") {
    exact(payload, []);
  } else if (command.kind === "credit.limit") {
    exact(payload, ["limitCents"]);
    integer(payload.limitCents);
  } else if (["debt.repayment", "prepaid.deposit"].includes(command.kind)) {
    exact(payload, [
      "amountCents",
      "saleId",
      "paymentId",
      "paymentMethod",
      "receiptStatus",
    ]);
    integer(payload.amountCents, 1);
    if (payload.saleId !== null) fail("invalid_record");
    text(payload.paymentId);
    if (!manualPaymentMethods.has(payload.paymentMethod))
      fail("invalid_record");
    if (payload.receiptStatus !== "operator_reported_unverified")
      fail("invalid_record");
  } else if (financialKinds.has(command.kind)) {
    exact(payload, ["amountCents", "saleId", "paymentId"]);
    integer(payload.amountCents, 1);
    if (["debt.charge", "prepaid.apply"].includes(command.kind))
      text(payload.saleId);
    else fail("invalid_record");
    if (payload.paymentId !== null) fail("invalid_record");
  } else {
    exact(payload, ["amountCents", "reversesCommandId"]);
    integer(payload.amountCents, 1);
    text(payload.reversesCommandId);
  }
  return command;
}

function effect(kind, cents) {
  if (kind === "debt.charge") return [cents, 0];
  if (kind === "debt.repayment") return [-cents, 0];
  if (kind === "prepaid.deposit") return [0, cents];
  if (kind === "prepaid.apply") return [0, -cents];
  fail("invalid_reversal");
}
function replay(events) {
  const customers = new Map();
  const commands = new Map();
  const reversed = new Map();
  const saleLinks = new Set();
  const paymentLinks = new Set();
  for (const raw of events) {
    exact(raw, [...fields, "revision", "syncStatus"]);
    const { revision, syncStatus, ...input } = raw;
    const command = canonicalCommand(input);
    if (syncStatus !== "local_pending" || commands.has(command.commandId))
      fail("invalid_history");
    const customer = customers.get(command.customerId);
    if (command.kind === "profile.create") {
      if (customer || command.expectedRevision !== 0 || revision !== 1)
        fail("invalid_history");
      customers.set(command.customerId, {
        customerId: command.customerId,
        ...command.payload,
        archived: false,
        creditLimitCents: 0,
        debtCents: 0,
        prepaidCents: 0,
        revision: 1,
      });
    } else {
      if (
        !customer ||
        command.expectedRevision !== customer.revision ||
        revision !== customer.revision + 1 ||
        customer.archived
      )
        fail("invalid_history");
      const payload = command.payload;
      if (command.kind === "profile.update") {
        customer.name = payload.name;
        customer.phone = payload.phone;
      } else if (command.kind === "credit.limit") {
        if (payload.limitCents < customer.debtCents) fail("limit_below_debt");
        customer.creditLimitCents = payload.limitCents;
      } else if (command.kind === "profile.archive") {
        if (customer.debtCents || customer.prepaidCents)
          fail("unsettled_balance");
        customer.archived = true;
      } else {
        let delta;
        if (command.kind === "balance.reverse") {
          const source = commands.get(payload.reversesCommandId);
          if (
            !source ||
            source.customerId !== command.customerId ||
            !financialKinds.has(source.kind)
          )
            fail("invalid_reversal");
          const totalReversed =
            (reversed.get(source.commandId) || 0) + payload.amountCents;
          if (
            !Number.isSafeInteger(totalReversed) ||
            totalReversed > source.payload.amountCents
          )
            fail("excess_reversal");
          reversed.set(source.commandId, totalReversed);
          delta = effect(source.kind, payload.amountCents).map(
            (value) => -value,
          );
        } else {
          if (
            payload.saleId &&
            ["debt.charge", "prepaid.apply"].includes(command.kind)
          ) {
            const key = JSON.stringify([command.kind, payload.saleId]);
            if (saleLinks.has(key)) fail("sale_already_linked");
            saleLinks.add(key);
          }
          if (
            payload.paymentId &&
            ["debt.repayment", "prepaid.deposit"].includes(command.kind)
          ) {
            if (paymentLinks.has(payload.paymentId))
              fail("payment_already_linked");
            paymentLinks.add(payload.paymentId);
          }
          delta = effect(command.kind, payload.amountCents);
        }
        customer.debtCents = integer(customer.debtCents + delta[0]);
        customer.prepaidCents = integer(customer.prepaidCents + delta[1]);
        if (customer.debtCents > customer.creditLimitCents)
          fail("credit_limit_exceeded");
      }
      customer.revision = revision;
    }
    commands.set(command.commandId, { ...command, revision, syncStatus });
  }
  return { customers, commands };
}

/** Local domain planning only. The caller must supply the current verified authority. */
export function validateCustomerLedger(value) {
  exact(value, ["schemaVersion", "events"]);
  if (value.schemaVersion !== 1 || !Array.isArray(value.events))
    fail("invalid_history");
  replay(value.events);
  return structuredClone(value);
}
export function createCustomerLedger() {
  return { schemaVersion: 1, events: [] };
}
export function customerAccounts(value) {
  const valid = validateCustomerLedger(value);
  return [...replay(valid.events).customers.values()].map((customer) => ({
    ...customer,
  }));
}
export function customerStatement(value, customerId) {
  text(customerId);
  const valid = validateCustomerLedger(value);
  return valid.events.filter((event) => event.customerId === customerId);
}
export function planCustomerCommand(value, commandValue, currentAuthority) {
  const valid = validateCustomerLedger(value);
  const command = canonicalCommand(commandValue);
  const authority = record(currentAuthority);
  if (
    authority.actorId !== command.actorId ||
    authority.role !== command.roleSnapshot
  )
    fail("not_authorized");
  const { customers, commands } = replay(valid.events);
  const previous = commands.get(command.commandId);
  if (previous) {
    if (
      fields.some((key) =>
        key === "payload"
          ? Object.keys(previous.payload).some(
              (field) => previous.payload[field] !== command.payload[field],
            )
          : previous[key] !== command[key],
      )
    )
      fail("command_conflict");
    return { ledger: valid, event: previous, duplicate: true, changed: false };
  }
  const customer = customers.get(command.customerId);
  if (command.expectedRevision !== (customer?.revision || 0))
    fail("stale_revision");
  if (command.kind !== "profile.create" && !customer) fail("unknown_customer");
  const event = {
    ...command,
    revision: command.expectedRevision + 1,
    syncStatus: "local_pending",
  };
  const ledger = validateCustomerLedger({
    schemaVersion: 1,
    events: [...valid.events, event],
  });
  return { ledger, event, duplicate: false, changed: true };
}
export function customerAmountCents(value) {
  return amount(value);
}
export function customerLimitCents(value) {
  try {
    return integer(moneyToCents(value));
  } catch {
    fail("invalid_amount");
  }
}
