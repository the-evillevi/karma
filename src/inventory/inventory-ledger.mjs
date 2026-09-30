const BASE_UNITS = new Set(["g", "ml", "pz"]);
const ITEM_TYPES = new Set(["Ingrediente", "Insumo", "Producto terminado"]);
const ENTRY_KINDS = new Set([
  "opening",
  "entry",
  "waste",
  "adjustment",
  "threshold",
]);
const CATALOG_EVENT_KINDS = new Set(["create", "edit", "archive"]);
const EVENT_FIELDS = [
  "movementId",
  "commandId",
  "itemId",
  "kind",
  "quantityBaseUnits",
  "deltaBaseUnits",
  "unitSnapshot",
  "quantityText",
  "actorId",
  "actorName",
  "occurredAt",
  "reason",
  "sourceRevision",
  "itemRevision",
  "syncStatus",
  "thresholdBeforeBaseUnits",
  "thresholdBaseUnits",
  "thresholdText",
  "provenance",
  "itemNameSnapshot",
  "itemKindSnapshot",
];

export class InventoryLedgerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "InventoryLedgerError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new InventoryLedgerError(code, message);
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertExactFields(value, required, label) {
  const keys = Object.keys(value);
  if (
    keys.length !== required.length ||
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) {
    fail("invalid_state", `${label} has missing or unsupported fields.`);
  }
}

function assertAllowedFields(value, required, optional, label) {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    keys.some((key) => !allowed.has(key))
  ) {
    fail("invalid_state", `${label} has missing or unsupported fields.`);
  }
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function baseUnitForDisplay(displayUnit) {
  return displayUnit === "kg" ? "g" : displayUnit === "L" ? "ml" : displayUnit;
}

function inventoryMetadataSnapshot(item) {
  return {
    itemId: item.itemId,
    name: item.name,
    kind: item.kind,
    baseUnit: item.baseUnit,
    displayUnit: item.displayUnit,
    lowThresholdBaseUnits: item.lowThresholdBaseUnits,
    archived: item.archived === true,
    provenance: item.provenance,
  };
}

function sameRecord(a, b) {
  if (!isRecord(a) || !isRecord(b)) return false;
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key, index) => key === bKeys[index] && a[key] === b[key])
  );
}

const CATALOG_SNAPSHOT_FIELDS = [
  "itemId",
  "name",
  "kind",
  "baseUnit",
  "displayUnit",
  "lowThresholdBaseUnits",
  "archived",
  "provenance",
];

function validateCatalogSnapshot(snapshot, itemId) {
  if (!isRecord(snapshot))
    fail("invalid_state", "Saved inventory catalog snapshot is invalid.");
  assertExactFields(snapshot, CATALOG_SNAPSHOT_FIELDS, "Catalog snapshot");
  assertText(snapshot.itemId, "Catalog item id", 100);
  assertText(snapshot.name, "Catalog item name", 120);
  if (
    snapshot.itemId !== itemId ||
    !ITEM_TYPES.has(snapshot.kind) ||
    !BASE_UNITS.has(snapshot.baseUnit) ||
    !Number.isSafeInteger(snapshot.lowThresholdBaseUnits) ||
    snapshot.lowThresholdBaseUnits < 0 ||
    typeof snapshot.archived !== "boolean" ||
    !["synthetic-seed-unverified", "operator-count"].includes(
      snapshot.provenance,
    )
  )
    fail("invalid_state", "Saved inventory catalog snapshot is invalid.");
  unitFactor(snapshot.displayUnit, snapshot.baseUnit);
}

function assertText(value, label, maxLength = 160) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maxLength
  ) {
    fail(
      "invalid_record",
      `${label} must be a non-empty string of at most ${maxLength} characters`,
    );
  }
  return value.trim();
}

function unitFactor(unit, baseUnit) {
  if (baseUnit === "g" && unit === "g") return 1;
  if (baseUnit === "g" && unit === "kg") return 1000;
  if (baseUnit === "ml" && unit === "ml") return 1;
  if (baseUnit === "ml" && unit === "L") return 1000;
  if (baseUnit === "pz" && unit === "pz") return 1;
  fail(
    "unit_mismatch",
    `unit ${unit} is not compatible with base unit ${baseUnit}`,
  );
}

/** Parse a decimal exactly into integer grams, millilitres, or pieces. */
export function quantityToBaseUnits(
  value,
  unit,
  baseUnit,
  { signed = false, allowZero = false } = {},
) {
  const text =
    typeof value === "string" || typeof value === "number"
      ? String(value).trim()
      : "";
  if (text.length > 32)
    fail("invalid_quantity", "Quantity must be at most 32 characters.");
  const pattern = signed
    ? /^([+-])(\d+)(?:\.(\d{1,3}))?$/
    : /^(\d+)(?:\.(\d{1,3}))?$/;
  const match = pattern.exec(text);
  if (!match)
    fail(
      "invalid_quantity",
      signed
        ? "Use a signed decimal delta with at most three decimal places."
        : "Use a positive decimal quantity with at most three decimal places.",
    );
  const sign = signed ? (match[1] === "-" ? -1 : 1) : 1;
  const integerPart = signed ? match[2] : match[1];
  const fractionPart = (signed ? match[3] : match[2]) || "";
  const factor = BigInt(unitFactor(unit, baseUnit));
  const denominator = 10n ** BigInt(fractionPart.length);
  const numerator =
    (BigInt(integerPart) * denominator + BigInt(fractionPart || "0")) * factor;
  if (numerator % denominator !== 0n)
    fail(
      "fractional_base_unit",
      "Quantity is smaller than the supported base unit.",
    );
  const magnitude = Number(numerator / denominator);
  if (!Number.isSafeInteger(magnitude))
    fail("unsafe_quantity", "Quantity exceeds the safe integer range.");
  if (magnitude === 0 && !allowZero)
    fail("invalid_quantity", "Quantity must be greater than zero.");
  return magnitude * sign;
}

