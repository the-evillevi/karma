/**
 * Versioned pure command contract for operational POS state. Commands contain
 * business identity only; login sessions, leases, and verified authority are
 * supplied out-of-band by the caller at append time.
 */

import {
  canPerform,
  isAccessRole,
  type AccessAction,
  type AccessRole,
} from "../access/role-policy.ts";
import { allocateDiscount, canTransitionPreparation } from "./order-domain.ts";

export const POS_OPERATION_SCHEMA_VERSION = 1 as const;
export const MAX_POS_OPERATION_BYTES = 1_000_000;

export type OperationAggregateKind = "order" | "preparation" | "sale";
export type OperationCapability = AccessAction | "refundSaleWithReason";
export type PosOrderStatus = "open" | "closed" | "cancelled";
export type PosOrderType =
  "local" | "mesa" | "llevar" | "recoger" | "domicilio";
export type PosPreparationStatus =
  "queued" | "preparing" | "ready" | "served" | "cancelled";

export interface ExpectedAggregateRevision {
  kind: OperationAggregateKind;
  id: string;
  revision: number;
}

export interface PosOperationLine {
  lineId: string;
  productId: string | null;
  nameSnapshot: string;
  quantity: number;
  currency: "MXN";
  baseUnitPriceCents: number | null;
  modifierTotalCents: number | null;
  unitPriceCents: number | null;
  lineTotalCents: number | null;
  priceEvidence:
    "catalog-versioned" | "prototype-captured" | "legacy-captured" | "unknown";
  catalogPriceVersionId: string | null;
  modifiers: Array<{
    groupId: string | null;
    optionId: string | null;
    nameSnapshot: string;
    quantity: number;
    unit: string | null;
    priceEffectCents: number | null;
  }>;
  notes: string | null;
  tax: {
    currency: "MXN";
    evidence: "catalog-versioned" | "prototype-captured" | "unknown";
    rateBasisPoints: number | null;
    amountCents: number | null;
    policyId: string | null;
  };
}

export interface PosCustomerContact {
  name: string | null;
  phone: string | null;
  address: string | null;
}

export interface PosPaymentInput {
  paymentId: string;
  method: "cash" | "card" | "transfer";
  netAmountCents: number;
  tipCents: number;
  tenderedCents: number | null;
  changeCents: number | null;
  recordMode: "manual";
  verification: "not-applicable" | "manual-unverified";
}

export interface PosOperationPayloads {
  "order.opened": {
    orderId: string;
    orderType: PosOrderType;
    tableId: string | null;
    customer: PosCustomerContact | null;
    lines: PosOperationLine[];
  };
  "order.line-added": { orderId: string; line: PosOperationLine };
  "order.line-changed": {
    orderId: string;
    lineId: string;
    line: PosOperationLine;
  };
  "order.line-removed": { orderId: string; lineId: string };
  "order.details-changed": {
    orderId: string;
    tableId?: string | null;
    customer?: PosCustomerContact | null;
  };
  "order.discounted": { orderId: string; amountCents: number };
  "preparation.sent": { orderId: string; preparationId: string };
  "preparation.transitioned": {
    orderId: string;
    preparationId: string;
    nextStatus: Exclude<PosPreparationStatus, "queued" | "cancelled">;
  };
  "preparation.cancelled": { orderId: string; preparationId: string };
  "order.cancelled": { orderId: string };
  "order.split": {
    sourceOrderId: string;
    childOrderId: string;
    transfers: Array<{
      lineId: string;
      childLineId: string;
      quantity: number;
    }>;
  };
  "order.checked-out": {
    orderId: string;
    saleId: string;
    payments: PosPaymentInput[];
  };
  "sale.refunded": {
    saleId: string;
    refundId: string;
    allocations: Array<{
      paymentId: string;
      method: PosPaymentInput["method"];
      amountCents: number;
    }>;
  };
}

export type PosOperationAction = keyof PosOperationPayloads;

export type PosOperationCommand = {
  [TAction in PosOperationAction]: {
    schemaVersion: typeof POS_OPERATION_SCHEMA_VERSION;
    commandId: string;
    branchId: string;
    actorId: string;
    deviceId: string;
    occurredAt: string;
    expectedRevisions: ExpectedAggregateRevision[];
    action: TAction;
    reason: string | null;
    payload: PosOperationPayloads[TAction];
  };
}[PosOperationAction];

/** This context must come from the current trusted access/lease layer. */
export interface PosOperationAuthority {
  actorId: string;
  branchId: string;
  deviceId: string;
  role: AccessRole;
  capabilities: readonly OperationCapability[];
}

export interface PosDiscountEntry {
  commandId: string;
  authorizedCents: number;
  allocatedCents: number;
  reason: string;
  actorId: string;
  occurredAt: string;
}

export interface PosOperationOrder {
  orderId: string;
  revision: number;
  status: PosOrderStatus;
  orderType: PosOrderType;
  tableId: string | null;
  customer: PosCustomerContact | null;
  createdByActorId: string;
  openedAt: string;
  lines: PosOperationLine[];
  discounts: PosDiscountEntry[];
  preparationId: string | null;
  splitFrom: { orderId: string; commandId: string } | null;
  splitOperations: Array<{
    commandId: string;
    childOrderId: string;
    actorId: string;
    occurredAt: string;
    transfers: Array<{ lineId: string; childLineId: string; quantity: number }>;
  }>;
  history: Array<{
    commandId: string;
    action: PosOperationAction;
    actorId: string;
    occurredAt: string;
    reason: string | null;
  }>;
  closedAt: string | null;
  cancellationReason: string | null;
  cancelledByActorId: string | null;
}

export interface PosOperationPreparation {
  preparationId: string;
  revision: number;
  originOrderId: string;
  linkedOrderIds: string[];
  status: PosPreparationStatus;
  lines: PosOperationLine[];
  createdByActorId: string;
  createdAt: string;
  history: Array<{
    commandId: string;
    actorId: string;
    occurredAt: string;
    from: PosPreparationStatus | null;
    to: PosPreparationStatus;
    reason: string | null;
  }>;
}

export interface PosOperationSale {
  saleId: string;
  revision: number;
  orderId: string;
  creatorActorId: string;
  orderType: PosOrderType;
  tableId: string | null;
  customer: PosCustomerContact | null;
  status: "closed";
  occurredAt: string;
  closedByActorId: string;
  preparationId: string | null;
  currency: "MXN";
  subtotalCents: number;
  discountCents: number;
  netTotalCents: number;
  tipCents: number;
  lines: PosOperationLine[];
  discounts: PosDiscountEntry[];
  payments: Array<
    PosPaymentInput & {
      recordedByActorId: string;
      recordedAt: string;
      commandId: string;
    }
  >;
  refunds: Array<{
    refundId: string;
    amountCents: number;
    allocations: Array<{
      paymentId: string;
      method: PosPaymentInput["method"];
      amountCents: number;
    }>;
    reason: string;
    actorId: string;
    occurredAt: string;
    commandId: string;
  }>;
}

export interface PosOperationsScope {
  branchId: string;
  deviceId: string;
}

export interface PosOperationsState extends PosOperationsScope {
  orders: PosOperationOrder[];
  preparations: PosOperationPreparation[];
  sales: PosOperationSale[];
  commands: PosOperationCommand[];
}

export interface PosOperationResult {
  state: PosOperationsState;
  duplicate: boolean;
  /** Aggregates whose persisted revision actually advances in this transition. */
  changedAggregates: ExpectedAggregateRevision[];
}

export interface PosOperationReplayStep {
  command: PosOperationCommand;
  changedAggregates: ExpectedAggregateRevision[];
}

export interface PosOperationReplayResult {
  state: PosOperationsState;
  steps: PosOperationReplayStep[];
}

export class PosOperationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class PosOperationRevisionConflict extends PosOperationError {
  constructor(
    readonly aggregate: ExpectedAggregateRevision,
    readonly actualRevision: number,
  ) {
    super(
      "OPERATION_REVISION_CONFLICT",
      `Expected ${aggregate.kind}/${aggregate.id} revision ${aggregate.revision}, found ${actualRevision}.`,
    );
  }
}

const operationCapabilities: readonly OperationCapability[] = [
  "openOrder",
  "checkout",
  "cancelWithReason",
  "cancelPreparationWithReason",
  "discountWithReason",
  "reprintWithReason",
  "editMenu",
  "adjustInventory",
  "viewStock",
  "viewReports",
  "manageUsers",
  "prepareOrder",
  "configureTables",
  "refundSaleWithReason",
];

const reasonRequired = new Set<PosOperationAction>([
  "order.discounted",
  "preparation.cancelled",
  "order.cancelled",
  "sale.refunded",
]);

