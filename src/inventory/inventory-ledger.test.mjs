import test from "node:test";
import assert from "node:assert/strict";
import {
  archiveInventoryItem,
  applyInventoryMovement,
  applyInventoryThreshold,
  createInitialInventoryState,
  createInventoryItem,
  editInventoryItem,
  formatBaseUnits,
  inventorySummary,
  quantityToBaseUnits,
  validateInventoryState,
} from "./inventory-ledger.mjs";

const seed = [
  {
    id: "beans",
    name: "Café en grano",
    kind: "Ingrediente",
    qty: 6.5,
    unit: "kg",
    min: 3,
  },
  {
    id: "milk",
    name: "Leche entera",
    kind: "Ingrediente",
    qty: 18,
    unit: "L",
    min: 10,
  },
  { id: "cups", name: "Vasos", kind: "Insumo", qty: 24, unit: "pz", min: 12 },
];

const initial = () =>
  createInitialInventoryState(seed, "2026-09-30T12:00:00.000Z");
const actor = {
  actorId: "owner-1",
  actorName: "Marcela Ortiz",
  occurredAt: "2026-09-30T12:05:00.000Z",
  reason: "Conteo y movimiento de prueba.",
};

test("creates one explicit unverified opening entry and converts kg/L/pz to integer base units", () => {
  const state = initial();
  assert.equal(state.entries.length, seed.length);
  assert.deepEqual(
    state.items.map((item) => item.baseUnit),
    ["g", "ml", "pz"],
  );
  assert.deepEqual(
    inventorySummary(state).map((item) => item.stockBaseUnits),
    [6500, 18000, 24],
  );
  assert.deepEqual(
    inventorySummary(state).map((item) => item.lowThresholdBaseUnits),
    [3000, 10000, 12],
  );
  assert.ok(
    state.entries.every(
      (entry) =>
        entry.kind === "opening" &&
        entry.syncStatus === "unverified" &&
        entry.provenance === "synthetic-seed-unverified",
    ),
  );
  assert.ok(state.entries.every((entry) => entry.reason.includes("sintético")));
  assert.equal(formatBaseUnits(6500, "kg"), "6.5 kg");
  assert.equal(formatBaseUnits(18000, "L"), "18 L");
  assert.equal(formatBaseUnits(24, "pz"), "24 pz");
});

test("converts exact decimal kg and litres but rejects fractional base units and fractional pieces", () => {
  assert.equal(quantityToBaseUnits("0.001", "kg", "g"), 1);
  assert.equal(quantityToBaseUnits("0.125", "L", "ml"), 125);
  assert.equal(quantityToBaseUnits("2.0", "pz", "pz"), 2);
  assert.throws(
    () => quantityToBaseUnits("0.0001", "kg", "g"),
    /at most three decimal places/,
  );
  assert.throws(
    () => quantityToBaseUnits("1.5", "pz", "pz"),
    /smaller than the supported base unit/,
  );
  assert.throws(
    () => quantityToBaseUnits("1.01", "g", "g"),
    /smaller than the supported base unit/,
  );
  assert.throws(
    () => quantityToBaseUnits("9007199254740992", "kg", "g"),
    /safe integer range/,
  );
  assert.throws(() => quantityToBaseUnits("2", "L", "g"), /not compatible/);
});

test("appends entries, waste, and signed adjustments while deriving stock from immutable history", () => {
  const original = initial();
  const entryCommand = {
    ...actor,
    commandId: "entry-1",
    itemId: "beans",
    kind: "entry",
    quantityText: "1.25",
    unit: "kg",
    expectedRevision: 0,
  };
  const entered = applyInventoryMovement(original, entryCommand);
  assert.equal(
    inventorySummary(entered.state).find((item) => item.itemId === "beans")
      .stockBaseUnits,
    7750,
  );
  assert.deepEqual(
    original.entries.map((event) => event.commandId),
    initial().entries.map((event) => event.commandId),
  );

  const wasted = applyInventoryMovement(entered.state, {
    ...actor,
    commandId: "waste-1",
    itemId: "milk",
    kind: "waste",
    quantityText: "0.5",
    unit: "L",
    expectedRevision: 0,
  });
  assert.equal(
    inventorySummary(wasted.state).find((item) => item.itemId === "milk")
      .stockBaseUnits,
    17500,
  );
  const adjusted = applyInventoryMovement(wasted.state, {
    ...actor,
    commandId: "adjust-1",
    itemId: "beans",
    kind: "adjustment",
    quantityText: "-0.25",
    unit: "kg",
    expectedRevision: 1,
  });
  assert.equal(
    inventorySummary(adjusted.state).find((item) => item.itemId === "beans")
      .stockBaseUnits,
    7500,
  );
  assert.equal(adjusted.entry.deltaBaseUnits, -250);
  assert.equal(adjusted.entry.quantityBaseUnits, 250);
  assert.equal(adjusted.entry.actorName, actor.actorName);
  assert.equal(adjusted.entry.reason, actor.reason);
  assert.equal(adjusted.entry.syncStatus, "pending");
  assert.equal(adjusted.state.revision, 3);
});