export function formatBaseUnits(quantityBaseUnits, unit) {
  if (!Number.isSafeInteger(quantityBaseUnits))
    fail("unsafe_quantity", "Quantity exceeds the safe integer range.");
  const baseUnit = unit === "kg" ? "g" : unit === "L" ? "ml" : unit;
  const factor = unitFactor(unit, baseUnit);
  const sign = quantityBaseUnits < 0 ? "-" : "";
  const magnitude = Math.abs(quantityBaseUnits);
  const whole = Math.floor(magnitude / factor);
  const remainder = magnitude % factor;
  const fraction =
    factor === 1000
      ? String(remainder).padStart(3, "0").replace(/0+$/, "")
      : "";
  return `${sign}${whole}${fraction ? "." + fraction : ""} ${unit}`;
}

function clonedState(state) {
  const copy = {
    schemaVersion: state.schemaVersion,
    revision: state.revision,
    items: state.items.map((item) => ({ ...item })),
    entries: state.entries.map((entry) => ({ ...entry })),
  };
  if (hasOwn(state, "catalogRevision"))
    copy.catalogRevision = state.catalogRevision;
  if (hasOwn(state, "catalogEvents")) {
    copy.catalogEvents = state.catalogEvents.map((event) => ({
      ...event,
      before: event.before ? { ...event.before } : null,
      after: event.after ? { ...event.after } : null,
    }));
  }
  return copy;
}

function itemById(state, itemId) {
  return state.items.find((item) => item.itemId === itemId);
}

/** Create one explicit, synthetic opening ledger entry per seed item. */
export function createInitialInventoryState(
  seedItems,
  occurredAt = new Date().toISOString(),
) {
  if (!Array.isArray(seedItems) || seedItems.length === 0)
    fail("invalid_seed", "Seed inventory must contain items.");
  if (!Number.isFinite(Date.parse(occurredAt)))
    fail("invalid_timestamp", "Opening timestamp is invalid.");
  const items = [];
  const entries = [];
  const seenIds = new Set();
  for (const seed of seedItems) {
    if (!isRecord(seed))
      fail("invalid_seed", "Each seed item must be a record.");
    const itemId = assertText(seed.id, "Seed item id", 100);
    if (seenIds.has(itemId))
      fail("invalid_seed", "Seed item ids must be unique.");
    seenIds.add(itemId);
    const displayUnit = assertText(seed.unit, "Seed display unit", 16);
    const baseUnit =
      displayUnit === "kg" ? "g" : displayUnit === "L" ? "ml" : displayUnit;
    if (!BASE_UNITS.has(baseUnit) || !ITEM_TYPES.has(seed.kind))
      fail("invalid_seed", "Seed item type or unit is unsupported.");
    const quantityText = String(seed.qty);
    const quantityBaseUnits = quantityToBaseUnits(
      quantityText,
      displayUnit,
      baseUnit,
      { allowZero: true },
    );
    const thresholdBaseUnits = quantityToBaseUnits(
      String(seed.min),
      displayUnit,
      baseUnit,
      { allowZero: true },
    );
    const name = assertText(seed.name, "Seed item name", 120);
    items.push({
      itemId,
      name,
      kind: seed.kind,
      baseUnit,
      displayUnit,
      lowThresholdBaseUnits: thresholdBaseUnits,
      revision: 0,
      provenance: "synthetic-seed-unverified",
    });
    const commandId = `inventory:opening:v1:${itemId}`;
    entries.push({
      movementId: `movement:${commandId}`,
      commandId,
      itemId,
      kind: "opening",
      quantityBaseUnits,
      deltaBaseUnits: quantityBaseUnits,
      unitSnapshot: displayUnit,
      quantityText,
      actorId: "system:seed",
      actorName: "Sistema · inventario semilla",
      occurredAt,
      reason:
        "Saldo inicial sintético de demostración; confirmar con conteo físico.",
      sourceRevision: 0,
      itemRevision: 0,
      syncStatus: "unverified",
      thresholdBaseUnits,
      thresholdText: String(seed.min),
      provenance: "synthetic-seed-unverified",
    });
  }
  return validateInventoryState({
    schemaVersion: 1,
    revision: 0,
    items,
    entries,
  });
}