const capabilityForAction: Record<PosOperationAction, OperationCapability> = {
  "order.opened": "openOrder",
  "order.line-added": "openOrder",
  "order.line-changed": "openOrder",
  "order.line-removed": "openOrder",
  "order.details-changed": "openOrder",
  "order.discounted": "discountWithReason",
  "preparation.sent": "openOrder",
  "preparation.transitioned": "prepareOrder",
  "preparation.cancelled": "cancelPreparationWithReason",
  "order.cancelled": "cancelWithReason",
  "order.split": "openOrder",
  "order.checked-out": "checkout",
  "sale.refunded": "refundSaleWithReason",
};

export function createPosOperationsState(
  scope: PosOperationsScope,
): PosOperationsState {
  assertId(scope.branchId, "branchId");
  assertId(scope.deviceId, "deviceId");
  return {
    branchId: scope.branchId,
    deviceId: scope.deviceId,
    orders: [],
    preparations: [],
    sales: [],
    commands: [],
  };
}

/** Validate the strict business command envelope and every action payload. */
export function validatePosOperationCommand(
  value: unknown,
): PosOperationCommand {
  const input = object(value, "command");
  assertOnlyKeys(
    input,
    [
      "schemaVersion",
      "commandId",
      "branchId",
      "actorId",
      "deviceId",
      "occurredAt",
      "expectedRevisions",
      "action",
      "reason",
      "payload",
    ],
    "command",
  );
  if (input.schemaVersion !== POS_OPERATION_SCHEMA_VERSION)
    throw new PosOperationError(
      "UNSUPPORTED_OPERATION_SCHEMA",
      "Unsupported POS operations command schema.",
    );
  assertId(input.commandId, "commandId");
  assertId(input.branchId, "branchId");
  assertId(input.actorId, "actorId");
  assertId(input.deviceId, "deviceId");
  assertTimestamp(input.occurredAt, "occurredAt");
  if (!isPosOperationAction(input.action))
    throw new PosOperationError(
      "UNSUPPORTED_OPERATION_ACTION",
      "Unsupported POS operation action.",
    );
  if (input.reason !== null) assertReason(input.reason);
  if (reasonRequired.has(input.action) && input.reason === null)
    throw new TypeError(`${input.action} requires a reason.`);
  if (!reasonRequired.has(input.action) && input.reason !== null)
    throw new TypeError(`${input.action} does not accept an envelope reason.`);
  validateExpectedRevisions(input.expectedRevisions);
  validateOperationPayload(input.action, input.payload);
  if (
    new TextEncoder().encode(stableJson(value)).byteLength >
    MAX_POS_OPERATION_BYTES
  )
    throw new PosOperationError(
      "OPERATION_TOO_LARGE",
      "POS operation exceeds the maximum serialized size.",
    );
  return structuredClone(value) as PosOperationCommand;
}

/** Apply one command under the caller's current verified authority. */
export function applyPosOperation(
  current: PosOperationsState,
  candidate: unknown,
  authority: PosOperationAuthority,
): PosOperationResult {
  const command = validatePosOperationCommand(candidate);
  validateAuthority(command, authority);
  authorize(command, authority);
  return applyValidatedOperation(current, command);
}

/**
 * Local-journal adapter entry point for a freshly reconstructed component that
 * it owns and will discard if the reducer throws. This avoids cloning the
 * complete immutable command history and unrelated aggregates on every append.
 */
export function applyPosOperationToOwnedState(
  ownedState: PosOperationsState,
  candidate: unknown,
  authority: PosOperationAuthority,
): PosOperationResult {
  const command = validatePosOperationCommand(candidate);
  validateAuthority(command, authority);
  authorize(command, authority);
  return applyValidatedOperation(ownedState, command, true);
}

/**
 * Rebuilds committed local facts without reauthorizing their original actors.
 * Authorization is checked on every new append/retry, never used to erase
 * history after a later role change or revocation.
 */
export function replayPosOperations(
  scope: PosOperationsScope,
  history: readonly unknown[],
): PosOperationsState {
  return replayPosOperationsWithChanges(scope, history).state;
}

