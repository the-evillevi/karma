import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createRecipeCatalog,
  planConsumptionCompensation,
  planPreparationConsumption,
  previewRecipePublication,
  publishRecipe,
  validateRecipeCatalog,
} from "./recipe-ledger.mjs";
import {
  createInitialInventoryState,
  createInventoryItem,
} from "./inventory-ledger.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const productCatalog = JSON.parse(
  await readFile(path.join(root, "catalog/catalog.json"), "utf8"),
);
const product = productCatalog.products.find(
  (item) => item.id === "concafe-americano",
);
const actor = { actorId: "owner-1", role: "duena" };
const audit = {
  actorId: actor.actorId,
  actorName: "Marcela Ortiz",
  occurredAt: "2026-09-30T12:00:00.000Z",
  reason: "Configuración explícita para prueba de dominio.",
};

function inventoryFixture() {
  let state = createInitialInventoryState(
    [
      {
        id: "seed-fixture",
        name: "Saldo de demostración",
        kind: "Ingrediente",
        qty: 0,
        unit: "g",
        min: 0,
      },
    ],
    audit.occurredAt,
  );
  for (const item of [
    {
      itemId: "beans",
      name: "Café de prueba",
      itemKind: "Ingrediente",
      displayUnit: "kg",
      openingQuantityText: "2",
      thresholdText: "0",
    },
    {
      itemId: "milk",
      name: "Leche de prueba",
      itemKind: "Ingrediente",
      displayUnit: "L",
      openingQuantityText: "4",
      thresholdText: "0",
    },
    {
      itemId: "oat",
      name: "Avena de prueba",
      itemKind: "Ingrediente",
      displayUnit: "L",
      openingQuantityText: "4",
      thresholdText: "0",
    },
    {
      itemId: "syrup",
      name: "Jarabe de prueba",
      itemKind: "Insumo",
      displayUnit: "g",
      openingQuantityText: "1000",
      thresholdText: "0",
    },
    {
      itemId: "finished",
      name: "Galleta de prueba",
      itemKind: "Producto terminado",
      displayUnit: "pz",
      openingQuantityText: "20",
      thresholdText: "0",
    },
  ]) {
    state = createInventoryItem(state, {
      ...audit,
      kind: "create",
      commandId: `create:${item.itemId}`,
      itemId: item.itemId,
      expectedCatalogRevision: state.catalogRevision ?? 0,
      expectedItemCatalogRevision: 0,
      name: item.name,
      itemKind: item.itemKind,
      displayUnit: item.displayUnit,
      openingQuantityText: item.openingQuantityText,
      thresholdText: item.thresholdText,
    }).state;
  }
  return state;
}

function allModifierEffects({ substitutions = true, additions = true } = {}) {
  const effects = [];
  for (const groupId of product.modifierGroupIds) {
    const group = productCatalog.modifierGroups.find(
      (item) => item.id === groupId,
    );
    for (const option of group.options.filter((item) => item.active)) {
      if (substitutions && groupId === "leche" && option.id === "avena") {
        effects.push({
          groupId,
          optionId: option.id,
          effect: "substitute",
          remove: [{ itemId: "milk", quantityText: "0.24", unit: "L" }],
          add: [{ itemId: "oat", quantityText: "0.24", unit: "L" }],
        });
      } else if (additions && groupId === "shot" && option.id === "amareto") {
        effects.push({
          groupId,
          optionId: option.id,
          effect: "add",
          remove: [],
          add: [{ itemId: "syrup", quantityText: "8", unit: "g" }],
        });
      } else {
        effects.push({
          groupId,
          optionId: option.id,
          effect: "none",
          remove: [],
          add: [],
        });
      }
    }
  }
  return effects;
}

function recipeDraft() {
  return {
    mode: "recipe",
    evidence:
      "Mapeo manual explícito para pruebas; no es fuente comercial verificada.",
    items: [
      { itemId: "beans", quantityText: "0.018", unit: "kg" },
      { itemId: "milk", quantityText: "0.24", unit: "L" },
    ],
    finishedGood: null,
    modifierEffects: allModifierEffects(),
  };
}

function publishCommand(catalog, inventoryState, draft, commandId) {
  const preview = previewRecipePublication(
    catalog,
    productCatalog,
    inventoryState,
    product.id,
    draft,
  );
  return {
    commandId,
    productId: product.id,
    expectedRecipeCatalogRevision: catalog.revision,
    expectedRecipeRevision:
      catalog.recipes.find((item) => item.productId === product.id)
        ?.recipeRevision || 0,
    expectedProductCatalogRevision: productCatalog.revision,
    expectedInventoryRevision: inventoryState.revision,
    expectedInventoryCatalogRevision: inventoryState.catalogRevision,
    ...audit,
    roleSnapshot: actor.role,
    draft,
    preview,
  };
}