/** Validate and copy persisted inventory data before it enters application state. */
export function validateInventoryState(state) {
  if (
    !isRecord(state) ||
    state.schemaVersion !== 1 ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0 ||
    !Array.isArray(state.items) ||
    !Array.isArray(state.entries)
  ) {
    fail("invalid_state", "Saved inventory ledger has an invalid shape.");
  }
  assertAllowedFields(
    state,
    ["schemaVersion", "revision", "items", "entries"],
    ["catalogRevision", "catalogEvents"],
    "Saved inventory ledger",
  );
  if (hasOwn(state, "catalogRevision") !== hasOwn(state, "catalogEvents"))
    fail("invalid_state", "Saved inventory catalog history is incomplete.");
  const catalogEvents = state.catalogEvents || [];
  const catalogRevision = state.catalogRevision ?? 0;
  if (
    !Array.isArray(catalogEvents) ||
    !Number.isSafeInteger(catalogRevision) ||
    catalogRevision < 0
  )
    fail("invalid_state", "Saved inventory catalog history is invalid.");
  const items = new Map();
  for (const item of state.items) {
    if (!isRecord(item))
      fail("invalid_state", "Saved inventory item must be a record.");
    assertAllowedFields(
      item,
      [
        "itemId",
        "name",
        "kind",
        "baseUnit",
        "displayUnit",
        "lowThresholdBaseUnits",
        "revision",
        "provenance",
      ],
      ["catalogRevision", "archived"],
      "Saved inventory item",
    );
    if (
      hasOwn(item, "catalogRevision") !== hasOwn(item, "archived") ||
      (hasOwn(item, "catalogRevision") &&
        (!Number.isSafeInteger(item.catalogRevision) ||
          item.catalogRevision < 0 ||
          typeof item.archived !== "boolean"))
    )
      fail(
        "invalid_state",
        "Saved inventory item catalog metadata is invalid.",
      );
    const itemId = assertText(item.itemId, "Inventory item id", 100);
    if (
      items.has(itemId) ||
      !ITEM_TYPES.has(item.kind) ||
      !BASE_UNITS.has(item.baseUnit)
    )
      fail(
        "invalid_state",
        "Saved inventory item identity, type, or base unit is invalid.",
      );
    const displayUnit = assertText(
      item.displayUnit,
      "Inventory display unit",
      16,
    );
    unitFactor(displayUnit, item.baseUnit);
    assertText(item.name, "Inventory item name", 120);
    if (
      !Number.isSafeInteger(item.lowThresholdBaseUnits) ||
      item.lowThresholdBaseUnits < 0 ||
      !Number.isSafeInteger(item.revision) ||
      item.revision < 0
    )
      fail(
        "invalid_state",
        "Saved inventory threshold or revision is invalid.",
      );
    if (
      !["synthetic-seed-unverified", "operator-count"].includes(item.provenance)
    )
      fail("invalid_state", "Inventory item provenance is invalid.");
    items.set(itemId, {
      revision: -1,
      stock: 0,
      threshold: null,
      opening: false,
      metadata: item,
    });
  }
  if (items.size === 0)
    fail("invalid_state", "Saved inventory ledger has no items.");
  const commandIds = new Set();
  const movementIds = new Set();
  const openingEntries = new Map();
  let operationCount = 0;
  for (const entry of state.entries) {
    if (!isRecord(entry) || !ENTRY_KINDS.has(entry.kind))
      fail("invalid_state", "Saved inventory event is invalid.");
    const fields = [
      "movementId",
      "commandId",
      "itemId",
      "kind",
      "quantityBaseUnits",
      "deltaBaseUnits",
      "unitSnapshot",
      "quantityText",
      "actorId",
      "actorName",
      "occurredAt",
      "reason",
      "sourceRevision",
      "itemRevision",
      "syncStatus",
    ];
    if (entry.kind === "opening")
      fields.push("thresholdBaseUnits", "thresholdText", "provenance");
    if (entry.kind === "threshold")
      fields.push("thresholdBeforeBaseUnits", "thresholdBaseUnits");
    const hasNameSnapshot = hasOwn(entry, "itemNameSnapshot");
    const hasKindSnapshot = hasOwn(entry, "itemKindSnapshot");
    if (hasNameSnapshot !== hasKindSnapshot)
      fail("invalid_state", "Inventory event item snapshot is incomplete.");
    if (hasNameSnapshot) fields.push("itemNameSnapshot", "itemKindSnapshot");
    assertExactFields(entry, fields, "Saved inventory event");
    const itemId = assertText(entry.itemId, "Inventory event item id", 100);
    const current = items.get(itemId);
    if (!current)
      fail(
        "invalid_state",
        "Saved inventory event references an unknown item.",
      );
    const commandId = assertText(entry.commandId, "Inventory command id", 180);
    const movementId = assertText(
      entry.movementId,
      "Inventory movement id",
      200,
    );
    if (commandIds.has(commandId) || movementIds.has(movementId))
      fail(
        "invalid_state",
        "Saved inventory command identities must be unique.",
      );
    commandIds.add(commandId);
    movementIds.add(movementId);
    assertText(entry.actorId, "Inventory actor id", 100);
    assertText(entry.actorName, "Inventory actor name", 120);
    assertText(entry.reason, "Inventory reason", 250);
    if (
      typeof entry.quantityText !== "string" ||
      entry.quantityText.length > 32 ||
      !Number.isFinite(Date.parse(entry.occurredAt))
    )
      fail(
        "invalid_state",
        "Saved inventory quantity text or timestamp is invalid.",
      );
    if (
      hasNameSnapshot &&
      (typeof entry.itemNameSnapshot !== "string" ||
        !entry.itemNameSnapshot.trim() ||
        entry.itemNameSnapshot.length > 120 ||
        !ITEM_TYPES.has(entry.itemKindSnapshot))
    )
      fail("invalid_state", "Saved inventory event item snapshot is invalid.");
    if (
      entry.kind === "opening" &&
      (typeof entry.thresholdText !== "string" ||
        entry.thresholdText.length > 32)
    )
      fail("invalid_state", "Saved inventory threshold text is invalid.");
    unitFactor(entry.unitSnapshot, current.metadata.baseUnit);
    if (
      !Number.isSafeInteger(entry.quantityBaseUnits) ||
      entry.quantityBaseUnits < 0 ||
      !Number.isSafeInteger(entry.deltaBaseUnits) ||
      !Number.isSafeInteger(entry.sourceRevision) ||
      entry.sourceRevision < 0 ||
      !Number.isSafeInteger(entry.itemRevision) ||
      entry.itemRevision < 0
    )
      fail(
        "invalid_state",
        "Saved inventory event quantity or revision is invalid.",
      );
    const expectedSyncStatus =
      entry.kind === "opening" &&
      entry.provenance === "synthetic-seed-unverified"
        ? "unverified"
        : "pending";
    if (entry.syncStatus !== expectedSyncStatus)
      fail("invalid_state", "Saved inventory sync status is invalid.");

    if (entry.kind === "opening") {
      const syntheticOpening =
        entry.provenance === "synthetic-seed-unverified" &&
        current.metadata.provenance === "synthetic-seed-unverified" &&
        commandId === `inventory:opening:v1:${itemId}`;
      const operatorOpening =
        entry.provenance === "operator-count" &&
        current.metadata.provenance === "operator-count" &&
        commandId !== `inventory:opening:v1:${itemId}`;
      if (
        current.opening ||
        current.revision !== -1 ||
        entry.sourceRevision !== 0 ||
        entry.itemRevision !== 0 ||
        entry.quantityBaseUnits !== entry.deltaBaseUnits ||
        entry.deltaBaseUnits < 0 ||
        !Number.isSafeInteger(entry.thresholdBaseUnits) ||
        entry.thresholdBaseUnits < 0 ||
        (!syntheticOpening && !operatorOpening) ||
        (operatorOpening && !hasNameSnapshot)
      ) {
        fail(
          "invalid_state",
          "Inventory opening entries must be explicit one-time synthetic balances.",
        );
      }
      try {
        if (
          quantityToBaseUnits(
            entry.quantityText,
            entry.unitSnapshot,
            current.metadata.baseUnit,
            { allowZero: true },
          ) !== entry.quantityBaseUnits ||
          quantityToBaseUnits(
            entry.thresholdText,
            entry.unitSnapshot,
            current.metadata.baseUnit,
            { allowZero: true },
          ) !== entry.thresholdBaseUnits
        ) {
          fail(
            "invalid_state",
            "Inventory opening audit text does not match its numeric quantities.",
          );
        }
      } catch (error) {
        if (
          error instanceof InventoryLedgerError &&
          error.code === "invalid_state"
        )
          throw error;
        fail(
          "invalid_state",
          "Inventory opening audit text does not match its numeric quantities.",
        );
      }
      current.opening = true;
      current.revision = 0;
      current.stock = entry.deltaBaseUnits;
      current.threshold = entry.thresholdBaseUnits;
      openingEntries.set(itemId, entry);
      continue;
    }

    operationCount += 1;
    if (
      !current.opening ||
      entry.sourceRevision !== current.revision ||
      entry.itemRevision !== current.revision + 1
    ) {
      fail(
        "invalid_state",
        "Inventory event revisions are not a contiguous history.",
      );
    }
    if (entry.kind === "threshold") {
      if (
        entry.quantityBaseUnits !== 0 ||
        entry.deltaBaseUnits !== 0 ||
        !Number.isSafeInteger(entry.thresholdBaseUnits) ||
        entry.thresholdBaseUnits < 0 ||
        entry.thresholdBeforeBaseUnits !== current.threshold
      )
        fail("invalid_state", "Inventory threshold history is invalid.");
      try {
        if (
          quantityToBaseUnits(
            entry.quantityText,
            entry.unitSnapshot,
            current.metadata.baseUnit,
            { allowZero: true },
          ) !== entry.thresholdBaseUnits
        ) {
          fail(
            "invalid_state",
            "Inventory threshold audit text does not match its numeric quantity.",
          );
        }
      } catch (error) {
        if (
          error instanceof InventoryLedgerError &&
          error.code === "invalid_state"
        )
          throw error;
        fail(
          "invalid_state",
          "Inventory threshold audit text does not match its numeric quantity.",
        );
      }
      current.threshold = entry.thresholdBaseUnits;
    } else {
      if (
        entry.quantityBaseUnits <= 0 ||
        (entry.kind === "entry" &&
          entry.deltaBaseUnits !== entry.quantityBaseUnits) ||
        (entry.kind === "waste" &&
          entry.deltaBaseUnits !== -entry.quantityBaseUnits) ||
        (entry.kind === "adjustment" &&
          (entry.deltaBaseUnits === 0 ||
            Math.abs(entry.deltaBaseUnits) !== entry.quantityBaseUnits))
      ) {
        fail(
          "invalid_state",
          "Inventory movement sign or quantity is invalid.",
        );
      }
      try {
        const parsedQuantity = quantityToBaseUnits(
          entry.quantityText,
          entry.unitSnapshot,
          current.metadata.baseUnit,
          { signed: entry.kind === "adjustment" },
        );
        if (
          entry.kind === "adjustment"
            ? parsedQuantity !== entry.deltaBaseUnits
            : parsedQuantity !== entry.quantityBaseUnits
        ) {
          fail(
            "invalid_state",
            "Inventory movement audit text does not match its numeric quantity.",
          );
        }
      } catch (error) {
        if (
          error instanceof InventoryLedgerError &&
          error.code === "invalid_state"
        )
          throw error;
        fail(
          "invalid_state",
          "Inventory movement audit text does not match its numeric quantity.",
        );
      }
      current.stock += entry.deltaBaseUnits;
      if (!Number.isSafeInteger(current.stock) || current.stock < 0)
        fail(
          "invalid_state",
          "Inventory history produces an invalid negative or unsafe balance.",
        );
    }
    current.revision = entry.itemRevision;
  }
  if (catalogEvents.length !== catalogRevision)
    fail(
      "invalid_state",
      "Inventory catalog revision does not match its history.",
    );
  const catalogCommands = new Set();
  const catalogEventIds = new Set();
  const catalogByItem = new Map();
  const lastCatalogRevisionByItem = new Map();
  catalogEvents.forEach((event, index) => {
    if (!isRecord(event) || !CATALOG_EVENT_KINDS.has(event.kind))
      fail("invalid_state", "Saved inventory catalog event is invalid.");
    assertExactFields(
      event,
      [
        "catalogEventId",
        "commandId",
        "itemId",
        "kind",
        "actorId",
        "actorName",
        "occurredAt",
        "reason",
        "sourceRevision",
        "itemRevision",
        "before",
        "after",
        "syncStatus",
      ],
      "Saved inventory catalog event",
    );
    const itemId = assertText(event.itemId, "Catalog event item id", 100);
    const current = items.get(itemId);
    if (!current)
      fail("invalid_state", "Catalog event references an unknown item.");
    const commandId = assertText(event.commandId, "Catalog command id", 180);
    const catalogEventId = assertText(
      event.catalogEventId,
      "Catalog event id",
      200,
    );
    if (
      catalogCommands.has(commandId) ||
      commandIds.has(commandId) ||
      catalogEventIds.has(catalogEventId) ||
      catalogEventId !== `catalog:${commandId}`
    )
      fail(
        "invalid_state",
        "Catalog event identities are invalid or duplicated.",
      );
    catalogCommands.add(commandId);
    catalogEventIds.add(catalogEventId);
    assertText(event.actorId, "Catalog actor id", 100);
    assertText(event.actorName, "Catalog actor name", 120);
    assertText(event.reason, "Catalog event reason", 250);
    if (
      !Number.isFinite(Date.parse(event.occurredAt)) ||
      event.sourceRevision !== index ||
      event.itemRevision !== index + 1 ||
      event.syncStatus !== "pending"
    )
      fail(
        "invalid_state",
        "Inventory catalog event revision or audit is invalid.",
      );
    validateCatalogSnapshot(event.after, itemId);
    if (event.kind === "create") {
      if (
        event.before !== null ||
        catalogByItem.has(itemId) ||
        event.after.archived ||
        event.after.provenance !== "operator-count"
      )
        fail("invalid_state", "Inventory item creation history is invalid.");
      const opening = openingEntries.get(itemId);
      if (
        !opening ||
        opening.provenance !== "operator-count" ||
        opening.itemNameSnapshot !== event.after.name ||
        opening.itemKindSnapshot !== event.after.kind ||
        opening.unitSnapshot !== event.after.displayUnit ||
        opening.thresholdBaseUnits !== event.after.lowThresholdBaseUnits
      )
        fail(
          "invalid_state",
          "Created items require a matching operator opening count.",
        );
    } else {
      validateCatalogSnapshot(event.before, itemId);
      const previous = catalogByItem.get(itemId);
      if (previous && !sameRecord(previous, event.before))
        fail("invalid_state", "Inventory catalog history is not continuous.");
      if (!previous && event.before.provenance !== current.metadata.provenance)
        fail("invalid_state", "Legacy catalog history provenance is invalid.");
      if (event.kind === "edit") {
        if (
          event.before.archived ||
          event.after.archived ||
          event.before.provenance !== event.after.provenance ||
          event.before.baseUnit !== event.after.baseUnit ||
          event.before.lowThresholdBaseUnits !==
            event.after.lowThresholdBaseUnits
        )
          fail(
            "invalid_state",
            "Inventory catalog edits cannot change stock units or threshold history.",
          );
      } else if (
        event.before.archived ||
        !event.after.archived ||
        !sameRecord({ ...event.before, archived: true }, event.after)
      ) {
        fail("invalid_state", "Inventory archive history is invalid.");
      }
    }
    catalogByItem.set(itemId, event.after);
    lastCatalogRevisionByItem.set(itemId, event.itemRevision);
  });

  for (const [itemId, current] of items) {
    const catalogSnapshot = catalogByItem.get(itemId);
    if (catalogSnapshot) {
      if (
        !sameRecord(
          catalogSnapshot,
          inventoryMetadataSnapshot(current.metadata),
        ) ||
        current.metadata.catalogRevision !==
          lastCatalogRevisionByItem.get(itemId) ||
        current.metadata.archived !== catalogSnapshot.archived
      )
        fail(
          "invalid_state",
          "Inventory item metadata does not match its catalog history.",
        );
    } else if (
      current.metadata.provenance === "operator-count" ||
      hasOwn(current.metadata, "catalogRevision") ||
      hasOwn(current.metadata, "archived")
    ) {
      fail("invalid_state", "Inventory item is missing its catalog history.");
    }
    if (current.metadata.archived === true && current.stock !== 0)
      fail(
        "invalid_state",
        "Archived inventory items must not hide positive stock.",
      );
  }

  for (const current of items.values()) {
    if (
      !current.opening ||
      current.revision !== current.metadata.revision ||
      current.threshold !== current.metadata.lowThresholdBaseUnits
    ) {
      fail(
        "invalid_state",
        "Inventory item state does not match its immutable event history.",
      );
    }
  }
  if (state.revision !== operationCount + catalogEvents.length)
    fail(
      "invalid_state",
      "Inventory ledger revision does not match its event history.",
    );
  return clonedState(state);
}