/** Replay immutable history and report only aggregates whose revisions advance. */
export function replayPosOperationsWithChanges(
  scope: PosOperationsScope,
  history: readonly unknown[],
): PosOperationReplayResult {
  if (!Array.isArray(history)) throw new TypeError("history must be an array.");
  const commands = history.map(validatePosOperationCommand);
  const seen = new Set<string>();
  for (const command of commands) {
    if (seen.has(command.commandId))
      throw new PosOperationError(
        "OPERATION_DUPLICATE_HISTORY",
        "Committed history contains a duplicate command ID.",
      );
    seen.add(command.commandId);
  }

  // Independent order/preparation/sale components can be replayed separately.
  // This keeps one branch's many unrelated tickets out of each transition.
  const parent = new Map<string, string>();
  const root = (key: string): string => {
    const current = parent.get(key);
    if (!current) {
      parent.set(key, key);
      return key;
    }
    if (current === key) return key;
    const resolved = root(current);
    parent.set(key, resolved);
    return resolved;
  };
  const union = (left: string, right: string) => {
    const leftRoot = root(left);
    const rightRoot = root(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };
  for (const command of commands) {
    const keys = command.expectedRevisions.map(
      (ref) => `${ref.kind}\u0000${ref.id}`,
    );
    for (const key of keys) root(key);
    for (let index = 1; index < keys.length; index += 1)
      union(keys[0]!, keys[index]!);
  }

  const groups = new Map<string, PosOperationCommand[]>();
  for (const command of commands) {
    const first = command.expectedRevisions[0];
    if (!first)
      throw new PosOperationError(
        "OPERATION_AGGREGATE_SET_MISMATCH",
        "Every POS command must guard at least one aggregate.",
      );
    const key = root(`${first.kind}\u0000${first.id}`);
    const group = groups.get(key) ?? [];
    group.push(command);
    groups.set(key, group);
  }

  const state = createPosOperationsState(scope);
  const changedByCommand = new Map<string, ExpectedAggregateRevision[]>();
  for (const componentCommands of groups.values()) {
    const component = createPosOperationsState(scope);
    for (const command of componentCommands) {
      const result = applyValidatedOperation(component, command, true, true);
      changedByCommand.set(command.commandId, result.changedAggregates);
    }
    state.orders.push(...component.orders);
    state.preparations.push(...component.preparations);
    state.sales.push(...component.sales);
  }
  state.orders.sort((left, right) => compareId(left.orderId, right.orderId));
  state.preparations.sort((left, right) =>
    compareId(left.preparationId, right.preparationId),
  );
  state.sales.sort((left, right) => compareId(left.saleId, right.saleId));
  state.commands = commands;
  return {
    state,
    steps: commands.map((command) => ({
      command,
      changedAggregates: changedByCommand.get(command.commandId) ?? [],
    })),
  };
}

function applyValidatedOperation(
  current: PosOperationsState,
  command: PosOperationCommand,
  ownsState = false,
  knownUnique = false,
): PosOperationResult {
  if (
    current.branchId !== command.branchId ||
    current.deviceId !== command.deviceId
  )
    throw new PosOperationError(
      "OPERATION_SCOPE_MISMATCH",
      "Command branch or device does not match this local operations state.",
    );
  const prior = knownUnique
    ? undefined
    : current.commands.find((item) => item.commandId === command.commandId);
  if (prior) {
    if (stableJson(prior) !== stableJson(command))
      throw new PosOperationError(
        "OPERATION_COMMAND_ID_CONFLICT",
        "Command ID was reused with different immutable content.",
      );
    return {
      state: ownsState ? current : structuredClone(current),
      duplicate: true,
      changedAggregates: [],
    };
  }
  const refs = expectedTouchedAggregates(current, command);
  assertExpectedSet(command.expectedRevisions, refs);
  for (const ref of refs) {
    const actualRevision = aggregateRevision(current, ref.kind, ref.id);
    const expected = command.expectedRevisions.find(
      (candidate) => candidate.kind === ref.kind && candidate.id === ref.id,
    )!;
    if (actualRevision !== expected.revision)
      throw new PosOperationRevisionConflict(expected, actualRevision);
  }
  const next = ownsState ? current : structuredClone(current);
  reduceOperationTransition(next, command);
  next.commands.push(structuredClone(command));
  const changedAggregates: ExpectedAggregateRevision[] = [];
  for (const ref of refs) {
    const nextRevision = aggregateRevision(next, ref.kind, ref.id);
    if (nextRevision === ref.revision) continue;
    if (nextRevision !== ref.revision + 1)
      throw new PosOperationError(
        "OPERATION_REVISION_STEP_INVALID",
        "An operation must advance each changed aggregate by exactly one revision.",
      );
    changedAggregates.push({
      kind: ref.kind,
      id: ref.id,
      revision: nextRevision,
    });
  }
  if (changedAggregates.length === 0)
    throw new PosOperationError(
      "OPERATION_NO_STATE_CHANGE",
      "An operational command must advance at least one aggregate revision.",
    );
  return { state: next, duplicate: false, changedAggregates };
}

function reduceOperationTransition(
  state: PosOperationsState,
  command: PosOperationCommand,
): void {
  switch (command.action) {
    case "order.opened":
      reduceOrderOpened(state, command);
      return;
    case "order.line-added":
    case "order.line-changed":
    case "order.line-removed":
      reduceOrderLineChange(state, command);
      return;
    case "order.details-changed":
      reduceOrderDetails(state, command);
      return;
    case "order.discounted":
      reduceDiscount(state, command);
      return;
    case "preparation.sent":
      reducePreparationSent(state, command);
      return;
    case "preparation.transitioned":
    case "preparation.cancelled":
      reducePreparationChange(state, command);
      return;
    case "order.cancelled":
      reduceOrderCancellation(state, command);
      return;
    case "order.split":
      reduceOrderSplit(state, command);
      return;
    case "order.checked-out":
      reduceCheckout(state, command);
      return;
    case "sale.refunded":
      reduceSaleRefund(state, command);
      return;
    default:
      return assertNever(command);
  }
}

function reduceOrderOpened(
  state: PosOperationsState,
  command: Extract<PosOperationCommand, { action: "order.opened" }>,
): void {
  const { orderId, orderType, tableId, customer, lines } = command.payload;
  if (findById(state.orders, orderId, "orderId"))
    throw new PosOperationError(
      "ORDER_ALREADY_EXISTS",
      "An order with this ID already exists.",
    );
  const order: PosOperationOrder = {
    orderId,
    revision: 1,
    status: "open",
    orderType,
    tableId,
    customer: customer ? structuredClone(customer) : null,
    createdByActorId: command.actorId,
    openedAt: command.occurredAt,
    lines: structuredClone(lines),
    discounts: [],
    preparationId: null,
    splitFrom: null,
    splitOperations: [],
    history: [historyEvent(command)],
    closedAt: null,
    cancellationReason: null,
    cancelledByActorId: null,
  };
  validateOrderMoney(order);
  state.orders = sortedById([...state.orders, order], "orderId");
}

function reduceOrderLineChange(
  state: PosOperationsState,
  command: Extract<
    PosOperationCommand,
    {
      action: "order.line-added" | "order.line-changed" | "order.line-removed";
    }
  >,
): void {
  const order = requiredOrder(state, command.payload.orderId);
  requireOpenOrder(order);
  let lines = [...order.lines];
  if (command.action === "order.line-added") {
    if (lines.some((line) => line.lineId === command.payload.line.lineId))
      throw new PosOperationError(
        "ORDER_LINE_ALREADY_EXISTS",
        "An order line with this ID already exists.",
      );
    lines.push(structuredClone(command.payload.line));
  } else if (command.action === "order.line-changed") {
    const index = lines.findIndex(
      (line) => line.lineId === command.payload.lineId,
    );
    if (index < 0)
      throw new PosOperationError(
        "ORDER_LINE_NOT_FOUND",
        "Order line does not exist.",
      );
    lines[index] = structuredClone(command.payload.line);
  } else {
    const originalLength = lines.length;
    lines = lines.filter((line) => line.lineId !== command.payload.lineId);
    if (lines.length === originalLength)
      throw new PosOperationError(
        "ORDER_LINE_NOT_FOUND",
        "Order line does not exist.",
      );
  }
  if (lines.length > 200)
    throw new PosOperationError(
      "ORDER_TOO_MANY_LINES",
      "An account must contain at most 200 lines.",
    );
  if (lines.length === 0)
    throw new PosOperationError(
      "ORDER_MUST_RETAIN_LINE",
      "An open account must retain at least one line or be cancelled.",
    );
  const updated = {
    ...order,
    revision: order.revision + 1,
    lines,
    history: order.history,
  };
  validateOrderMoney(updated);
  synchronizeActivePreparation(state, order, lines);
  order.history.push(historyEvent(command));
  state.orders = replaceById(state.orders, updated, "orderId");
}

function synchronizeActivePreparation(
  state: PosOperationsState,
  order: PosOperationOrder,
  lines: PosOperationLine[],
): void {
  if (!order.preparationId) return;
  const preparation = requiredPreparation(state, order.preparationId);
  if (
    preparation.linkedOrderIds.length !== 1 ||
    !preparation.linkedOrderIds.includes(order.orderId)
  )
    throw new PosOperationError(
      "SHARED_PREPARATION_LINE_EDIT_UNSUPPORTED",
      "A shared preparation ticket cannot be changed through one account.",
    );
  if (preparation.status === "served" || preparation.status === "cancelled")
    throw new PosOperationError(
      "PREPARATION_TERMINAL",
      "A terminal preparation ticket cannot receive line edits.",
    );
  const updated = {
    ...preparation,
    revision: preparation.revision + 1,
    lines: structuredClone(lines),
  };
  state.preparations = replaceById(
    state.preparations,
    updated,
    "preparationId",
  );
}

function reduceOrderDetails(
  state: PosOperationsState,
  command: Extract<PosOperationCommand, { action: "order.details-changed" }>,
): void {
  const order = requiredOrder(state, command.payload.orderId);
  requireOpenOrder(order);
  const customer = Object.hasOwn(command.payload, "customer")
    ? command.payload.customer!
    : order.customer;
  validateOrderContact(order.orderType, customer);
  const updated = {
    ...order,
    revision: order.revision + 1,
    tableId: Object.hasOwn(command.payload, "tableId")
      ? command.payload.tableId!
      : order.tableId,
    customer: customer ? structuredClone(customer) : null,
    history: order.history,
  };
  order.history.push(historyEvent(command));
  state.orders = replaceById(state.orders, updated, "orderId");
}

function reduceDiscount(
  state: PosOperationsState,
  command: Extract<PosOperationCommand, { action: "order.discounted" }>,
): void {
  const order = requiredOrder(state, command.payload.orderId);
  requireOpenOrder(order);
  const subtotal = lineSubtotal(order.lines);
  if (subtotal === null)
    throw new PosOperationError(
      "ORDER_PRICE_INCOMPLETE",
      "A discount requires captured line totals.",
    );
  const currentDiscount = discountTotal(order.discounts);
  if (currentDiscount + command.payload.amountCents > subtotal)
    throw new RangeError("order discount exceeds its captured subtotal.");
  const entry: PosDiscountEntry = {
    commandId: command.commandId,
    authorizedCents: command.payload.amountCents,
    allocatedCents: command.payload.amountCents,
    reason: command.reason!,
    actorId: command.actorId,
    occurredAt: command.occurredAt,
  };
  order.discounts.push(entry);
  order.history.push(historyEvent(command));
  const updated = {
    ...order,
    revision: order.revision + 1,
    discounts: order.discounts,
    history: order.history,
  };
  validateOrderMoney(updated);
  state.orders = replaceById(state.orders, updated, "orderId");
}

function reducePreparationSent(
  state: PosOperationsState,
  command: Extract<PosOperationCommand, { action: "preparation.sent" }>,
): void {
  const order = requiredOrder(state, command.payload.orderId);
  requireOpenOrder(order);
  if (order.preparationId)
    throw new PosOperationError(
      "PREPARATION_ALREADY_SENT",
      "This account already has a preparation ticket.",
    );
  if (
    findById(state.preparations, command.payload.preparationId, "preparationId")
  )
    throw new PosOperationError(
      "PREPARATION_ALREADY_EXISTS",
      "A preparation ticket with this ID already exists.",
    );
  const preparation: PosOperationPreparation = {
    preparationId: command.payload.preparationId,
    revision: 1,
    originOrderId: order.orderId,
    linkedOrderIds: [order.orderId],
    status: "queued",
    lines: structuredClone(order.lines),
    createdByActorId: command.actorId,
    createdAt: command.occurredAt,
    history: [
      {
        commandId: command.commandId,
        actorId: command.actorId,
        occurredAt: command.occurredAt,
        from: null,
        to: "queued",
        reason: null,
      },
    ],
  };
  const updatedOrder = {
    ...order,
    revision: order.revision + 1,
    preparationId: preparation.preparationId,
    history: order.history,
  };
  order.history.push(historyEvent(command));
  state.orders = replaceById(state.orders, updatedOrder, "orderId");
  state.preparations = sortedById(
    [...state.preparations, preparation],
    "preparationId",
  );
}

function reducePreparationChange(
  state: PosOperationsState,
  command: Extract<
    PosOperationCommand,
    { action: "preparation.transitioned" | "preparation.cancelled" }
  >,
): void {
  const order = requiredOrder(state, command.payload.orderId);
  const preparation = requiredPreparation(state, command.payload.preparationId);
  requireOrderPreparationLink(order, preparation);
  const nextStatus: PosPreparationStatus =
    command.action === "preparation.cancelled"
      ? "cancelled"
      : command.payload.nextStatus;
  if (!canTransitionPreparation(preparation.status, nextStatus))
    throw new PosOperationError(
      "PREPARATION_TRANSITION_DENIED",
      `Preparation cannot transition from ${preparation.status} to ${nextStatus}.`,
    );
  const updated = {
    ...preparation,
    revision: preparation.revision + 1,
    status: nextStatus,
    history: preparation.history,
  };
  preparation.history.push({
    commandId: command.commandId,
    actorId: command.actorId,
    occurredAt: command.occurredAt,
    from: preparation.status,
    to: nextStatus,
    reason: command.reason,
  });
  state.preparations = replaceById(
    state.preparations,
    updated,
    "preparationId",
  );
}

function reduceOrderCancellation(
  state: PosOperationsState,
  command: Extract<PosOperationCommand, { action: "order.cancelled" }>,
): void {
  const order = requiredOrder(state, command.payload.orderId);
  requireOpenOrder(order);
  const updated: PosOperationOrder = {
    ...order,
    revision: order.revision + 1,
    status: "cancelled",
    closedAt: command.occurredAt,
    cancellationReason: command.reason,
    cancelledByActorId: command.actorId,
    history: order.history,
  };
  order.history.push(historyEvent(command));
  state.orders = replaceById(state.orders, updated, "orderId");
}

function reduceOrderSplit(
  state: PosOperationsState,
  command: Extract<PosOperationCommand, { action: "order.split" }>,
): void {
  const source = requiredOrder(state, command.payload.sourceOrderId);
  requireOpenOrder(source);
  if (source.orderId === command.payload.childOrderId)
    throw new PosOperationError(
      "SPLIT_ORDER_ID_COLLISION",
      "Source and child order IDs must differ.",
    );
  if (findById(state.orders, command.payload.childOrderId, "orderId"))
    throw new PosOperationError(
      "ORDER_ALREADY_EXISTS",
      "The split child order ID already exists.",
    );
  if (source.lines.some((line) => line.lineTotalCents === null))
    throw new PosOperationError(
      "SPLIT_PRICE_INCOMPLETE",
      "Split requires captured line totals for exact value conservation.",
    );

  const allLineIds = new Set(source.lines.map((line) => line.lineId));
  const transfers = command.payload.transfers;
  for (const transfer of transfers) {
    if (allLineIds.has(transfer.childLineId))
      throw new PosOperationError(
        "SPLIT_CHILD_LINE_ID_COLLISION",
        "Split child line IDs must be new and unique.",
      );
    allLineIds.add(transfer.childLineId);
  }

  const transferByLine = new Map(
    transfers.map((transfer) => [transfer.lineId, transfer] as const),
  );
  const childLines: PosOperationLine[] = [];
  const remainingLines: PosOperationLine[] = [];
  for (const line of source.lines) {
    const transfer = transferByLine.get(line.lineId);
    if (!transfer) {
      remainingLines.push(structuredClone(line));
      continue;
    }
    if (transfer.quantity > line.quantity)
      throw new RangeError("split quantity exceeds the source line quantity.");
    const remainingQuantity = line.quantity - transfer.quantity;
    // The v1 captured tax field has no unit/line amount basis. Copying a known
    // amount into both partial lines would invent an allocation or double it.
    if (remainingQuantity > 0 && line.tax.amountCents !== null)
      throw new PosOperationError(
        "SPLIT_TAX_BASIS_UNSUPPORTED",
        "A partial tax amount split requires an explicit reviewed amount basis.",
      );
    if (remainingQuantity > 0 && line.unitPriceCents === null)
      throw new PosOperationError(
        "SPLIT_UNIT_PRICE_UNKNOWN",
        "A partial line split requires a captured unit price.",
      );
    const childTotal =
      transfer.quantity === line.quantity
        ? line.lineTotalCents!
        : (line.unitPriceCents as number) * transfer.quantity;
    const sourceTotal =
      remainingQuantity === 0
        ? 0
        : (line.unitPriceCents as number) * remainingQuantity;
    if (!Number.isSafeInteger(childTotal) || !Number.isSafeInteger(sourceTotal))
      throw new RangeError("split line value exceeds safe integer cents.");
    childLines.push({
      ...structuredClone(line),
      lineId: transfer.childLineId,
      quantity: transfer.quantity,
      lineTotalCents: childTotal,
    });
    if (remainingQuantity > 0) {
      remainingLines.push({
        ...structuredClone(line),
        quantity: remainingQuantity,
        lineTotalCents: sourceTotal,
      });
    }
  }
  for (const transfer of transfers)
    if (!source.lines.some((line) => line.lineId === transfer.lineId))
      throw new PosOperationError(
        "ORDER_LINE_NOT_FOUND",
        "Split source line does not exist.",
      );
  if (remainingLines.length === 0)
    throw new PosOperationError(
      "SPLIT_MUST_RETAIN_SOURCE_LINE",
      "A split must leave at least one line on its source account.",
    );

  const movedDiscountByCommand = new Map<string, number>();
  for (const discount of source.discounts) {
    const distributed = allocateDiscount(
      discount.allocatedCents,
      source.lines.map((line) => ({
        lineId: line.lineId,
        subtotalCents: line.lineTotalCents as number,
      })),
    );
    const byLine = new Map(
      distributed.map((entry) => [entry.lineId, entry.cents]),
    );
    let moved = 0;
    for (const transfer of transfers) {
      const line = source.lines.find(
        (item) => item.lineId === transfer.lineId,
      )!;
      const lineDiscount = byLine.get(line.lineId) ?? 0;
      let childPart: number;
      if (transfer.quantity === line.quantity) {
        childPart = lineDiscount;
      } else {
        const childLine = childLines.find(
          (item) => item.lineId === transfer.childLineId,
        )!;
        const sourceLine = remainingLines.find(
          (item) => item.lineId === line.lineId,
        )!;
        const parts = allocateDiscount(lineDiscount, [
          {
            lineId: sourceLine.lineId,
            subtotalCents: sourceLine.lineTotalCents as number,
          },
          {
            lineId: childLine.lineId,
            subtotalCents: childLine.lineTotalCents as number,
          },
        ]);
        childPart = parts.find(
          (part) => part.lineId === childLine.lineId,
        )!.cents;
      }
      moved += childPart;
    }
    if (!Number.isSafeInteger(moved) || moved > discount.allocatedCents)
      throw new RangeError("split discount allocation is invalid.");
    movedDiscountByCommand.set(discount.commandId, moved);
  }

  const sourceDiscounts = source.discounts.map((discount) => ({
    ...discount,
    allocatedCents:
      discount.allocatedCents -
      (movedDiscountByCommand.get(discount.commandId) ?? 0),
  }));
  const childDiscounts = source.discounts.map((discount) => ({
    ...discount,
    allocatedCents: movedDiscountByCommand.get(discount.commandId) ?? 0,
  }));
  const splitOperation = {
    commandId: command.commandId,
    childOrderId: command.payload.childOrderId,
    actorId: command.actorId,
    occurredAt: command.occurredAt,
    transfers: structuredClone(transfers),
  };
  const updatedSource: PosOperationOrder = {
    ...source,
    revision: source.revision + 1,
    lines: remainingLines,
    discounts: sourceDiscounts,
    splitOperations: source.splitOperations,
    history: source.history,
  };
  const child: PosOperationOrder = {
    orderId: command.payload.childOrderId,
    revision: 1,
    status: "open",
    orderType: source.orderType,
    tableId: source.tableId,
    customer: source.customer ? structuredClone(source.customer) : null,
    createdByActorId: command.actorId,
    openedAt: command.occurredAt,
    lines: childLines,
    discounts: childDiscounts,
    preparationId: source.preparationId,
    splitFrom: { orderId: source.orderId, commandId: command.commandId },
    splitOperations: [],
    history: [historyEvent(command)],
    closedAt: null,
    cancellationReason: null,
    cancelledByActorId: null,
  };
  validateOrderMoney(updatedSource);
  validateOrderMoney(child);
  const beforeSubtotal = lineSubtotal(source.lines)!;
  const afterSubtotal =
    lineSubtotal(updatedSource.lines)! + lineSubtotal(child.lines)!;
  const beforeDiscount = discountTotal(source.discounts);
  const afterDiscount =
    discountTotal(updatedSource.discounts) + discountTotal(child.discounts);
  if (
    beforeSubtotal !== afterSubtotal ||
    beforeDiscount !== afterDiscount ||
    beforeSubtotal - beforeDiscount !== afterSubtotal - afterDiscount
  )
    throw new RangeError(
      "split does not conserve subtotal, discount, and due.",
    );

  source.splitOperations.push(splitOperation);
  source.history.push(historyEvent(command));

  state.orders = sortedById(
    [
      ...state.orders.filter((item) => item.orderId !== source.orderId),
      updatedSource,
      child,
    ],
    "orderId",
  );
  if (source.preparationId) {
    const preparation = requiredPreparation(state, source.preparationId);
    if (!preparation.linkedOrderIds.includes(source.orderId))
      throw new PosOperationError(
        "PREPARATION_LINK_MISMATCH",
        "Shared preparation is missing its source account link.",
      );
    const linkedOrderIds = [...preparation.linkedOrderIds, child.orderId].sort(
      compareId,
    );
    state.preparations = replaceById(
      state.preparations,
      { ...preparation, revision: preparation.revision + 1, linkedOrderIds },
      "preparationId",
    );
  }
}

function reduceCheckout(
  state: PosOperationsState,
  command: Extract<PosOperationCommand, { action: "order.checked-out" }>,
): void {
  const order = requiredOrder(state, command.payload.orderId);
  requireOpenOrder(order);
  if (findById(state.sales, command.payload.saleId, "saleId"))
    throw new PosOperationError(
      "SALE_ALREADY_EXISTS",
      "A sale with this ID already exists.",
    );
  if (
    order.lines.some(
      (line) =>
        line.lineTotalCents === null || line.priceEvidence === "unknown",
    )
  )
    throw new PosOperationError(
      "ORDER_PRICE_INCOMPLETE",
      "Checkout requires captured line totals and price provenance.",
    );
  if (order.preparationId)
    requireOrderPreparationLink(
      order,
      requiredPreparation(state, order.preparationId),
    );
  const subtotalCents = lineSubtotal(order.lines)!;
  const discountCents = discountTotal(order.discounts);
  const netTotalCents = subtotalCents - discountCents;
  if (!Number.isSafeInteger(netTotalCents) || netTotalCents < 0)
    throw new RangeError("sale total must be a non-negative safe cent amount.");
  const paymentNet = sumSafe(
    command.payload.payments.map((payment) => payment.netAmountCents),
    "payment net",
  );
  const tipCents = sumSafe(
    command.payload.payments.map((payment) => payment.tipCents),
    "payment tips",
  );
  if (paymentNet !== netTotalCents)
    throw new RangeError("payment net does not equal the captured order due.");
  if ((netTotalCents === 0) !== (command.payload.payments.length === 0))
    throw new RangeError(
      "zero-value sales have no payment rows; positive sales require payments.",
    );
  const recordedPayments = command.payload.payments.map((payment) => ({
    ...structuredClone(payment),
    recordedByActorId: command.actorId,
    recordedAt: command.occurredAt,
    commandId: command.commandId,
  }));
  const sale: PosOperationSale = {
    saleId: command.payload.saleId,
    revision: 1,
    orderId: order.orderId,
    creatorActorId: order.createdByActorId,
    orderType: order.orderType,
    tableId: order.tableId,
    customer: order.customer ? structuredClone(order.customer) : null,
    status: "closed",
    occurredAt: command.occurredAt,
    closedByActorId: command.actorId,
    preparationId: order.preparationId,
    currency: "MXN",
    subtotalCents,
    discountCents,
    netTotalCents,
    tipCents,
    lines: structuredClone(order.lines),
    discounts: structuredClone(order.discounts),
    payments: recordedPayments,
    refunds: [],
  };
  const closedOrder: PosOperationOrder = {
    ...order,
    revision: order.revision + 1,
    status: "closed",
    closedAt: command.occurredAt,
    history: order.history,
  };
  order.history.push(historyEvent(command));
  state.orders = replaceById(state.orders, closedOrder, "orderId");
  state.sales = sortedById([...state.sales, sale], "saleId");
}

function reduceSaleRefund(
  state: PosOperationsState,
  command: Extract<PosOperationCommand, { action: "sale.refunded" }>,
): void {
  const sale = requiredSale(state, command.payload.saleId);
  if (sale.status !== "closed")
    throw new PosOperationError(
      "SALE_NOT_CLOSED",
      "Only a closed sale can receive a refund.",
    );
  if (
    sale.refunds.some((refund) => refund.refundId === command.payload.refundId)
  )
    throw new PosOperationError(
      "REFUND_ALREADY_EXISTS",
      "A refund with this ID already exists.",
    );
  const allocationTotal = sumSafe(
    command.payload.allocations.map((allocation) => allocation.amountCents),
    "refund allocations",
  );
  const alreadyRefunded = sumSafe(
    sale.refunds.map((refund) => refund.amountCents),
    "prior refunds",
  );
  if (alreadyRefunded + allocationTotal > sale.netTotalCents)
    throw new RangeError("refund exceeds the captured sale payment net.");
  for (const allocation of command.payload.allocations) {
    const payment = sale.payments.find(
      (entry) => entry.paymentId === allocation.paymentId,
    );
    if (!payment)
      throw new PosOperationError(
        "REFUND_PAYMENT_NOT_FOUND",
        "Refund allocation references an unknown payment.",
      );
    if (payment.method !== allocation.method)
      throw new PosOperationError(
        "REFUND_PAYMENT_METHOD_MISMATCH",
        "Refund allocation method differs from its captured payment.",
      );
    const priorForPayment = sumSafe(
      sale.refunds.flatMap((refund) =>
        refund.allocations
          .filter((entry) => entry.paymentId === payment.paymentId)
          .map((entry) => entry.amountCents),
      ),
      "prior payment refunds",
    );
    if (priorForPayment + allocation.amountCents > payment.netAmountCents)
      throw new RangeError(
        "refund allocation exceeds original payment net, excluding tender and change.",
      );
  }
  const refund = {
    refundId: command.payload.refundId,
    amountCents: allocationTotal,
    allocations: structuredClone(command.payload.allocations),
    reason: command.reason!,
    actorId: command.actorId,
    occurredAt: command.occurredAt,
    commandId: command.commandId,
  };
  sale.refunds.push(refund);
  state.sales = replaceById(
    state.sales,
    { ...sale, revision: sale.revision + 1, refunds: sale.refunds },
    "saleId",
  );
}

function validateAuthority(
  command: PosOperationCommand,
  authority: PosOperationAuthority,
): void {
  const input = object(authority, "authority");
  assertOnlyKeys(
    input,
    ["actorId", "branchId", "deviceId", "role", "capabilities"],
    "authority",
  );
  assertId(input.actorId, "authority.actorId");
  assertId(input.branchId, "authority.branchId");
  assertId(input.deviceId, "authority.deviceId");
  if (!isAccessRole(input.role))
    throw new PosOperationError(
      "OPERATION_AUTHORITY_UNAVAILABLE",
      "Verified role is unavailable.",
    );
  if (
    input.actorId !== command.actorId ||
    input.branchId !== command.branchId ||
    input.deviceId !== command.deviceId
  )
    throw new PosOperationError(
      "OPERATION_AUTHORITY_MISMATCH",
      "Current actor, branch, and device must match the immutable command.",
    );
  if (!Array.isArray(input.capabilities))
    throw new TypeError("authority.capabilities must be an array.");
  for (const capability of input.capabilities)
    if (!operationCapabilities.includes(capability))
      throw new TypeError("authority contains an unknown capability.");
}

function authorize(
  command: PosOperationCommand,
  authority: PosOperationAuthority,
): void {
  const capability = capabilityForAction[command.action];
  if (!authority.capabilities.includes(capability))
    throw new PosOperationError(
      "OPERATION_CAPABILITY_DENIED",
      "Current authority does not grant this POS operation.",
    );
  if (capability === "refundSaleWithReason") {
    if (authority.role !== "duena" && authority.role !== "encargado")
      throw new PosOperationError(
        "OPERATION_ROLE_DENIED",
        "Only Dueña or Encargado may perform this POS operation.",
      );
    return;
  }
  if (!canPerform(authority.role, capability as AccessAction))
    throw new PosOperationError(
      "OPERATION_ROLE_DENIED",
      "Current role does not permit this POS operation.",
    );
}

function isPosOperationAction(value: unknown): value is PosOperationAction {
  return typeof value === "string" && Object.hasOwn(capabilityForAction, value);
}

function validateOperationPayload(
  action: PosOperationAction,
  value: unknown,
): void {
  const payload = object(value, `${action}.payload`);
  const requireId = (id: unknown, field: string) => assertId(id, field);
  switch (action) {
    case "order.opened":
      assertOnlyKeys(
        payload,
        ["orderId", "orderType", "tableId", "customer", "lines"],
        action,
      );
      requireId(payload.orderId, "orderId");
      if (
        !["local", "mesa", "llevar", "recoger", "domicilio"].includes(
          payload.orderType as string,
        )
      )
        throw new TypeError("orderType is unsupported.");
      assertNullableText(payload.tableId, "tableId", 80);
      validateCustomer(payload.customer);
      validateOrderContact(
        payload.orderType as PosOrderType,
        payload.customer as PosCustomerContact | null,
      );
      if (
        !Array.isArray(payload.lines) ||
        payload.lines.length === 0 ||
        payload.lines.length > 200
      )
        throw new TypeError("opened order must contain 1 to 200 lines.");
      payload.lines.forEach(validateLine);
      assertUniqueIds(payload.lines as Record<string, unknown>[], "lineId");
      break;
    case "order.line-added":
      assertOnlyKeys(payload, ["orderId", "line"], action);
      requireId(payload.orderId, "orderId");
      validateLine(payload.line);
      break;
    case "order.line-changed":
      assertOnlyKeys(payload, ["orderId", "lineId", "line"], action);
      requireId(payload.orderId, "orderId");
      requireId(payload.lineId, "lineId");
      validateLine(payload.line);
      if (object(payload.line, "line").lineId !== payload.lineId)
        throw new TypeError("changed line must retain its stable lineId.");
      break;
    case "order.line-removed":
      assertOnlyKeys(payload, ["orderId", "lineId"], action);
      requireId(payload.orderId, "orderId");
      requireId(payload.lineId, "lineId");
      break;
    case "order.details-changed":
      assertOnlyKeys(payload, ["orderId", "tableId", "customer"], action);
      requireId(payload.orderId, "orderId");
      if (
        !Object.hasOwn(payload, "tableId") &&
        !Object.hasOwn(payload, "customer")
      )
        throw new TypeError("details change must include a changed field.");
      if (Object.hasOwn(payload, "tableId"))
        assertNullableText(payload.tableId, "tableId", 80);
      if (Object.hasOwn(payload, "customer"))
        validateCustomer(payload.customer);
      break;
    case "order.discounted":
      assertOnlyKeys(payload, ["orderId", "amountCents"], action);
      requireId(payload.orderId, "orderId");
      assertMoney(payload.amountCents, "amountCents", 1);
      break;
    case "preparation.sent":
      assertOnlyKeys(payload, ["orderId", "preparationId"], action);
      requireId(payload.orderId, "orderId");
      requireId(payload.preparationId, "preparationId");
      break;
    case "preparation.transitioned":
      assertOnlyKeys(
        payload,
        ["orderId", "preparationId", "nextStatus"],
        action,
      );
      requireId(payload.orderId, "orderId");
      requireId(payload.preparationId, "preparationId");
      if (
        !["preparing", "ready", "served"].includes(payload.nextStatus as string)
      )
        throw new TypeError("nextStatus is unsupported.");
      break;
    case "preparation.cancelled":
      assertOnlyKeys(payload, ["orderId", "preparationId"], action);
      requireId(payload.orderId, "orderId");
      requireId(payload.preparationId, "preparationId");
      break;
    case "order.cancelled":
      assertOnlyKeys(payload, ["orderId"], action);
      requireId(payload.orderId, "orderId");
      break;
    case "order.split":
      assertOnlyKeys(
        payload,
        ["sourceOrderId", "childOrderId", "transfers"],
        action,
      );
      requireId(payload.sourceOrderId, "sourceOrderId");
      requireId(payload.childOrderId, "childOrderId");
      if (
        !Array.isArray(payload.transfers) ||
        payload.transfers.length === 0 ||
        payload.transfers.length > 200
      )
        throw new TypeError("split requires 1 to 200 line transfers.");
      payload.transfers.forEach((raw, index) => {
        const transfer = object(raw, `transfers[${index}]`);
        assertOnlyKeys(
          transfer,
          ["lineId", "childLineId", "quantity"],
          "split transfer",
        );
        requireId(transfer.lineId, "transfer.lineId");
        requireId(transfer.childLineId, "transfer.childLineId");
        assertInteger(transfer.quantity, "transfer.quantity", 1);
      });
      assertUniqueIds(payload.transfers as Record<string, unknown>[], "lineId");
      assertUniqueIds(
        payload.transfers as Record<string, unknown>[],
        "childLineId",
      );
      break;
    case "order.checked-out":
      assertOnlyKeys(payload, ["orderId", "saleId", "payments"], action);
      requireId(payload.orderId, "orderId");
      requireId(payload.saleId, "saleId");
      if (!Array.isArray(payload.payments) || payload.payments.length > 50)
        throw new TypeError("payments must contain at most 50 entries.");
      payload.payments.forEach(validatePayment);
      assertUniqueIds(
        payload.payments as Record<string, unknown>[],
        "paymentId",
      );
      break;
    case "sale.refunded":
      assertOnlyKeys(payload, ["saleId", "refundId", "allocations"], action);
      requireId(payload.saleId, "saleId");
      requireId(payload.refundId, "refundId");
      if (
        !Array.isArray(payload.allocations) ||
        payload.allocations.length === 0 ||
        payload.allocations.length > 50
      )
        throw new TypeError("refund requires 1 to 50 payment allocations.");
      payload.allocations.forEach((raw, index) => {
        const allocation = object(raw, `allocations[${index}]`);
        assertOnlyKeys(
          allocation,
          ["paymentId", "method", "amountCents"],
          "refund allocation",
        );
        requireId(allocation.paymentId, "allocation.paymentId");
        if (!["cash", "card", "transfer"].includes(allocation.method as string))
          throw new TypeError("refund payment method is unsupported.");
        assertMoney(allocation.amountCents, "allocation.amountCents", 1);
      });
      assertUniqueIds(
        payload.allocations as Record<string, unknown>[],
        "paymentId",
      );
      break;
    default:
      assertNever(action);
  }
}

function validateLine(value: unknown): asserts value is PosOperationLine {
  const line = object(value, "line");
  assertOnlyKeys(
    line,
    [
      "lineId",
      "productId",
      "nameSnapshot",
      "quantity",
      "currency",
      "baseUnitPriceCents",
      "modifierTotalCents",
      "unitPriceCents",
      "lineTotalCents",
      "priceEvidence",
      "catalogPriceVersionId",
      "modifiers",
      "notes",
      "tax",
    ],
    "line",
  );
  assertId(line.lineId, "line.lineId");
  assertNullableId(line.productId, "line.productId");
  assertText(line.nameSnapshot, "line.nameSnapshot", 200);
  assertInteger(line.quantity, "line.quantity", 1);
  if (line.currency !== "MXN")
    throw new TypeError("line.currency must be MXN.");
  const baseUnitPriceCents = readNullableMoney(
    line.baseUnitPriceCents,
    "line.baseUnitPriceCents",
  );
  const modifierTotalCents = readNullableMoney(
    line.modifierTotalCents,
    "line.modifierTotalCents",
  );
  const unitPriceCents = readNullableMoney(
    line.unitPriceCents,
    "line.unitPriceCents",
  );
  const lineTotalCents = readNullableMoney(
    line.lineTotalCents,
    "line.lineTotalCents",
  );
  const evidence = line.priceEvidence;
  if (
    ![
      "catalog-versioned",
      "prototype-captured",
      "legacy-captured",
      "unknown",
    ].includes(evidence as string)
  )
    throw new TypeError("line.priceEvidence is unsupported.");
  assertNullableId(line.catalogPriceVersionId, "line.catalogPriceVersionId");
  if (evidence === "catalog-versioned") {
    assertId(line.catalogPriceVersionId, "line.catalogPriceVersionId");
    assertId(line.productId, "line.productId");
  } else if (line.catalogPriceVersionId !== null) {
    throw new TypeError(
      "unverified prices cannot carry a catalog price version.",
    );
  }
  if (
    evidence === "unknown" &&
    [
      baseUnitPriceCents,
      modifierTotalCents,
      unitPriceCents,
      lineTotalCents,
    ].some((amount) => amount !== null)
  )
    throw new TypeError(
      "unknown price provenance cannot carry a price amount.",
    );
  if (baseUnitPriceCents !== null && modifierTotalCents !== null) {
    const sum = baseUnitPriceCents + modifierTotalCents;
    if (!Number.isSafeInteger(sum) || unitPriceCents !== sum)
      throw new RangeError(
        "captured base and modifier cents do not equal unit price.",
      );
  }
  if (unitPriceCents !== null) {
    const total = unitPriceCents * (line.quantity as number);
    if (!Number.isSafeInteger(total) || lineTotalCents !== total)
      throw new RangeError(
        "captured unit price and quantity do not equal line total.",
      );
  }
  assertNullableText(line.notes, "line.notes", 500);
  if (!Array.isArray(line.modifiers) || line.modifiers.length > 100)
    throw new TypeError("line.modifiers must contain at most 100 entries.");
  line.modifiers.forEach((raw, index) => {
    const modifier = object(raw, `line.modifiers[${index}]`);
    assertOnlyKeys(
      modifier,
      [
        "groupId",
        "optionId",
        "nameSnapshot",
        "quantity",
        "unit",
        "priceEffectCents",
      ],
      "modifier",
    );
    assertNullableId(modifier.groupId, "modifier.groupId");
    assertNullableId(modifier.optionId, "modifier.optionId");
    if (modifier.groupId === null || modifier.optionId === null)
      throw new TypeError("modifier selections require group and option IDs.");
    assertText(modifier.nameSnapshot, "modifier.nameSnapshot", 160);
    assertInteger(modifier.quantity, "modifier.quantity", 1);
    assertNullableText(modifier.unit, "modifier.unit", 40);
    assertNullableMoney(modifier.priceEffectCents, "modifier.priceEffectCents");
  });
  const modifierIdentities = line.modifiers.map((raw) => {
    const modifier = raw as Record<string, unknown>;
    return JSON.stringify([modifier.groupId, modifier.optionId]);
  });
  if (new Set(modifierIdentities).size !== modifierIdentities.length)
    throw new TypeError("line contains a duplicate modifier identity.");
  if (
    modifierTotalCents !== null &&
    line.modifiers.every(
      (modifier) =>
        (modifier as Record<string, unknown>).priceEffectCents !== null,
    )
  ) {
    const capturedModifierTotal = (
      line.modifiers as Array<{
        quantity: number;
        priceEffectCents: number;
      }>
    ).reduce((sum, modifier) => {
      const next = sum + modifier.priceEffectCents * modifier.quantity;
      if (!Number.isSafeInteger(next))
        throw new RangeError(
          "captured modifier total exceeds safe integer cents.",
        );
      return next;
    }, 0);
    if (capturedModifierTotal !== modifierTotalCents)
      throw new RangeError(
        "captured modifier effects do not equal modifierTotalCents.",
      );
  }
  const tax = object(line.tax, "line.tax");
  assertOnlyKeys(
    tax,
    ["currency", "evidence", "rateBasisPoints", "amountCents", "policyId"],
    "tax",
  );
  if (tax.currency !== "MXN") throw new TypeError("tax.currency must be MXN.");
  if (
    !["catalog-versioned", "prototype-captured", "unknown"].includes(
      tax.evidence as string,
    )
  )
    throw new TypeError("tax.evidence is unsupported.");
  assertNullableMoney(tax.rateBasisPoints, "tax.rateBasisPoints");
  assertNullableMoney(tax.amountCents, "tax.amountCents");
  assertNullableId(tax.policyId, "tax.policyId");
  if (
    tax.evidence === "unknown" &&
    (tax.rateBasisPoints !== null ||
      tax.amountCents !== null ||
      tax.policyId !== null)
  )
    throw new TypeError(
      "unknown tax provenance cannot carry tax policy or amounts.",
    );
  if (tax.evidence === "catalog-versioned")
    assertId(tax.policyId, "tax.policyId");
  else if (tax.policyId !== null)
    throw new TypeError("unverified tax cannot carry a policy ID.");
}

function validateCustomer(value: unknown): void {
  if (value === null) return;
  const customer = object(value, "customer");
  assertOnlyKeys(customer, ["name", "phone", "address"], "customer contact");
  assertNullableText(customer.name, "customer.name", 160);
  assertNullableText(customer.phone, "customer.phone", 80);
  assertNullableText(customer.address, "customer.address", 250);
}

function validateOrderContact(
  orderType: PosOrderType,
  value: PosCustomerContact | null,
): void {
  if (orderType === "domicilio") {
    validateDeliveryContact(value);
  } else if (orderType === "llevar" || orderType === "recoger") {
    if (value === null)
      throw new TypeError(`${orderType} requires customer contact.`);
    const customer = object(value, `${orderType} customer`);
    assertText(customer.name, `${orderType} customer.name`, 160);
    assertText(customer.phone, `${orderType} customer.phone`, 80);
  }
}

function validateDeliveryContact(
  value: unknown,
): asserts value is PosCustomerContact {
  if (value === null)
    throw new TypeError("delivery requires customer contact.");
  const customer = object(value, "delivery customer");
  for (const field of ["name", "phone", "address"] as const)
    assertText(
      customer[field],
      `delivery customer.${field}`,
      field === "address" ? 250 : 160,
    );
}

function validatePayment(value: unknown): asserts value is PosPaymentInput {
  const payment = object(value, "payment");
  assertOnlyKeys(
    payment,
    [
      "paymentId",
      "method",
      "netAmountCents",
      "tipCents",
      "tenderedCents",
      "changeCents",
      "recordMode",
      "verification",
    ],
    "payment",
  );
  assertId(payment.paymentId, "payment.paymentId");
  if (!["cash", "card", "transfer"].includes(payment.method as string))
    throw new TypeError("payment method is unsupported.");
  assertMoney(payment.netAmountCents, "payment.netAmountCents", 0);
  assertMoney(payment.tipCents, "payment.tipCents", 0);
  assertNullableMoney(payment.tenderedCents, "payment.tenderedCents");
  assertNullableMoney(payment.changeCents, "payment.changeCents");
  if (payment.recordMode !== "manual")
    throw new TypeError("payment.recordMode must be manual.");
  if (
    !["not-applicable", "manual-unverified"].includes(
      payment.verification as string,
    )
  )
    throw new TypeError("payment verification is unsupported.");
  if (payment.method === "cash") {
    assertMoney(payment.tenderedCents, "payment.tenderedCents", 0);
    assertMoney(payment.changeCents, "payment.changeCents", 0);
    if (
      payment.tenderedCents !==
      payment.netAmountCents + payment.tipCents + payment.changeCents
    )
      throw new RangeError(
        "cash tender, net, tip and change do not reconcile.",
      );
    if (payment.verification !== "not-applicable")
      throw new TypeError("cash payment verification must be not-applicable.");
  } else {
    if (payment.tenderedCents !== null || payment.changeCents !== null)
      throw new TypeError("tendered and change apply only to cash.");
    if (payment.verification !== "manual-unverified")
      throw new TypeError("external payment cannot be marked verified here.");
  }
}

function validateExpectedRevisions(
  value: unknown,
): asserts value is ExpectedAggregateRevision[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4)
    throw new TypeError("expectedRevisions must contain 1 to 4 aggregates.");
  const refs = value.map((raw, index) => {
    const ref = object(raw, `expectedRevisions[${index}]`);
    assertOnlyKeys(ref, ["kind", "id", "revision"], "aggregate revision");
    if (!["order", "preparation", "sale"].includes(ref.kind as string))
      throw new TypeError("aggregate revision kind is unsupported.");
    assertId(ref.id, "aggregate revision id");
    assertInteger(ref.revision, "aggregate revision", 0);
    return ref as unknown as ExpectedAggregateRevision;
  });
  const keys = refs.map((ref) => `${ref.kind}\u0000${ref.id}`);
  if (new Set(keys).size !== keys.length)
    throw new TypeError("expectedRevisions contains duplicate aggregates.");
  const sorted = [...refs].sort(compareRevisionRef);
  if (
    refs.some(
      (ref, index) =>
        ref.kind !== sorted[index]?.kind || ref.id !== sorted[index]?.id,
    )
  )
    throw new TypeError(
      "expectedRevisions must use canonical aggregate order.",
    );
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length)
    throw new TypeError(
      `${label} contains unsupported fields: ${extra.join(", ")}.`,
    );
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function assertId(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 180 ||
    value.trim() !== value
  )
    throw new TypeError(`${label} must be a non-empty bounded identifier.`);
}