test("requires explicit signed nonzero adjustments and prevents negative or unsafe stock totals", () => {
  const state = initial();
  assert.throws(
    () =>
      applyInventoryMovement(state, {
        ...actor,
        commandId: "adjust-1",
        itemId: "beans",
        kind: "adjustment",
        quantityText: "1",
        unit: "kg",
        expectedRevision: 0,
      }),
    /signed decimal delta/,
  );
  assert.throws(
    () =>
      applyInventoryMovement(state, {
        ...actor,
        commandId: "adjust-2",
        itemId: "beans",
        kind: "adjustment",
        quantityText: "+0",
        unit: "kg",
        expectedRevision: 0,
      }),
    /greater than zero/,
  );
  assert.throws(
    () =>
      applyInventoryMovement(state, {
        ...actor,
        commandId: "waste-1",
        itemId: "beans",
        kind: "waste",
        quantityText: "7",
        unit: "kg",
        expectedRevision: 0,
      }),
    /below zero/,
  );
  assert.throws(
    () =>
      applyInventoryMovement(state, {
        ...actor,
        commandId: "stale-1",
        itemId: "beans",
        kind: "entry",
        quantityText: "1",
        unit: "kg",
        expectedRevision: 1,
      }),
    /changed after this form opened/,
  );
});

test("supports audited low thresholds without changing stock and derives low-stock status from ledger balances", () => {
  const state = initial();
  const result = applyInventoryThreshold(state, {
    ...actor,
    commandId: "threshold-1",
    itemId: "beans",
    kind: "threshold",
    quantityText: "7",
    unit: "kg",
    expectedRevision: 0,
  });
  const summary = inventorySummary(result.state).find(
    (item) => item.itemId === "beans",
  );
  assert.equal(summary.stockBaseUnits, 6500);
  assert.equal(summary.lowThresholdBaseUnits, 7000);
  assert.equal(summary.low, true);
  assert.equal(result.entry.kind, "threshold");
  assert.equal(result.entry.deltaBaseUnits, 0);
  assert.equal(result.state.revision, 1);
});

test("retries identical command ids once and rejects changed payloads or stale source revisions", () => {
  const state = initial();
  const command = {
    ...actor,
    commandId: "entry-1",
    itemId: "beans",
    kind: "entry",
    quantityText: "1",
    unit: "kg",
    expectedRevision: 0,
  };
  const first = applyInventoryMovement(state, command);
  const retry = applyInventoryMovement(first.state, command);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.changed, false);
  assert.equal(
    retry.state.entries.filter((event) => event.commandId === command.commandId)
      .length,
    1,
  );
  assert.throws(
    () =>
      applyInventoryMovement(first.state, { ...command, quantityText: "2" }),
    /already used for different content/,
  );
  assert.throws(
    () =>
      applyInventoryMovement(first.state, {
        ...command,
        commandId: "entry-2",
        expectedRevision: 0,
      }),
    /changed after this form opened/,
  );
});

test("records threshold changes in immutable revisions and rejects malformed persisted ledgers", () => {
  const first = initial();
  const changed = applyInventoryThreshold(first, {
    ...actor,
    commandId: "threshold-1",
    itemId: "beans",
    kind: "threshold",
    quantityText: "0",
    unit: "kg",
    expectedRevision: 0,
  });
  assert.equal(
    first.items.find((item) => item.itemId === "beans").lowThresholdBaseUnits,
    3000,
  );
  assert.equal(
    changed.state.items.find((item) => item.itemId === "beans")
      .lowThresholdBaseUnits,
    0,
  );
  assert.equal(
    validateInventoryState(changed.state).entries.length,
    seed.length + 1,
  );
  const malformed = {
    ...changed.state,
    entries: changed.state.entries.slice(1),
  };
  assert.throws(
    () => validateInventoryState(malformed),
    /Inventory event revisions|explicit one-time synthetic balances/,
  );
});