function preparationCommand(inventoryState, recipeCatalog, changes = {}) {
  return {
    commandId: "send:folio-1",
    preparationId: "prep-1",
    folio: "EVL129-1",
    occurredAt: "2026-09-30T12:30:00.000Z",
    actorId: actor.actorId,
    actorName: audit.actorName,
    roleSnapshot: actor.role,
    reason: "Consumo propuesto al enviar preparación.",
    expectedRecipeCatalogRevision: recipeCatalog.revision,
    expectedProductCatalogRevision: productCatalog.revision,
    expectedInventoryRevision: inventoryState.revision,
    expectedInventoryCatalogRevision: inventoryState.catalogRevision,
    lines: [
      {
        lineId: "line-1",
        productId: product.id,
        productNameSnapshot: product.name,
        quantity: 2,
        modifiers: [
          { groupId: "leche", optionId: "avena", quantity: null },
          { groupId: "shot", optionId: "amareto", quantity: null },
        ],
      },
    ],
    ...changes,
  };
}

test("publication previews explicit product, ingredient, substitution, addition and no-effect mappings by stable ids", () => {
  const inventory = inventoryFixture();
  const draft = recipeDraft();
  const preview = previewRecipePublication(
    createRecipeCatalog(),
    productCatalog,
    inventory,
    product.id,
    draft,
  );

  assert.deepEqual(
    preview.baseConsumption.map((row) => [row.itemId, row.quantityBaseUnits]),
    [
      ["beans", 18],
      ["milk", 240],
    ],
  );
  const oat = preview.modifierScenarios.find(
    (row) => row.groupId === "leche" && row.optionId === "avena",
  );
  assert.deepEqual(
    oat.consumption.map((row) => [row.itemId, row.quantityBaseUnits]),
    [
      ["beans", 18],
      ["oat", 240],
    ],
  );
  const extraShot = preview.modifierScenarios.find(
    (row) => row.groupId === "shot" && row.optionId === "amareto",
  );
  assert.deepEqual(
    extraShot.consumption.map((row) => [row.itemId, row.quantityBaseUnits]),
    [
      ["beans", 18],
      ["milk", 240],
      ["syrup", 8],
    ],
  );
  assert.equal(preview.recipeSnapshot.items[0].itemId, "beans");
  assert.equal(
    preview.recipeSnapshot.modifierEffects.find(
      (effect) => effect.optionId === "avena",
    ).groupId,
    "leche",
  );
  assert.equal(
    preview.recipeSnapshot.provenance,
    "operator-configured-unverified",
  );
  assert.equal(preview.orderFlowBlocked, false);
  assert.equal(preview.complete, true);
  assert.equal(preview.automaticConsumptionEligible, false);
  assert.ok(
    preview.warnings.some(
      (warning) => warning.code === "product_catalog_unverified",
    ),
  );
  assert.ok(
    preview.warnings.some((warning) => warning.code === "stock_unverified") ===
      false,
  );
});

test("publication is owner/manager authorized, revision guarded, stable-id idempotent and append-only", () => {
  const inventory = inventoryFixture();
  const initial = createRecipeCatalog();
  const firstCommand = publishCommand(
    initial,
    inventory,
    recipeDraft(),
    "recipe:1",
  );
  assert.throws(
    () =>
      publishRecipe(
        initial,
        firstCommand,
        { ...actor, role: "barra" },
        productCatalog,
        inventory,
      ),
    /does not match the command identity/,
  );
  const first = publishRecipe(
    initial,
    firstCommand,
    actor,
    productCatalog,
    inventory,
  );
  assert.equal(first.catalog.revision, 1);
  assert.equal(first.event.after.recipeRevision, 1);
  assert.equal(
    publishRecipe(first.catalog, firstCommand, actor, productCatalog, inventory)
      .duplicate,
    true,
  );
  assert.throws(
    () =>
      publishRecipe(
        first.catalog,
        { ...firstCommand, reason: "Contenido cambiado." },
        actor,
        productCatalog,
        inventory,
      ),
    /different content/,
  );

  const changedDraft = recipeDraft();
  changedDraft.items[0].quantityText = "0.020";
  const secondCommand = publishCommand(
    first.catalog,
    inventory,
    changedDraft,
    "recipe:2",
  );
  const second = publishRecipe(
    first.catalog,
    secondCommand,
    actor,
    productCatalog,
    inventory,
  );
  assert.equal(second.catalog.revision, 2);
  assert.equal(second.event.before.items[0].quantityBaseUnits, 18);
  assert.equal(second.event.after.items[0].quantityBaseUnits, 20);
  assert.equal(first.event.after.items[0].quantityBaseUnits, 18);
  assert.equal(validateRecipeCatalog(second.catalog).events.length, 2);
  const stale = publishCommand(
    second.catalog,
    inventory,
    recipeDraft(),
    "recipe:stale",
  );
  assert.throws(
    () =>
      publishRecipe(
        second.catalog,
        { ...stale, expectedInventoryRevision: inventory.revision + 1 },
        actor,
        productCatalog,
        inventory,
      ),
    /source changed after the preview/,
  );
});