function assertNullableId(value: unknown, label: string): void {
  if (value !== null) assertId(value, label);
}

function assertText(
  value: unknown,
  label: string,
  maximum: number,
): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum)
    throw new TypeError(
      `${label} must be a non-empty string of at most ${maximum} characters.`,
    );
}

function assertNullableText(
  value: unknown,
  label: string,
  maximum: number,
): void {
  if (value !== null) {
    if (typeof value !== "string" || value.length > maximum)
      throw new TypeError(
        `${label} must be null or a string of at most ${maximum} characters.`,
      );
  }
}

function assertReason(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 250)
    throw new TypeError(
      "reason must be a non-empty string of at most 250 characters.",
    );
}

function assertInteger(
  value: unknown,
  label: string,
  minimum: number,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  )
    throw new RangeError(`${label} must be a safe integer >= ${minimum}.`);
}

function assertMoney(
  value: unknown,
  label: string,
  minimum: number,
): asserts value is number {
  assertInteger(value, label, minimum);
}

function assertNullableMoney(value: unknown, label: string): void {
  if (value !== null) assertMoney(value, label, 0);
}

function readNullableMoney(value: unknown, label: string): number | null {
  if (value === null) return null;
  assertMoney(value, label, 0);
  return value;
}

function assertTimestamp(
  value: unknown,
  label: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new TypeError(`${label} must be a UTC ISO timestamp.`);
}