export function inventorySummary(state) {
  const valid = validateInventoryState(state);
  return valid.items.map((item) => {
    let stockBaseUnits = 0;
    for (const entry of valid.entries) {
      if (entry.itemId !== item.itemId || entry.kind === "threshold") continue;
      stockBaseUnits += entry.deltaBaseUnits;
      if (!Number.isSafeInteger(stockBaseUnits))
        fail(
          "unsafe_balance",
          "Inventory balance exceeds the safe integer range.",
        );
    }
    if (stockBaseUnits < 0)
      fail("negative_balance", "Inventory balance cannot be negative.");
    return {
      ...item,
      stockBaseUnits,
      low: stockBaseUnits <= item.lowThresholdBaseUnits,
      archived: item.archived === true,
    };
  });
}

function assertCommand(command, allowedKinds) {
  if (!isRecord(command) || !allowedKinds.has(command.kind))
    fail("invalid_command", "Inventory command type is invalid.");
  const commandId = assertText(command.commandId, "Inventory command id", 180);
  const itemId = assertText(command.itemId, "Inventory item id", 100);
  const actorId = assertText(command.actorId, "Inventory actor id", 100);
  const actorName = assertText(command.actorName, "Inventory actor name", 120);
  const reason = assertText(command.reason, "Inventory reason", 250);
  if (reason.length > 250 || !Number.isFinite(Date.parse(command.occurredAt)))
    fail("invalid_command", "Inventory reason or timestamp is invalid.");
  if (
    !Number.isSafeInteger(command.expectedRevision) ||
    command.expectedRevision < 0
  )
    fail("invalid_command", "Inventory source revision is invalid.");
  return {
    commandId,
    itemId,
    actorId,
    actorName,
    reason,
    occurredAt: command.occurredAt,
  };
}