test("recipe and piece mappings preserve explicit no-control, finished-piece and invalid substitution boundaries", () => {
  const inventory = inventoryFixture();
  const piece = {
    mode: "piece",
    evidence: "Mapeo manual de producto terminado para prueba.",
    items: [],
    finishedGood: { itemId: "finished", quantityText: "1", unit: "pz" },
    modifierEffects: [
      {
        groupId: "leche",
        optionId: "avena",
        effect: "add",
        remove: [],
        add: [{ itemId: "syrup", quantityText: "2", unit: "g" }],
      },
    ],
  };
  const piecePreview = previewRecipePublication(
    createRecipeCatalog(),
    productCatalog,
    inventory,
    product.id,
    piece,
  );
  assert.equal(piecePreview.recipeSnapshot.finishedGood.itemId, "finished");
  assert.ok(piecePreview.modifierScenarios.some((row) => row.effect === "add"));
  assert.throws(
    () =>
      previewRecipePublication(
        createRecipeCatalog(),
        productCatalog,
        inventory,
        product.id,
        {
          ...piece,
          modifierEffects: [
            {
              groupId: "leche",
              optionId: "avena",
              effect: "substitute",
              remove: [{ itemId: "milk", quantityText: "1", unit: "L" }],
              add: [{ itemId: "syrup", quantityText: "2", unit: "g" }],
            },
          ],
        },
      ),
    /cannot substitute a finished piece/,
  );
  const noControl = {
    mode: "none",
    evidence: "No se controla inventario para esta prueba.",
    items: [],
    finishedGood: null,
    modifierEffects: [],
  };
  assert.equal(
    previewRecipePublication(
      createRecipeCatalog(),
      productCatalog,
      inventory,
      product.id,
      noControl,
    ).recipeSnapshot.mode,
    "none",
  );
  assert.throws(
    () =>
      previewRecipePublication(
        createRecipeCatalog(),
        productCatalog,
        inventory,
        product.id,
        {
          ...piece,
          modifierEffects: [
            {
              groupId: "leche",
              optionId: "avena",
              effect: "add",
              remove: [{ itemId: "milk", quantityText: "1", unit: "L" }],
              add: [{ itemId: "syrup", quantityText: "2", unit: "g" }],
            },
          ],
        },
      ),
    /additions and no removals/,
  );
});