function assertUniqueIds(values: Record<string, unknown>[], key: string): void {
  const ids = values.map((value) => value[key]);
  if (
    ids.some((id) => typeof id !== "string") ||
    new Set(ids).size !== ids.length
  )
    throw new TypeError(`${key} values must be present and unique.`);
}

function assertNever(value: never): never {
  throw new TypeError(`Unsupported POS operation: ${String(value)}.`);
}

function compareRevisionRef(
  left: ExpectedAggregateRevision,
  right: ExpectedAggregateRevision,
): number {
  return left.kind === right.kind
    ? compareId(left.id, right.id)
    : compareId(left.kind, right.kind);
}

function compareId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function expectedTouchedAggregates(
  current: PosOperationsState,
  command: PosOperationCommand,
): ExpectedAggregateRevision[] {
  switch (command.action) {
    case "order.opened":
      return [{ kind: "order", id: command.payload.orderId, revision: 0 }];
    case "order.line-added":
    case "order.line-changed":
    case "order.line-removed": {
      const order = requiredOrder(current, command.payload.orderId);
      if (order.preparationId) {
        const refs: ExpectedAggregateRevision[] = [
          { kind: "order", id: order.orderId, revision: order.revision },
          {
            kind: "preparation",
            id: order.preparationId,
            revision: requiredPreparation(current, order.preparationId)
              .revision,
          },
        ];
        return refs.sort(compareRevisionRef);
      }
      return [{ kind: "order", id: order.orderId, revision: order.revision }];
    }
    case "order.details-changed":
    case "order.discounted":
    case "order.cancelled": {
      const order = requiredOrder(current, command.payload.orderId);
      return [{ kind: "order", id: order.orderId, revision: order.revision }];
    }
    case "preparation.sent": {
      const order = requiredOrder(current, command.payload.orderId);
      const refs: ExpectedAggregateRevision[] = [
        { kind: "order", id: order.orderId, revision: order.revision },
        { kind: "preparation", id: command.payload.preparationId, revision: 0 },
      ];
      return refs.sort(compareRevisionRef);
    }
    case "preparation.transitioned":
    case "preparation.cancelled": {
      const order = requiredOrder(current, command.payload.orderId);
      const preparation = requiredPreparation(
        current,
        command.payload.preparationId,
      );
      if (order.preparationId !== preparation.preparationId)
        throw new PosOperationError(
          "PREPARATION_LINK_MISMATCH",
          "Preparation is not linked to the selected order.",
        );
      const refs: ExpectedAggregateRevision[] = [
        { kind: "order", id: order.orderId, revision: order.revision },
        {
          kind: "preparation",
          id: preparation.preparationId,
          revision: preparation.revision,
        },
      ];
      return refs.sort(compareRevisionRef);
    }
    case "order.split": {
      const source = requiredOrder(current, command.payload.sourceOrderId);
      const refs: ExpectedAggregateRevision[] = [
        { kind: "order", id: source.orderId, revision: source.revision },
        { kind: "order", id: command.payload.childOrderId, revision: 0 },
      ];
      if (source.preparationId) {
        const preparation = requiredPreparation(current, source.preparationId);
        refs.push({
          kind: "preparation",
          id: preparation.preparationId,
          revision: preparation.revision,
        });
      }
      return refs.sort(compareRevisionRef);
    }
    case "order.checked-out": {
      const order = requiredOrder(current, command.payload.orderId);
      const refs: ExpectedAggregateRevision[] = [
        { kind: "order", id: order.orderId, revision: order.revision },
        { kind: "sale", id: command.payload.saleId, revision: 0 },
      ];
      if (order.preparationId) {
        const preparation = requiredPreparation(current, order.preparationId);
        refs.push({
          kind: "preparation",
          id: preparation.preparationId,
          revision: preparation.revision,
        });
      }
      return refs.sort(compareRevisionRef);
    }
    case "sale.refunded": {
      const sale = requiredSale(current, command.payload.saleId);
      return [{ kind: "sale", id: sale.saleId, revision: sale.revision }];
    }
    default:
      return assertNever(command);
  }
}