test("retries an audited threshold change with its original before-value and rejects changed content", () => {
  const original = initial();
  const command = {
    ...actor,
    commandId: "threshold-retry-1",
    itemId: "beans",
    kind: "threshold",
    quantityText: "7",
    unit: "kg",
    expectedRevision: 0,
  };
  const changed = applyInventoryThreshold(original, command);
  const retried = applyInventoryThreshold(changed.state, command);
  assert.equal(retried.duplicate, true);
  assert.equal(retried.changed, false);
  assert.equal(retried.state.entries.length, changed.state.entries.length);
  assert.throws(
    () =>
      applyInventoryThreshold(changed.state, { ...command, quantityText: "8" }),
    /already used for different content/,
  );
});

test("rejects persisted audit text that disagrees with base quantities and rejects unknown stored fields", () => {
  const moved = applyInventoryMovement(initial(), {
    ...actor,
    commandId: "entry-audit-1",
    itemId: "beans",
    kind: "entry",
    quantityText: "1",
    unit: "kg",
    expectedRevision: 0,
  });
  const mismatchedText = {
    ...moved.state,
    entries: moved.state.entries.map((entry) =>
      entry.commandId === "entry-audit-1"
        ? { ...entry, quantityText: "2" }
        : entry,
    ),
  };
  assert.throws(
    () => validateInventoryState(mismatchedText),
    /audit text does not match/,
  );
  const unsupportedField = {
    ...moved.state,
    extraFromStorage: { claimed: true },
  };
  assert.throws(
    () => validateInventoryState(unsupportedField),
    /unsupported fields/,
  );
  const forgedEvent = {
    ...moved.state,
    entries: moved.state.entries.map((entry) =>
      entry.commandId === "entry-audit-1"
        ? { ...entry, source: "untrusted" }
        : entry,
    ),
  };
  assert.throws(
    () => validateInventoryState(forgedEvent),
    /unsupported fields/,
  );
});

test("rejects oversized quantities before decimal conversion", () => {
  assert.throws(
    () => quantityToBaseUnits("9".repeat(33), "kg", "g"),
    /at most 32 characters/,
  );
});

test("keeps untouched v1 ledgers backward compatible and records a real zero-or-positive opening for new catalog items", () => {
  const legacy = initial();
  const validatedLegacy = validateInventoryState(legacy);
  assert.deepEqual(Object.keys(validatedLegacy).sort(), [
    "entries",
    "items",
    "revision",
    "schemaVersion",
  ]);
  assert.equal(validatedLegacy.catalogEvents, undefined);

  const createSyrup = {
    ...actor,
    commandId: "catalog-create-syrup",
    kind: "create",
    itemId: "syrup",
    name: "Jarabe de vainilla",
    itemKind: "Ingrediente",
    displayUnit: "kg",
    openingQuantityText: "1.25",
    thresholdText: "0",
    expectedCatalogRevision: 0,
  };
  const created = createInventoryItem(legacy, createSyrup);
  const syrup = created.state.items.find((item) => item.itemId === "syrup");
  const opening = created.state.entries.find(
    (entry) => entry.itemId === "syrup",
  );
  assert.equal(syrup.provenance, "operator-count");
  assert.equal(opening.provenance, "operator-count");
  assert.equal(opening.actorId, actor.actorId);
  assert.equal(opening.syncStatus, "pending");
  assert.equal(opening.quantityBaseUnits, 1250);
  assert.equal(created.state.catalogEvents[0].kind, "create");
  assert.equal(created.state.revision, 1);
  assert.equal(
    inventorySummary(created.state).find((item) => item.itemId === "syrup")
      .stockBaseUnits,
    1250,
  );
  const retry = createInventoryItem(created.state, createSyrup);
  assert.equal(retry.duplicate, true);
  assert.equal(
    retry.state.entries.filter((entry) => entry.itemId === "syrup").length,
    1,
  );
  assert.throws(
    () =>
      createInventoryItem(created.state, {
        ...createSyrup,
        openingQuantityText: "1.5",
      }),
    /different content/,
  );

  const empty = createInventoryItem(created.state, {
    ...actor,
    commandId: "catalog-create-empty",
    kind: "create",
    itemId: "empty-cups",
    name: "Vaso nuevo",
    itemKind: "Insumo",
    displayUnit: "pz",
    openingQuantityText: "0",
    thresholdText: "0",
    expectedCatalogRevision: 1,
  });
  assert.equal(empty.opening.quantityBaseUnits, 0);
  assert.equal(empty.opening.deltaBaseUnits, 0);
  assert.equal(empty.opening.actorId, actor.actorId);
  assert.equal(empty.state.catalogRevision, 2);
  assert.throws(
    () =>
      validateInventoryState({
        ...empty.state,
        catalogEvents: empty.state.catalogEvents.map((event, index) =>
          index ? event : { ...event, unexpected: "stored data" },
        ),
      }),
    /unsupported fields/,
  );
});