function sameEventContent(a, b) {
  return EVENT_FIELDS.every((field) => a[field] === b[field]);
}

function assertCatalogCommand(command, expectedKind) {
  if (!isRecord(command) || command.kind !== expectedKind)
    fail("invalid_command", "Inventory catalog command type is invalid.");
  const commandId = assertText(command.commandId, "Catalog command id", 180);
  const itemId = assertText(command.itemId, "Inventory item id", 100);
  const actorId = assertText(command.actorId, "Catalog actor id", 100);
  const actorName = assertText(command.actorName, "Catalog actor name", 120);
  const reason = assertText(command.reason, "Catalog reason", 250);
  if (
    !Number.isFinite(Date.parse(command.occurredAt)) ||
    !Number.isSafeInteger(command.expectedCatalogRevision) ||
    command.expectedCatalogRevision < 0
  )
    fail("invalid_command", "Catalog source revision or audit is invalid.");
  return {
    commandId,
    itemId,
    actorId,
    actorName,
    reason,
    occurredAt: command.occurredAt,
    expectedCatalogRevision: command.expectedCatalogRevision,
  };
}

function catalogEvent(common, kind, before, after, sourceRevision) {
  return {
    catalogEventId: `catalog:${common.commandId}`,
    commandId: common.commandId,
    itemId: common.itemId,
    kind,
    actorId: common.actorId,
    actorName: common.actorName,
    occurredAt: common.occurredAt,
    reason: common.reason,
    sourceRevision,
    itemRevision: sourceRevision + 1,
    before,
    after,
    syncStatus: "pending",
  };
}