function assertExpectedSet(
  supplied: readonly ExpectedAggregateRevision[],
  required: readonly ExpectedAggregateRevision[],
): void {
  if (
    supplied.length !== required.length ||
    supplied.some((entry, index) => {
      const expected = required[index];
      return entry.kind !== expected?.kind || entry.id !== expected.id;
    })
  )
    throw new PosOperationError(
      "OPERATION_AGGREGATE_SET_MISMATCH",
      "Command must guard exactly the aggregates touched by this action.",
    );
}

function aggregateRevision(
  state: PosOperationsState,
  kind: OperationAggregateKind,
  id: string,
): number {
  if (kind === "order")
    return findById(state.orders, id, "orderId")?.revision ?? 0;
  if (kind === "preparation")
    return findById(state.preparations, id, "preparationId")?.revision ?? 0;
  return findById(state.sales, id, "saleId")?.revision ?? 0;
}

function requiredOrder(
  state: PosOperationsState,
  id: string,
): PosOperationOrder {
  const found = findById(state.orders, id, "orderId");
  if (!found)
    throw new PosOperationError("ORDER_NOT_FOUND", "Order does not exist.");
  return found;
}

function requiredPreparation(
  state: PosOperationsState,
  id: string,
): PosOperationPreparation {
  const found = findById(state.preparations, id, "preparationId");
  if (!found)
    throw new PosOperationError(
      "PREPARATION_NOT_FOUND",
      "Preparation ticket does not exist.",
    );
  return found;
}

