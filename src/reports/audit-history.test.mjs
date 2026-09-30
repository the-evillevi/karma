import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyInventoryThreshold,
  applyInventoryMovement,
  createInitialInventoryState,
  editInventoryItem,
  validateInventoryState,
} from "../inventory/inventory-ledger.mjs";
import {
  createRecipeCatalog,
  previewRecipePublication,
  publishRecipe,
} from "../inventory/recipe-ledger.mjs";
import {
  filterAuditHistory,
  projectAuditHistory,
  recordedAuditInstant,
} from "./audit-history.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const productCatalog = JSON.parse(
  await readFile(path.join(root, "catalog/catalog.json"), "utf8"),
);
const product = productCatalog.products.find(
  (entry) => entry.modifierGroupIds.length === 0,
);
const actor = {
  actorId: "owner-1",
  actorName: "Marcela Ortiz",
  occurredAt: "2026-09-30T12:00:00.000Z",
  reason: "Cambio revisado por administración.",
};

function inventory() {
  return createInitialInventoryState(
    [
      {
        id: "beans",
        name: "Café en grano",
        kind: "Ingrediente",
        qty: 6.5,
        unit: "kg",
        min: 3,
      },
    ],
    actor.occurredAt,
  );
}

function recipePublication(inventoryState) {
  const recipeCatalog = createRecipeCatalog();
  const draft = {
    mode: "recipe",
    evidence: "Mapeo explícito para prueba de historial.",
    items: [{ itemId: "beans", quantityText: "18", unit: "g" }],
    finishedGood: null,
    modifierEffects: [],
  };
  const preview = previewRecipePublication(
    recipeCatalog,
    productCatalog,
    inventoryState,
    product.id,
    draft,
  );
  const command = {
    commandId: "recipe-command-1",
    productId: product.id,
    expectedRecipeCatalogRevision: recipeCatalog.revision,
    expectedRecipeRevision: 0,
    expectedProductCatalogRevision: productCatalog.revision,
    expectedInventoryRevision: inventoryState.revision,
    expectedInventoryCatalogRevision: inventoryState.catalogRevision ?? 0,
    ...actor,
    roleSnapshot: "duena",
    draft,
    preview,
  };
  return publishRecipe(
    recipeCatalog,
    command,
    { actorId: actor.actorId, role: "duena" },
    productCatalog,
    inventoryState,
  ).catalog;
}

test("projects stable actor/time/field snapshots from append-only inventory and recipe sources", () => {
  let inventoryState = inventory();
  inventoryState = applyInventoryMovement(inventoryState, {
    ...actor,
    commandId: "entry-1",
    itemId: "beans",
    kind: "entry",
    quantityText: "0.5",
    unit: "kg",
    expectedRevision: 0,
    itemNameSnapshot: "Café en grano",
    itemKindSnapshot: "Ingrediente",
  }).state;
  inventoryState = editInventoryItem(inventoryState, {
    ...actor,
    commandId: "catalog-edit-1",
    kind: "edit",
    itemId: "beans",
    name: "Café de origen",
    itemKind: "Ingrediente",
    displayUnit: "g",
    expectedCatalogRevision: 0,
    expectedItemCatalogRevision: 0,
  }).state;
  const recipeCatalog = recipePublication(inventoryState);

  const events = projectAuditHistory({ inventoryState, recipeCatalog });
  const movement = events.find(
    (event) => event.id === "inventory-entry:movement:entry-1",
  );
  const catalog = events.find(
    (event) => event.id === "inventory-catalog:catalog:catalog-edit-1",
  );
  const recipe = events.find(
    (event) => event.id === "recipe-publication:recipe-command-1",
  );
  assert.ok(movement);
  assert.equal(movement.actorId, actor.actorId);
  assert.equal(movement.actorName, actor.actorName);
  assert.equal(movement.occurredAt, actor.occurredAt);
  assert.equal(movement.entityLabel, "Café en grano");
  assert.deepEqual(
    movement.changes.find((change) => change.field === "Existencia antes"),
    {
      field: "Existencia antes",
      beforeValue: "6.5 kg",
      afterValue: "7 kg",
    },
  );
  assert.ok(
    catalog.changes.some(
      (change) =>
        change.field === "Nombre" &&
        change.beforeValue === "Café en grano" &&
        change.afterValue === "Café de origen",
    ),
  );
  assert.equal(recipe.actorId, actor.actorId);
  assert.equal(recipe.entityLabel, product.name);
  assert.ok(
    recipe.changes.some(
      (change) =>
        change.field.includes("Cantidad capturada") &&
        change.afterValue === "18",
    ),
  );
  assert.deepEqual(
    events.map((event) => event.id),
    projectAuditHistory({ inventoryState, recipeCatalog }).map(
      (event) => event.id,
    ),
  );
  assert.equal(events[0].occurredAt, actor.occurredAt);
  assert.ok(events.every((event) => !event.action.includes("conflict")));
});