function assertUniqueActiveName(state, name, exceptItemId = null) {
  const normalized = name.trim().toLocaleLowerCase("es-MX");
  if (
    state.items.some(
      (item) =>
        item.itemId !== exceptItemId &&
        item.archived !== true &&
        item.name.trim().toLocaleLowerCase("es-MX") === normalized,
    )
  )
    fail(
      "duplicate_item_name",
      "An active inventory item already uses that name.",
    );
}

function validateCatalogItemFields(nameValue, kind, displayUnit) {
  const name = assertText(nameValue, "Inventory item name", 120);
  if (!ITEM_TYPES.has(kind))
    fail("invalid_item_kind", "Inventory item type is invalid.");
  const baseUnit = baseUnitForDisplay(displayUnit);
  if (!BASE_UNITS.has(baseUnit))
    fail("unit_mismatch", "Inventory unit is invalid.");
  unitFactor(displayUnit, baseUnit);
  return { name, kind, baseUnit, displayUnit };
}

function commandMatchesCatalogEvent(event, common, kind, after) {
  return (
    event.kind === kind &&
    event.commandId === common.commandId &&
    event.itemId === common.itemId &&
    event.actorId === common.actorId &&
    event.actorName === common.actorName &&
    event.occurredAt === common.occurredAt &&
    event.reason === common.reason &&
    event.sourceRevision === common.expectedCatalogRevision &&
    sameRecord(event.after, after)
  );
}

/** Create a catalog item with a real, audited zero-or-positive opening count. */
export function createInventoryItem(state, command) {
  const valid = validateInventoryState(state);
  const common = assertCatalogCommand(command, "create");
  const fields = validateCatalogItemFields(
    command.name,
    command.itemKind,
    command.displayUnit,
  );
  const openingBaseUnits = quantityToBaseUnits(
    command.openingQuantityText,
    fields.displayUnit,
    fields.baseUnit,
    { allowZero: true },
  );
  const thresholdBaseUnits = quantityToBaseUnits(
    command.thresholdText,
    fields.displayUnit,
    fields.baseUnit,
    { allowZero: true },
  );
  const after = {
    itemId: common.itemId,
    ...fields,
    lowThresholdBaseUnits: thresholdBaseUnits,
    archived: false,
    provenance: "operator-count",
  };
  const history = valid.catalogEvents || [];
  const duplicate = history.find(
    (event) => event.commandId === common.commandId,
  );
  if (duplicate) {
    const openingCommandId = `${common.commandId}:opening`;
    const opening = valid.entries.find(
      (entry) => entry.commandId === openingCommandId,
    );
    if (
      !commandMatchesCatalogEvent(duplicate, common, "create", after) ||
      !opening ||
      opening.quantityBaseUnits !== openingBaseUnits ||
      opening.deltaBaseUnits !== openingBaseUnits ||
      opening.thresholdBaseUnits !== thresholdBaseUnits ||
      opening.quantityText !== String(command.openingQuantityText).trim() ||
      opening.thresholdText !== String(command.thresholdText).trim() ||
      opening.actorId !== common.actorId ||
      opening.actorName !== common.actorName ||
      opening.occurredAt !== common.occurredAt ||
      opening.reason !== common.reason
    )
      fail(
        "command_conflict",
        "This catalog command id was already used for different content.",
      );
    return { state: valid, event: duplicate, duplicate: true, changed: false };
  }
  const catalogRevision = valid.catalogRevision ?? 0;
  if (catalogRevision !== common.expectedCatalogRevision)
    fail(
      "stale_catalog_revision",
      "Inventory catalog changed after this form opened.",
    );
  if (valid.items.some((item) => item.itemId === common.itemId))
    fail("item_id_conflict", "Inventory item identifiers cannot be reused.");
  assertUniqueActiveName(valid, fields.name);
  const openingCommandId = `${common.commandId}:opening`;
  if (valid.entries.some((entry) => entry.commandId === openingCommandId))
    fail(
      "command_conflict",
      "This inventory opening command id is already in use.",
    );
  const item = {
    ...after,
    revision: 0,
    catalogRevision: catalogRevision + 1,
  };
  const opening = {
    movementId: `movement:${openingCommandId}`,
    commandId: openingCommandId,
    itemId: common.itemId,
    kind: "opening",
    quantityBaseUnits: openingBaseUnits,
    deltaBaseUnits: openingBaseUnits,
    unitSnapshot: fields.displayUnit,
    quantityText: String(command.openingQuantityText).trim(),
    actorId: common.actorId,
    actorName: common.actorName,
    occurredAt: common.occurredAt,
    reason: common.reason,
    sourceRevision: 0,
    itemRevision: 0,
    syncStatus: "pending",
    thresholdBaseUnits,
    thresholdText: String(command.thresholdText).trim(),
    provenance: "operator-count",
    itemNameSnapshot: fields.name,
    itemKindSnapshot: fields.kind,
  };
  const event = catalogEvent(common, "create", null, after, catalogRevision);
  const next = validateInventoryState({
    ...valid,
    revision: valid.revision + 1,
    catalogRevision: catalogRevision + 1,
    catalogEvents: [...history, event],
    items: [...valid.items, item],
    entries: [...valid.entries, opening],
  });
  return { state: next, event, opening, duplicate: false, changed: true };
}