function requiredSale(state: PosOperationsState, id: string): PosOperationSale {
  const found = findById(state.sales, id, "saleId");
  if (!found)
    throw new PosOperationError("SALE_NOT_FOUND", "Sale does not exist.");
  return found;
}

function requireOrderPreparationLink(
  order: PosOperationOrder,
  preparation: PosOperationPreparation,
): void {
  if (
    order.preparationId !== preparation.preparationId ||
    !preparation.linkedOrderIds.includes(order.orderId)
  )
    throw new PosOperationError(
      "PREPARATION_LINK_MISMATCH",
      "Preparation is not linked to the selected order.",
    );
}

function requireOpenOrder(order: PosOperationOrder): void {
  if (order.status !== "open")
    throw new PosOperationError(
      "ORDER_NOT_OPEN",
      "Only an open order can be changed.",
    );
}

function validateOrderMoney(order: PosOperationOrder): void {
  const subtotal = lineSubtotal(order.lines);
  if (subtotal !== null && discountTotal(order.discounts) > subtotal)
    throw new RangeError(
      "order discount cannot exceed its captured line subtotal.",
    );
}

function lineSubtotal(lines: readonly PosOperationLine[]): number | null {
  if (lines.some((line) => line.lineTotalCents === null)) return null;
  const total = lines.reduce(
    (sum, line) => sum + (line.lineTotalCents as number),
    0,
  );
  if (!Number.isSafeInteger(total))
    throw new RangeError("order subtotal exceeds safe integer cents.");
  return total;
}