test("edits catalog names and display units without changing the base unit or rewriting prior entries", () => {
  const original = initial();
  const legacyOpening = original.entries.find(
    (entry) => entry.itemId === "beans",
  );
  const command = {
    ...actor,
    commandId: "catalog-edit-beans",
    kind: "edit",
    itemId: "beans",
    name: "Café de origen",
    itemKind: "Ingrediente",
    displayUnit: "g",
    expectedCatalogRevision: 0,
    expectedItemCatalogRevision: 0,
  };
  const edited = editInventoryItem(original, command);
  const beans = edited.state.items.find((item) => item.itemId === "beans");
  assert.equal(beans.name, "Café de origen");
  assert.equal(beans.baseUnit, "g");
  assert.equal(beans.displayUnit, "g");
  assert.equal(
    edited.state.entries[0].quantityText,
    legacyOpening.quantityText,
  );
  assert.equal(edited.state.entries[0].unitSnapshot, "kg");
  assert.equal(edited.event.before.name, "Café en grano");
  assert.equal(edited.event.after.name, "Café de origen");
  assert.equal(validateInventoryState(edited.state).catalogEvents.length, 1);
  assert.equal(editInventoryItem(edited.state, command).duplicate, true);
  assert.throws(
    () => editInventoryItem(edited.state, { ...command, displayUnit: "L" }),
    /separate stock migration/,
  );
  const movement = applyInventoryMovement(edited.state, {
    ...actor,
    commandId: "post-edit-entry",
    itemId: "beans",
    kind: "entry",
    quantityText: "250",
    unit: "g",
    itemNameSnapshot: "Café de origen",
    itemKindSnapshot: "Ingrediente",
    expectedRevision: 0,
  });
  assert.equal(movement.entry.itemNameSnapshot, "Café de origen");
  assert.equal(movement.entry.unitSnapshot, "g");
  assert.equal(movement.state.entries[0].unitSnapshot, "kg");
});

test("archives only zero-stock items, retains all history, and makes archive retries idempotent", () => {
  const original = initial();
  const added = applyInventoryMovement(original, {
    ...actor,
    commandId: "beans-count-down",
    itemId: "beans",
    kind: "waste",
    quantityText: "6.5",
    unit: "kg",
    expectedRevision: 0,
  });
  assert.equal(
    inventorySummary(added.state).find((item) => item.itemId === "beans")
      .stockBaseUnits,
    0,
  );
  const command = {
    ...actor,
    commandId: "archive-beans",
    kind: "archive",
    itemId: "beans",
    expectedCatalogRevision: 0,
    expectedItemCatalogRevision: 0,
  };
  const archived = archiveInventoryItem(added.state, command);
  assert.equal(
    archived.state.items.find((item) => item.itemId === "beans").archived,
    true,
  );
  assert.equal(
    inventorySummary(archived.state).find((item) => item.itemId === "beans")
      .stockBaseUnits,
    0,
  );
  assert.equal(archived.state.entries.length, original.entries.length + 1);
  assert.equal(archived.state.catalogEvents.length, 1);
  assert.equal(archiveInventoryItem(archived.state, command).duplicate, true);
  assert.throws(
    () =>
      applyInventoryMovement(archived.state, {
        ...actor,
        commandId: "late-beans-entry",
        itemId: "beans",
        kind: "entry",
        quantityText: "1",
        unit: "kg",
        expectedRevision: 1,
      }),
    /Archived inventory items/,
  );

  const inStock = initial();
  assert.throws(
    () =>
      archiveInventoryItem(inStock, { ...command, expectedCatalogRevision: 0 }),
    /still has stock/,
  );
});