function assertCatalogItemRevision(command, item) {
  if (
    !Number.isSafeInteger(command.expectedItemCatalogRevision) ||
    command.expectedItemCatalogRevision < 0
  )
    fail("invalid_command", "Inventory item catalog revision is invalid.");
  if ((item.catalogRevision ?? 0) !== command.expectedItemCatalogRevision)
    fail(
      "stale_catalog_revision",
      "Inventory item changed after this form opened.",
    );
}

/** Edit descriptive fields without migrating the integer stock base unit. */
export function editInventoryItem(state, command) {
  const valid = validateInventoryState(state);
  const common = assertCatalogCommand(command, "edit");
  const history = valid.catalogEvents || [];
  const duplicate = history.find(
    (event) => event.commandId === common.commandId,
  );
  let before;
  let after;
  if (duplicate) {
    if (duplicate.kind !== "edit" || !duplicate.before)
      fail(
        "command_conflict",
        "This catalog command id was already used for different content.",
      );
    before = duplicate.before;
    const fields = validateCatalogItemFields(
      command.name,
      command.itemKind,
      command.displayUnit,
    );
    if (fields.baseUnit !== before.baseUnit)
      fail(
        "base_unit_migration_required",
        "Changing an item's base unit requires a separate stock migration.",
      );
    after = {
      ...before,
      name: fields.name,
      kind: fields.kind,
      displayUnit: fields.displayUnit,
    };
    if (!commandMatchesCatalogEvent(duplicate, common, "edit", after))
      fail(
        "command_conflict",
        "This catalog command id was already used for different content.",
      );
    return { state: valid, event: duplicate, duplicate: true, changed: false };
  }
  const catalogRevision = valid.catalogRevision ?? 0;
  if (catalogRevision !== common.expectedCatalogRevision)
    fail(
      "stale_catalog_revision",
      "Inventory catalog changed after this form opened.",
    );
  const item = itemById(valid, common.itemId);
  if (!item) fail("unknown_item", "Inventory item does not exist.");
  if (item.archived === true)
    fail("archived_item", "Archived inventory items cannot be edited.");
  assertCatalogItemRevision(command, item);
  const fields = validateCatalogItemFields(
    command.name,
    command.itemKind,
    command.displayUnit,
  );
  if (fields.baseUnit !== item.baseUnit)
    fail(
      "base_unit_migration_required",
      "Changing an item's base unit requires a separate stock migration.",
    );
  assertUniqueActiveName(valid, fields.name, item.itemId);
  before = inventoryMetadataSnapshot(item);
  after = {
    ...before,
    name: fields.name,
    kind: fields.kind,
    displayUnit: fields.displayUnit,
  };
  const event = catalogEvent(common, "edit", before, after, catalogRevision);
  const next = validateInventoryState({
    ...valid,
    revision: valid.revision + 1,
    catalogRevision: catalogRevision + 1,
    catalogEvents: [...history, event],
    items: valid.items.map((candidate) =>
      candidate.itemId === item.itemId
        ? {
            ...candidate,
            ...fields,
            archived: false,
            catalogRevision: catalogRevision + 1,
          }
        : candidate,
    ),
  });
  return { state: next, event, duplicate: false, changed: true };
}

/** Archive an item without deleting its balance or any part of its history. */
export function archiveInventoryItem(state, command) {
  const valid = validateInventoryState(state);
  const common = assertCatalogCommand(command, "archive");
  const history = valid.catalogEvents || [];
  const duplicate = history.find(
    (event) => event.commandId === common.commandId,
  );
  let before;
  let after;
  if (duplicate) {
    if (duplicate.kind !== "archive" || !duplicate.before)
      fail(
        "command_conflict",
        "This catalog command id was already used for different content.",
      );
    before = duplicate.before;
    after = { ...before, archived: true };
    if (!commandMatchesCatalogEvent(duplicate, common, "archive", after))
      fail(
        "command_conflict",
        "This catalog command id was already used for different content.",
      );
    return { state: valid, event: duplicate, duplicate: true, changed: false };
  }
  const catalogRevision = valid.catalogRevision ?? 0;
  if (catalogRevision !== common.expectedCatalogRevision)
    fail(
      "stale_catalog_revision",
      "Inventory catalog changed after this form opened.",
    );
  const item = itemById(valid, common.itemId);
  if (!item) fail("unknown_item", "Inventory item does not exist.");
  if (item.archived === true)
    fail("archived_item", "This inventory item is already archived.");
  assertCatalogItemRevision(command, item);
  const currentStock = inventorySummary(valid).find(
    (summary) => summary.itemId === item.itemId,
  ).stockBaseUnits;
  if (currentStock !== 0)
    fail(
      "archive_with_stock",
      "The item still has stock. Record or verify its disposition before archiving.",
    );
  before = inventoryMetadataSnapshot(item);
  after = { ...before, archived: true };
  const event = catalogEvent(common, "archive", before, after, catalogRevision);
  const next = validateInventoryState({
    ...valid,
    revision: valid.revision + 1,
    catalogRevision: catalogRevision + 1,
    catalogEvents: [...history, event],
    items: valid.items.map((candidate) =>
      candidate.itemId === item.itemId
        ? { ...candidate, archived: true, catalogRevision: catalogRevision + 1 }
        : candidate,
    ),
  });
  return { state: next, event, duplicate: false, changed: true };
}