test("SEND planner aggregates integer base units with captured substitutions, warns without blocking, and never applies stock", () => {
  const inventory = inventoryFixture();
  const catalog = publishRecipe(
    createRecipeCatalog(),
    publishCommand(createRecipeCatalog(), inventory, recipeDraft(), "recipe:1"),
    actor,
    productCatalog,
    inventory,
  ).catalog;
  const command = preparationCommand(inventory, catalog);
  const result = planPreparationConsumption(
    catalog,
    productCatalog,
    inventory,
    command,
    actor,
  );

  assert.equal(result.duplicate, false);
  assert.equal(result.plan.applicationState, "not_applied");
  assert.equal(result.plan.orderFlowBlocked, false);
  assert.equal(result.plan.automaticConsumptionEligible, false);
  assert.ok(
    result.plan.warnings.some(
      (warning) => warning.code === "product_unverified",
    ),
  );
  assert.deepEqual(
    result.movements.map((movement) => [
      movement.itemId,
      movement.quantityBaseUnits,
      movement.deltaBaseUnits,
    ]),
    [
      ["beans", 36, -36],
      ["oat", 480, -480],
      ["syrup", 16, -16],
    ],
  );
  assert.ok(
    result.movements.every((movement) =>
      movement.sourceAllocations.every(
        (allocation) => allocation.recipeRevision === 1,
      ),
    ),
  );
  assert.throws(
    () =>
      planPreparationConsumption(
        catalog,
        productCatalog,
        inventory,
        { ...command, roleSnapshot: "duena" },
        { ...actor, role: "barra" },
      ),
    /does not match the command identity/,
  );
  assert.throws(
    () =>
      planPreparationConsumption(
        catalog,
        productCatalog,
        inventory,
        { ...command, expectedInventoryRevision: inventory.revision + 1 },
        actor,
      ),
    /changed after the preparation preview/,
  );
  const unmapped = planPreparationConsumption(
    catalog,
    productCatalog,
    inventory,
    {
      ...command,
      lines: [
        {
          ...command.lines[0],
          modifiers: [{ groupId: "leche", optionId: null, quantity: 2 }],
        },
      ],
    },
    actor,
  );
  assert.ok(
    unmapped.plan.warnings.some(
      (warning) => warning.code === "modifier_unmapped",
    ),
  );
  const committed = { ...result.plan, applicationState: "committed" };
  const retry = planPreparationConsumption(
    catalog,
    productCatalog,
    inventory,
    command,
    actor,
    [committed],
  );
  assert.equal(retry.duplicate, true);
  assert.deepEqual(retry.movements, []);
  assert.throws(
    () =>
      planPreparationConsumption(
        catalog,
        productCatalog,
        inventory,
        { ...command, lines: [{ ...command.lines[0], quantity: 3 }] },
        actor,
        [committed],
      ),
    /different captured lines/,
  );
  const malformed = structuredClone(committed);
  malformed.movements[0].quantityBaseUnits += 1;
  malformed.movements[0].deltaBaseUnits -= 1;
  malformed.movements[0].sourceAllocations[0].quantityBaseUnits += 1;
  assert.throws(
    () =>
      planPreparationConsumption(
        catalog,
        productCatalog,
        inventory,
        command,
        actor,
        [malformed],
      ),
    /allocation total does not match captured product quantity/,
  );
});

test("missing and insufficient recipe records warn without blocking order flow", () => {
  const inventory = inventoryFixture();
  const empty = createRecipeCatalog();
  const missing = planPreparationConsumption(
    empty,
    productCatalog,
    inventory,
    preparationCommand(inventory, empty),
    actor,
  );
  assert.equal(missing.plan.lines[0].readiness, "unknown");
  assert.ok(
    missing.plan.warnings.some((warning) => warning.code === "recipe_missing"),
  );
  assert.deepEqual(missing.movements, []);
  assert.equal(missing.plan.orderFlowBlocked, false);

  const published = publishRecipe(
    empty,
    publishCommand(empty, inventory, recipeDraft(), "recipe:insufficient"),
    actor,
    productCatalog,
    inventory,
  ).catalog;
  const oversized = preparationCommand(inventory, published, {
    lines: [
      {
        lineId: "line-1",
        productId: product.id,
        productNameSnapshot: product.name,
        quantity: 1000,
        modifiers: [],
      },
    ],
  });
  const insufficient = planPreparationConsumption(
    published,
    productCatalog,
    inventory,
    oversized,
    actor,
  );
  assert.ok(
    insufficient.plan.warnings.some(
      (warning) => warning.code === "insufficient_stock",
    ),
  );
  assert.equal(insufficient.plan.orderFlowBlocked, false);
  assert.equal(insufficient.plan.automaticConsumptionEligible, false);
});