test("filters by branch calendar date, entity, action, and original operator identity", () => {
  const inventoryState = applyInventoryMovement(inventory(), {
    ...actor,
    commandId: "entry-filter",
    itemId: "beans",
    kind: "entry",
    quantityText: "1",
    unit: "kg",
    expectedRevision: 0,
    itemNameSnapshot: "Café en grano",
    itemKindSnapshot: "Ingrediente",
  }).state;
  const events = projectAuditHistory({
    inventoryState,
    recipeCatalog: createRecipeCatalog(),
  });
  const filtered = filterAuditHistory(events, {
    from: "2026-09-30",
    through: "2026-09-30",
    timeZone: "America/Mexico_City",
    entityType: "inventory",
    action: "entry",
    actorId: actor.actorId,
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, "inventory-entry:movement:entry-filter");
  assert.equal(
    filterAuditHistory(events, { entityType: "conflict" }).length,
    0,
  );
  assert.throws(() => filterAuditHistory(events, { from: "2026-09-31" }), {
    code: "invalid_filter",
  });
  assert.throws(() => filterAuditHistory(events, { timeZone: "not/a-zone" }), {
    code: "invalid_time_zone",
  });
  assert.throws(() => filterAuditHistory(events, { timeZone: "" }), {
    code: "invalid_time_zone",
  });
});

test("renders threshold changes with their captured unit after catalog display-unit edits", () => {
  let inventoryState = inventory();
  inventoryState = applyInventoryThreshold(inventoryState, {
    ...actor,
    commandId: "threshold-1",
    itemId: "beans",
    kind: "threshold",
    quantityText: "4",
    unit: "kg",
    expectedRevision: 0,
  }).state;
  inventoryState = editInventoryItem(inventoryState, {
    ...actor,
    commandId: "catalog-unit-1",
    kind: "edit",
    itemId: "beans",
    name: "Café en grano",
    itemKind: "Ingrediente",
    displayUnit: "g",
    expectedCatalogRevision: 0,
    expectedItemCatalogRevision: 0,
  }).state;
  const threshold = projectAuditHistory({ inventoryState }).find(
    (event) => event.id === "inventory-entry:movement:threshold-1",
  );
  assert.deepEqual(threshold.changes, [
    {
      field: "Mínimo de existencias",
      beforeValue: "3 kg",
      afterValue: "4 kg",
    },
  ]);
});

test("fails closed on rewritten source history or timestamps that are not exact UTC instants", () => {
  const valid = inventory();
  const modified = {
    ...valid,
    entries: valid.entries.slice(1),
  };
  assert.throws(() => validateInventoryState(modified));
  assert.throws(
    () =>
      projectAuditHistory({
        inventoryState: modified,
        recipeCatalog: createRecipeCatalog(),
      }),
    { code: "invalid_history" },
  );
  const badTime = {
    ...valid,
    entries: valid.entries.map((entry) => ({
      ...entry,
      occurredAt: "2026-09-30",
    })),
  };
  assert.throws(
    () =>
      projectAuditHistory({
        inventoryState: badTime,
        recipeCatalog: createRecipeCatalog(),
      }),
    { code: "invalid_timestamp" },
  );
  assert.equal(
    recordedAuditInstant("2026-09-30T12:00:00.000Z"),
    "2026-09-30T12:00:00.000Z",
  );
  assert.equal(recordedAuditInstant("Hoy · 09:00"), null);
  assert.throws(
    () =>
      projectAuditHistory({ inventoryState: { entries: new Array(200_001) } }),
    { code: "history_too_large" },
  );
});