function storeEvent(valid, item, event) {
  const items = valid.items.map((candidate) =>
    candidate.itemId === item.itemId
      ? {
          ...candidate,
          revision: event.itemRevision,
          ...(event.kind === "threshold"
            ? { lowThresholdBaseUnits: event.thresholdBaseUnits }
            : {}),
        }
      : candidate,
  );
  return validateInventoryState({
    ...valid,
    revision: valid.revision + 1,
    items,
    entries: [...valid.entries, event],
  });
}

/** Add an entry, waste, or signed adjustment to a validated immutable ledger. */
export function applyInventoryMovement(state, command) {
  const valid = validateInventoryState(state);
  const common = assertCommand(
    command,
    new Set(["entry", "waste", "adjustment"]),
  );
  const item = itemById(valid, common.itemId);
  if (!item) fail("unknown_item", "Inventory item does not exist.");
  const quantityBaseUnits = quantityToBaseUnits(
    command.quantityText,
    command.unit,
    item.baseUnit,
    { signed: command.kind === "adjustment" },
  );
  const deltaBaseUnits =
    command.kind === "entry"
      ? quantityBaseUnits
      : command.kind === "waste"
        ? -quantityBaseUnits
        : quantityBaseUnits;
  const event = {
    movementId: `movement:${common.commandId}`,
    commandId: common.commandId,
    itemId: common.itemId,
    itemNameSnapshot: command.itemNameSnapshot || item.name,
    itemKindSnapshot: command.itemKindSnapshot || item.kind,
    kind: command.kind,
    quantityBaseUnits: Math.abs(quantityBaseUnits),
    deltaBaseUnits,
    unitSnapshot: command.unit,
    quantityText: String(command.quantityText).trim(),
    actorId: common.actorId,
    actorName: common.actorName,
    occurredAt: common.occurredAt,
    reason: common.reason,
    sourceRevision: command.expectedRevision,
    itemRevision: command.expectedRevision + 1,
    syncStatus: "pending",
  };
  const duplicate = valid.entries.find(
    (entry) => entry.commandId === common.commandId,
  );
  if (duplicate) {
    if (!sameEventContent(duplicate, event))
      fail(
        "command_conflict",
        "This inventory command id was already used for different content.",
      );
    return { state: valid, entry: duplicate, duplicate: true, changed: false };
  }
  if (item.archived === true)
    fail("archived_item", "Archived inventory items cannot receive movements.");
  if (item.revision !== command.expectedRevision)
    fail(
      "stale_revision",
      "Inventory changed after this form opened. Review the current stock and try again.",
    );
  const stock = inventorySummary(valid).find(
    (summary) => summary.itemId === common.itemId,
  ).stockBaseUnits;
  const nextStock = stock + deltaBaseUnits;
  if (!Number.isSafeInteger(nextStock))
    fail("unsafe_balance", "Inventory balance exceeds the safe integer range.");
  if (nextStock < 0)
    fail(
      "negative_balance",
      "This movement cannot reduce inventory below zero.",
    );
  return {
    state: storeEvent(valid, item, event),
    entry: event,
    duplicate: false,
    changed: true,
  };
}

/** Append an audited low-stock threshold change without changing stock. */
export function applyInventoryThreshold(state, command) {
  const valid = validateInventoryState(state);
  const common = assertCommand(command, new Set(["threshold"]));
  const item = itemById(valid, common.itemId);
  if (!item) fail("unknown_item", "Inventory item does not exist.");
  const thresholdBaseUnits = quantityToBaseUnits(
    command.quantityText,
    command.unit,
    item.baseUnit,
    { allowZero: true },
  );
  const duplicate = valid.entries.find(
    (entry) => entry.commandId === common.commandId,
  );
  const event = {
    movementId: `movement:${common.commandId}`,
    commandId: common.commandId,
    itemId: common.itemId,
    itemNameSnapshot: command.itemNameSnapshot || item.name,
    itemKindSnapshot: command.itemKindSnapshot || item.kind,
    kind: "threshold",
    quantityBaseUnits: 0,
    deltaBaseUnits: 0,
    unitSnapshot: command.unit,
    quantityText: String(command.quantityText).trim(),
    actorId: common.actorId,
    actorName: common.actorName,
    occurredAt: common.occurredAt,
    reason: common.reason,
    sourceRevision: command.expectedRevision,
    itemRevision: command.expectedRevision + 1,
    syncStatus: "pending",
    thresholdBeforeBaseUnits:
      duplicate?.thresholdBeforeBaseUnits ?? item.lowThresholdBaseUnits,
    thresholdBaseUnits,
  };
  if (duplicate) {
    if (!sameEventContent(duplicate, event))
      fail(
        "command_conflict",
        "This inventory command id was already used for different content.",
      );
    return { state: valid, entry: duplicate, duplicate: true, changed: false };
  }
  if (item.archived === true)
    fail("archived_item", "Archived inventory items cannot change thresholds.");
  if (item.revision !== command.expectedRevision)
    fail(
      "stale_revision",
      "Inventory changed after this form opened. Review the current stock and try again.",
    );
  return {
    state: storeEvent(valid, item, event),
    entry: event,
    duplicate: false,
    changed: true,
  };
}