test("cancel/refund planning reverses actual committed quantities and is safe to retry", () => {
  const inventory = inventoryFixture();
  const empty = createRecipeCatalog();
  const first = publishRecipe(
    empty,
    publishCommand(empty, inventory, recipeDraft(), "recipe:1"),
    actor,
    productCatalog,
    inventory,
  );
  const command = preparationCommand(inventory, first.catalog);
  const prepared = planPreparationConsumption(
    first.catalog,
    productCatalog,
    inventory,
    command,
    actor,
  ).plan;
  const committed = { ...prepared, applicationState: "committed" };

  const changedDraft = recipeDraft();
  changedDraft.items[0].quantityText = "0.020";
  const secondCommand = publishCommand(
    first.catalog,
    inventory,
    changedDraft,
    "recipe:2",
  );
  const newerRecipes = publishRecipe(
    first.catalog,
    secondCommand,
    actor,
    productCatalog,
    inventory,
  ).catalog;
  assert.equal(newerRecipes.recipes[0].items[0].quantityBaseUnits, 20);

  const cancellation = {
    commandId: "cancel:send-1",
    sourceCommandId: command.commandId,
    kind: "cancel",
    occurredAt: "2026-09-30T13:00:00.000Z",
    actorId: actor.actorId,
    actorName: audit.actorName,
    roleSnapshot: actor.role,
    reason: "Cancelar y revertir el consumo realmente registrado.",
    expectedInventoryRevision: inventory.revision,
    returnedLines: [{ lineId: "line-1", quantity: 2 }],
  };
  const reversed = planConsumptionCompensation(
    committed,
    cancellation,
    actor,
    inventory,
  );
  assert.deepEqual(
    reversed.movements.map((movement) => [
      movement.itemId,
      movement.quantityBaseUnits,
      movement.deltaBaseUnits,
    ]),
    [
      ["beans", 36, 36],
      ["oat", 480, 480],
      ["syrup", 16, 16],
    ],
  );
  const committedReversal = {
    ...reversed.compensation,
    applicationState: "committed",
  };
  assert.throws(
    () =>
      planConsumptionCompensation(
        committed,
        { ...cancellation, commandId: "another-cancel" },
        actor,
        inventory,
        [reversed.compensation],
      ),
    /Only committed compensations/,
  );

  assert.equal(
    planConsumptionCompensation(committed, cancellation, actor, inventory, [
      committedReversal,
    ]).duplicate,
    true,
  );
  assert.deepEqual(
    planConsumptionCompensation(committed, cancellation, actor, inventory, [
      committedReversal,
    ]).movements,
    [],
  );
  assert.throws(
    () =>
      planConsumptionCompensation(
        committed,
        { ...cancellation, returnedLines: [{ lineId: "line-1", quantity: 3 }] },
        actor,
        inventory,
      ),
    /exceeds the recorded/,
  );
  assert.throws(
    () => planConsumptionCompensation(prepared, cancellation, actor, inventory),
    /committed first/,
  );
  const tamperedReversal = structuredClone(committedReversal);
  tamperedReversal.movements[0].quantityBaseUnits += 1;
  tamperedReversal.movements[0].deltaBaseUnits += 1;
  tamperedReversal.movements[0].sourceAllocations[0].quantityBaseUnits += 1;
  assert.throws(
    () =>
      planConsumptionCompensation(committed, cancellation, actor, inventory, [
        tamperedReversal,
      ]),
    /differs from recorded preparation consumption/,
  );
});

test("modifier-only shortages are visible before publication", () => {
  const draft = recipeDraft();
  draft.modifierEffects.find(
    (effect) => effect.optionId === "amareto",
  ).add[0].quantityText = "1001";
  const preview = previewRecipePublication(
    createRecipeCatalog(),
    productCatalog,
    inventoryFixture(),
    product.id,
    draft,
  );
  assert.ok(
    preview.baseConsumption.every((row) => row.projectedStockBaseUnits >= 0),
  );
  assert.ok(
    preview.warnings.some(
      (warning) =>
        warning.code === "insufficient_stock" &&
        warning.groupId === "shot" &&
        warning.optionId === "amareto" &&
        warning.itemId === "syrup",
    ),
  );
  assert.equal(preview.automaticConsumptionEligible, false);
});

test("self-consistent edited or omitted consumption cannot authorize retry or compensation", () => {
  const inventory = inventoryFixture();
  const empty = createRecipeCatalog();
  const catalog = publishRecipe(
    empty,
    publishCommand(empty, inventory, recipeDraft(), "recipe:tamper"),
    actor,
    productCatalog,
    inventory,
  ).catalog;
  const command = preparationCommand(inventory, catalog);
  const original = {
    ...planPreparationConsumption(
      catalog,
      productCatalog,
      inventory,
      command,
      actor,
    ).plan,
    applicationState: "committed",
  };
  for (const kind of ["inflate", "omit", "duplicate"]) {
    const edited = structuredClone(original);
    const movement = edited.movements[0];
    if (kind === "inflate") {
      movement.quantityBaseUnits += 2;
      movement.deltaBaseUnits -= 2;
      movement.sourceAllocations[0].quantityBaseUnits += 2;
      movement.sourceAllocations[0].perProductBaseUnits += 1;
    } else if (kind === "omit") {
      edited.movements.pop();
    } else {
      movement.sourceAllocations.push(
        structuredClone(movement.sourceAllocations[0]),
      );
      movement.quantityBaseUnits *= 2;
      movement.deltaBaseUnits *= 2;
    }
    assert.throws(
      () =>
        planPreparationConsumption(
          catalog,
          productCatalog,
          inventory,
          command,
          actor,
          [edited],
        ),
      /immutable recipe/,
    );
    assert.throws(
      () => planConsumptionCompensation(edited, {}, actor, inventory),
      /immutable recipe/,
    );
  }
});