function discountTotal(discounts: readonly PosDiscountEntry[]): number {
  return sumSafe(
    discounts.map((discount) => discount.allocatedCents),
    "order discount",
  );
}

function sumSafe(values: readonly number[], label: string): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total))
    throw new RangeError(`${label} exceeds safe integer cents.`);
  return total;
}

function historyEvent(
  command: PosOperationCommand,
): PosOperationOrder["history"][number] {
  return {
    commandId: command.commandId,
    action: command.action,
    actorId: command.actorId,
    occurredAt: command.occurredAt,
    reason: command.reason,
  };
}

function findById<T extends object>(
  entries: readonly T[],
  id: string,
  key: keyof T,
): T | undefined {
  return entries.find(
    (entry) => (entry as Record<keyof T, unknown>)[key] === id,
  );
}

function replaceById<T extends object>(
  entries: readonly T[],
  replacement: T,
  key: keyof T,
): T[] {
  return sortedById(
    entries.map((entry) =>
      (entry as Record<keyof T, unknown>)[key] ===
      (replacement as Record<keyof T, unknown>)[key]
        ? replacement
        : entry,
    ),
    key,
  );
}

function sortedById<T extends object>(
  entries: readonly T[],
  key: keyof T,
): T[] {
  return [...entries].sort((left, right) =>
    compareId(
      String((left as Record<keyof T, unknown>)[key]),
      String((right as Record<keyof T, unknown>)[key]),
    ),
  );
}

function stableJson(value: unknown): string {
  const sort = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(sort)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.keys(item as object)
              .sort(compareId)
              .map((key) => [
                key,
                sort((item as Record<string, unknown>)[key]),
              ]),
          )
        : item;
  return JSON.stringify(sort(value));
}
