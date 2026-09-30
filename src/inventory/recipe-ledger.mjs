import { validateCatalog } from "../catalog/catalog-domain.mjs";
import {
  formatBaseUnits,
  inventorySummary,
  quantityToBaseUnits,
  validateInventoryState,
} from "./inventory-ledger.mjs";

const CONTROL_MODES = new Set(["recipe", "piece", "none"]);
const CONFIG_ROLES = new Set(["duena", "encargado"]);
const PREPARATION_ROLES = new Set(["duena", "encargado", "barra", "mesero"]);
const SCHEMA_VERSION = 1;
const MAX_RECIPE_EVENTS = 100_000;
const MAX_RECIPE_RECORDS = 20_000;
const MAX_PREPARATION_MOVEMENTS = 10_000;

export class RecipeLedgerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RecipeLedgerError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new RecipeLedgerError(code, message);
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function exact(value, fields, label) {
  if (!isRecord(value)) fail("invalid_record", `${label} must be a record.`);
  const keys = Object.keys(value);
  if (
    keys.length !== fields.length ||
    fields.some((field) => !Object.hasOwn(value, field))
  )
    fail("invalid_record", `${label} has missing or unsupported fields.`);
}

function text(value, label, max = 160) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    value !== value.trim()
  )
    fail(
      "invalid_text",
      `${label} must be trimmed text of at most ${max} characters.`,
    );
}

function integer(value, label, min = 0) {
  if (!Number.isSafeInteger(value) || value < min)
    fail("invalid_quantity", `${label} must be a safe integer >= ${min}.`);
}

function same(a, b) {
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => same(value, b[index]))
    );
  if (isRecord(a) || isRecord(b)) {
    if (!isRecord(a) || !isRecord(b)) return false;
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    return (
      aKeys.length === bKeys.length &&
      aKeys.every((key, index) => key === bKeys[index] && same(a[key], b[key]))
    );
  }
  return Object.is(a, b);
}

function assertCatalog(productCatalog) {
  const result = validateCatalog(productCatalog);
  if (result.errors.length)
    fail(
      "invalid_product_catalog",
      "The saved product catalog requires review.",
    );
  return productCatalog;
}

function assertInventory(inventoryState) {
  try {
    return validateInventoryState(inventoryState);
  } catch {
    fail("invalid_inventory", "The saved inventory ledger requires review.");
  }
}

function findProduct(productCatalog, productId) {
  const product = productCatalog.products.find((item) => item.id === productId);
  if (!product)
    fail(
      "unknown_product",
      "The selected product does not exist in the current catalog.",
    );
  if (!product.active)
    fail(
      "inactive_product",
      "Inactive products cannot receive a recipe mapping.",
    );
  return product;
}

function findItem(inventoryState, itemId) {
  const item = inventoryState.items.find(
    (candidate) => candidate.itemId === itemId,
  );
  if (!item)
    fail("unknown_item", "The selected inventory item does not exist.");
  if (item.archived)
    fail(
      "archived_item",
      "Archived inventory items cannot receive a recipe mapping.",
    );
  return item;
}

function modifierKey(groupId, optionId) {
  return JSON.stringify([groupId, optionId]);
}

function pairIsActiveForProduct(productCatalog, product, groupId, optionId) {
  if (!product.modifierGroupIds.includes(groupId)) return null;
  const group = productCatalog.modifierGroups.find(
    (candidate) => candidate.id === groupId && candidate.active,
  );
  const option = group?.options.find(
    (candidate) => candidate.id === optionId && candidate.active,
  );
  return group && option ? { group, option } : null;
}

function validateDraftShape(draft) {
  exact(
    draft,
    ["mode", "evidence", "items", "finishedGood", "modifierEffects"],
    "Recipe draft",
  );
  if (!CONTROL_MODES.has(draft.mode))
    fail(
      "invalid_mode",
      "Choose recipe, finished-piece, or no-stock control explicitly.",
    );
  text(draft.evidence, "Recipe evidence", 250);
  if (!Array.isArray(draft.items) || draft.items.length > 120)
    fail(
      "invalid_recipe",
      "Recipe items must be an array with at most 120 rows.",
    );
  if (
    !Array.isArray(draft.modifierEffects) ||
    draft.modifierEffects.length > 500
  )
    fail(
      "invalid_recipe",
      "Modifier mappings must be an array with at most 500 rows.",
    );
  if (draft.finishedGood !== null)
    validateDraftLine(draft.finishedGood, "Finished product");
  for (const line of draft.items) validateDraftLine(line, "Recipe item");
  const itemIds = draft.items.map((line) => line.itemId);
  if (new Set(itemIds).size !== itemIds.length)
    fail(
      "duplicate_item",
      "Each inventory item may appear once in the base recipe.",
    );
  const effectKeys = new Set();
  for (const effect of draft.modifierEffects) {
    exact(
      effect,
      ["groupId", "optionId", "effect", "remove", "add"],
      "Modifier mapping",
    );
    text(effect.groupId, "Modifier group id", 120);
    text(effect.optionId, "Modifier option id", 120);
    if (!new Set(["none", "add", "substitute"]).has(effect.effect))
      fail(
        "invalid_modifier_effect",
        "Modifier effect must explicitly leave stock unchanged, add stock, or substitute recipe items.",
      );
    if (!Array.isArray(effect.remove) || !Array.isArray(effect.add))
      fail("invalid_modifier_effect", "Modifier stock changes must be arrays.");
    if (effect.remove.length > 120 || effect.add.length > 120)
      fail(
        "invalid_modifier_effect",
        "Each modifier effect supports at most 120 stock rows.",
      );
    for (const line of [...effect.remove, ...effect.add])
      validateDraftLine(line, "Modifier stock item");
    const key = modifierKey(effect.groupId, effect.optionId);
    if (effectKeys.has(key))
      fail(
        "duplicate_modifier",
        "Each modifier group and option pair may be mapped once.",
      );
    effectKeys.add(key);
    if (effect.effect === "none" && (effect.add.length || effect.remove.length))
      fail(
        "invalid_modifier_effect",
        "A no-stock-effect modifier cannot add or remove inventory items.",
      );
    if (effect.effect === "add" && (!effect.add.length || effect.remove.length))
      fail(
        "invalid_modifier_effect",
        "An additive modifier needs additions and no removals.",
      );
    if (
      effect.effect === "substitute" &&
      (!effect.add.length || !effect.remove.length)
    )
      fail(
        "invalid_modifier_effect",
        "A substitution needs both the removed and replacement items.",
      );
  }
  if (draft.mode === "recipe" && draft.items.length === 0)
    fail(
      "incomplete_recipe",
      "A controlled recipe needs at least one explicitly mapped inventory item.",
    );
  if (draft.mode === "piece" && !draft.finishedGood)
    fail(
      "incomplete_recipe",
      "Finished-piece control needs an explicitly mapped finished-good item.",
    );
  if (draft.mode === "piece" && draft.items.length)
    fail(
      "invalid_recipe",
      "Piece control uses one finished-good item and no base ingredient recipe.",
    );
  if (
    draft.mode === "piece" &&
    draft.modifierEffects.some((effect) => effect.remove.length)
  )
    fail(
      "invalid_recipe",
      "Piece control can add modifier consumption but cannot substitute a finished piece.",
    );
  if (
    draft.mode === "none" &&
    (draft.items.length || draft.finishedGood || draft.modifierEffects.length)
  )
    fail(
      "invalid_recipe",
      "Products marked as not stock-controlled cannot include consumption mappings.",
    );
}

function validateDraftLine(line, label) {
  exact(line, ["itemId", "quantityText", "unit"], label);
  text(line.itemId, `${label} item id`, 100);
  if (
    typeof line.quantityText !== "string" ||
    line.quantityText.length > 32 ||
    line.quantityText !== line.quantityText.trim()
  )
    fail(
      "invalid_quantity",
      `${label} quantity must be trimmed text up to 32 characters.`,
    );
  text(line.unit, `${label} unit`, 16);
}

function captureItemLine(draftLine, inventoryState, expectedKind = null) {
  const item = findItem(inventoryState, draftLine.itemId);
  if (expectedKind && item.kind !== expectedKind)
    fail("item_kind_mismatch", `Item ${item.itemId} must be ${expectedKind}.`);
  if (!expectedKind && !["Ingrediente", "Insumo"].includes(item.kind))
    fail(
      "item_kind_mismatch",
      "Recipe ingredients must reference an Ingrediente or Insumo item.",
    );
  if (expectedKind === "Producto terminado" && item.baseUnit !== "pz")
    fail("unit_mismatch", "Finished goods must use the pz base unit.");
  const quantityBaseUnits = quantityToBaseUnits(
    draftLine.quantityText,
    draftLine.unit,
    item.baseUnit,
  );
  return {
    itemId: item.itemId,
    itemNameSnapshot: item.name,
    itemKindSnapshot: item.kind,
    baseUnitSnapshot: item.baseUnit,
    displayUnitSnapshot: item.displayUnit,
    quantityText: draftLine.quantityText,
    unitSnapshot: draftLine.unit,
    quantityBaseUnits,
    itemRevision: item.revision,
    itemCatalogRevision: item.catalogRevision ?? 0,
    provenance: item.provenance,
  };
}

const SNAPSHOT_LINE_FIELDS = [
  "itemId",
  "itemNameSnapshot",
  "itemKindSnapshot",
  "baseUnitSnapshot",
  "displayUnitSnapshot",
  "quantityText",
  "unitSnapshot",
  "quantityBaseUnits",
  "itemRevision",
  "itemCatalogRevision",
  "provenance",
];

function validateSnapshotLine(line, expectedKind = null) {
  exact(line, SNAPSHOT_LINE_FIELDS, "Saved recipe item snapshot");
  text(line.itemId, "Recipe item id", 100);
  text(line.itemNameSnapshot, "Recipe item name snapshot", 120);
  if (
    !["Ingrediente", "Insumo", "Producto terminado"].includes(
      line.itemKindSnapshot,
    )
  )
    fail("invalid_recipe_history", "Saved recipe item type is invalid.");
  if (expectedKind && line.itemKindSnapshot !== expectedKind)
    fail(
      "invalid_recipe_history",
      "Saved recipe item type does not match its mapping.",
    );
  if (
    !new Set(["g", "ml", "pz"]).has(line.baseUnitSnapshot) ||
    !new Set(["synthetic-seed-unverified", "operator-count"]).has(
      line.provenance,
    )
  )
    fail(
      "invalid_recipe_history",
      "Saved recipe item units or provenance are invalid.",
    );
  text(line.displayUnitSnapshot, "Recipe item display unit", 16);
  text(line.unitSnapshot, "Recipe item unit", 16);
  if (
    typeof line.quantityText !== "string" ||
    line.quantityText.length > 32 ||
    line.quantityText !== line.quantityText.trim()
  )
    fail("invalid_recipe_history", "Saved recipe quantity text is invalid.");
  integer(line.quantityBaseUnits, "Recipe item quantity", 1);
  integer(line.itemRevision, "Recipe item revision");
  integer(line.itemCatalogRevision, "Recipe item catalog revision");
  let quantity;
  try {
    quantity = quantityToBaseUnits(
      line.quantityText,
      line.unitSnapshot,
      line.baseUnitSnapshot,
    );
  } catch {
    fail(
      "invalid_recipe_history",
      "Saved recipe quantity does not match its unit snapshot.",
    );
  }
  if (quantity !== line.quantityBaseUnits)
    fail(
      "invalid_recipe_history",
      "Saved recipe quantity text does not match its base-unit quantity.",
    );
}

function snapshotFromDraft(
  recipeCatalog,
  productCatalog,
  inventoryState,
  product,
  draft,
) {
  validateDraftShape(draft);
  const baseItems = draft.items.map((line) =>
    captureItemLine(line, inventoryState),
  );
  const finishedGood = draft.finishedGood
    ? captureItemLine(draft.finishedGood, inventoryState, "Producto terminado")
    : null;
  const baseIds = new Set(baseItems.map((line) => line.itemId));
  if (finishedGood && baseIds.has(finishedGood.itemId))
    fail(
      "duplicate_item",
      "A finished-good item cannot also appear as an ingredient.",
    );
  const modifierEffects = draft.modifierEffects.map((effect) => {
    const source = pairIsActiveForProduct(
      productCatalog,
      product,
      effect.groupId,
      effect.optionId,
    );
    if (!source)
      fail(
        "modifier_not_configured",
        "Modifier mappings must use an active group and option attached to this exact product.",
      );
    if (effect.effect === "substitute" && source.group.selection.max > 1)
      fail(
        "ambiguous_substitution",
        "Substitutions require a modifier group that allows at most one selected option.",
      );
    const remove = effect.remove.map((line) =>
      captureItemLine(line, inventoryState),
    );
    const add = effect.add.map((line) => captureItemLine(line, inventoryState));
    for (const line of remove) {
      if (!baseIds.has(line.itemId))
        fail(
          "invalid_substitution",
          "A modifier may only replace an item in the explicit base recipe.",
        );
    }
    return {
      groupId: source.group.id,
      groupNameSnapshot: source.group.name,
      optionId: source.option.id,
      optionNameSnapshot: source.option.name,
      effect: effect.effect,
      remove,
      add,
    };
  });
  return {
    productId: product.id,
    productNameSnapshot: product.name,
    productCatalogRevision: productCatalog.revision,
    productSourceKind: product.source.kind,
    productSourcePath: product.source.path,
    catalogStockControlMode: product.stockControl.mode,
    catalogStockControlValidated: product.stockControl.validated,
    catalogStockControlEvidence: product.stockControl.evidence,
    inventoryCatalogRevision: inventoryState.catalogRevision ?? 0,
    sourceInventoryRevision: inventoryState.revision,
    recipeRevision:
      (recipeCatalog.recipes.find((recipe) => recipe.productId === product.id)
        ?.recipeRevision || 0) + 1,
    mode: draft.mode,
    evidence: draft.evidence,
    provenance: "operator-configured-unverified",
    items: baseItems,
    finishedGood,
    modifierEffects,
  };
}

const SNAPSHOT_FIELDS = [
  "productId",
  "productNameSnapshot",
  "productCatalogRevision",
  "productSourceKind",
  "productSourcePath",
  "catalogStockControlMode",
  "catalogStockControlValidated",
  "catalogStockControlEvidence",
  "inventoryCatalogRevision",
  "sourceInventoryRevision",
  "recipeRevision",
  "mode",
  "evidence",
  "provenance",
  "items",
  "finishedGood",
  "modifierEffects",
];

function validateRecipeSnapshot(snapshot) {
  exact(snapshot, SNAPSHOT_FIELDS, "Saved recipe snapshot");
  text(snapshot.productId, "Recipe product id", 120);
  text(snapshot.productNameSnapshot, "Recipe product name snapshot", 160);
  integer(snapshot.productCatalogRevision, "Product catalog revision", 1);
  text(snapshot.productSourceKind, "Product source kind", 80);
  text(snapshot.productSourcePath, "Product source path", 240);
  if (
    !["recipe", "piece", "none", "unknown"].includes(
      snapshot.catalogStockControlMode,
    )
  )
    fail(
      "invalid_recipe_history",
      "Catalog stock-control snapshot is invalid.",
    );
  if (typeof snapshot.catalogStockControlValidated !== "boolean")
    fail(
      "invalid_recipe_history",
      "Catalog stock-control validation snapshot is invalid.",
    );
  text(
    snapshot.catalogStockControlEvidence,
    "Catalog stock-control evidence",
    250,
  );
  integer(snapshot.inventoryCatalogRevision, "Inventory catalog revision");
  integer(snapshot.sourceInventoryRevision, "Inventory source revision");
  integer(snapshot.recipeRevision, "Recipe revision", 1);
  if (!CONTROL_MODES.has(snapshot.mode))
    fail("invalid_recipe_history", "Saved recipe mode is invalid.");
  text(snapshot.evidence, "Recipe evidence", 250);
  if (snapshot.provenance !== "operator-configured-unverified")
    fail(
      "invalid_recipe_history",
      "Recipe configuration cannot claim verified source provenance.",
    );
  if (
    !Array.isArray(snapshot.items) ||
    !Array.isArray(snapshot.modifierEffects) ||
    snapshot.items.length > 120 ||
    snapshot.modifierEffects.length > 500
  )
    fail("invalid_recipe_history", "Saved recipe rows are invalid.");
  for (const line of snapshot.items) validateSnapshotLine(line);
  if (
    new Set(snapshot.items.map((line) => line.itemId)).size !==
    snapshot.items.length
  )
    fail(
      "invalid_recipe_history",
      "Saved base recipe item ids must be unique.",
    );
  if (snapshot.finishedGood !== null)
    validateSnapshotLine(snapshot.finishedGood, "Producto terminado");
  if (snapshot.finishedGood && snapshot.finishedGood.baseUnitSnapshot !== "pz")
    fail("invalid_recipe_history", "Finished-good mappings must use pz.");
  const baseIds = new Set(snapshot.items.map((line) => line.itemId));
  const pairs = new Set();
  for (const effect of snapshot.modifierEffects) {
    exact(
      effect,
      [
        "groupId",
        "groupNameSnapshot",
        "optionId",
        "optionNameSnapshot",
        "effect",
        "remove",
        "add",
      ],
      "Saved recipe modifier snapshot",
    );
    text(effect.groupId, "Recipe modifier group id", 120);
    text(effect.groupNameSnapshot, "Recipe modifier group name", 120);
    text(effect.optionId, "Recipe modifier option id", 120);
    text(effect.optionNameSnapshot, "Recipe modifier option name", 120);
    if (!new Set(["none", "add", "substitute"]).has(effect.effect))
      fail(
        "invalid_recipe_history",
        "Saved recipe modifier effect is invalid.",
      );
    if (!Array.isArray(effect.remove) || !Array.isArray(effect.add))
      fail(
        "invalid_recipe_history",
        "Saved recipe modifier item rows are invalid.",
      );
    if (effect.remove.length > 120 || effect.add.length > 120)
      fail(
        "invalid_recipe_history",
        "Saved recipe modifier item rows exceed supported limits.",
      );
    for (const line of [...effect.remove, ...effect.add])
      validateSnapshotLine(line);
    if (effect.remove.some((line) => !baseIds.has(line.itemId)))
      fail(
        "invalid_recipe_history",
        "Saved substitution removes a non-recipe item.",
      );
    const key = modifierKey(effect.groupId, effect.optionId);
    if (pairs.has(key))
      fail("invalid_recipe_history", "Saved modifier pairs must be unique.");
    pairs.add(key);
    if (
      (effect.effect === "none" &&
        (effect.add.length || effect.remove.length)) ||
      (effect.effect === "add" &&
        (!effect.add.length || effect.remove.length)) ||
      (effect.effect === "substitute" &&
        (!effect.add.length || !effect.remove.length))
    )
      fail(
        "invalid_recipe_history",
        "Saved modifier stock rows do not match the effect type.",
      );
  }
  if (
    (snapshot.mode === "recipe" && !snapshot.items.length) ||
    (snapshot.mode === "piece" &&
      (!snapshot.finishedGood ||
        snapshot.items.length ||
        snapshot.modifierEffects.some((effect) => effect.remove.length))) ||
    (snapshot.mode === "none" &&
      (snapshot.items.length ||
        snapshot.finishedGood ||
        snapshot.modifierEffects.length))
  )
    fail(
      "invalid_recipe_history",
      "Saved recipe mappings do not match their control mode.",
    );
}

export function createRecipeCatalog() {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    recipes: [],
    events: [],
  };
}

function validatePublishCommand(command) {
  exact(
    command,
    [
      "commandId",
      "productId",
      "expectedRecipeCatalogRevision",
      "expectedRecipeRevision",
      "expectedProductCatalogRevision",
      "expectedInventoryRevision",
      "expectedInventoryCatalogRevision",
      "actorId",
      "actorName",
      "roleSnapshot",
      "occurredAt",
      "reason",
      "draft",
      "preview",
    ],
    "Recipe publication command",
  );
  text(command.commandId, "Recipe command id", 160);
  text(command.productId, "Recipe product id", 120);
  integer(command.expectedRecipeCatalogRevision, "Recipe catalog revision");
  integer(command.expectedRecipeRevision, "Recipe revision");
  integer(
    command.expectedProductCatalogRevision,
    "Product catalog revision",
    1,
  );
  integer(command.expectedInventoryRevision, "Inventory revision");
  integer(
    command.expectedInventoryCatalogRevision,
    "Inventory catalog revision",
  );
  text(command.actorId, "Recipe actor id", 100);
  text(command.actorName, "Recipe actor name", 120);
  if (!CONFIG_ROLES.has(command.roleSnapshot))
    fail(
      "not_authorized",
      "Only Dueña or Encargado can publish recipe mappings.",
    );
  if (
    typeof command.occurredAt !== "string" ||
    !Number.isFinite(Date.parse(command.occurredAt))
  )
    fail("invalid_timestamp", "Recipe timestamp is invalid.");
  text(command.reason, "Recipe change reason", 250);
  validateDraftShape(command.draft);
  validatePreview(command.preview);
}

function validatePreview(preview) {
  exact(
    preview,
    [
      "schemaVersion",
      "recipeCatalogRevision",
      "productCatalogRevision",
      "inventoryRevision",
      "inventoryCatalogRevision",
      "recipeSnapshot",
      "baseConsumption",
      "modifierScenarios",
      "warnings",
      "complete",
      "automaticConsumptionEligible",
      "orderFlowBlocked",
    ],
    "Recipe preview",
  );
  if (preview.schemaVersion !== SCHEMA_VERSION)
    fail("invalid_preview", "Recipe preview version is invalid.");
  integer(preview.recipeCatalogRevision, "Preview recipe revision");
  integer(
    preview.productCatalogRevision,
    "Preview product catalog revision",
    1,
  );
  integer(preview.inventoryRevision, "Preview inventory revision");
  integer(
    preview.inventoryCatalogRevision,
    "Preview inventory catalog revision",
  );
  validateRecipeSnapshot(preview.recipeSnapshot);
  if (
    !Array.isArray(preview.baseConsumption) ||
    !Array.isArray(preview.modifierScenarios) ||
    !Array.isArray(preview.warnings)
  )
    fail("invalid_preview", "Recipe preview rows are invalid.");
  if (
    preview.baseConsumption.length > 240 ||
    preview.modifierScenarios.length > 500 ||
    preview.warnings.length > 10_000
  )
    fail("invalid_preview", "Recipe preview exceeds supported row limits.");
  for (const usage of preview.baseConsumption) validateUsageSnapshot(usage);
  if (
    !usageRowsMatch(
      preview.baseConsumption,
      buildUsageMap(preview.recipeSnapshot, [], 1),
    )
  )
    fail(
      "invalid_preview",
      "Base preview quantities do not match the saved recipe snapshot.",
    );
  if (
    preview.modifierScenarios.length !==
    preview.recipeSnapshot.modifierEffects.length
  )
    fail(
      "invalid_preview",
      "Modifier scenarios must match every saved modifier mapping.",
    );
  const scenarioPairs = new Set();
  for (const scenario of preview.modifierScenarios) {
    exact(
      scenario,
      [
        "groupId",
        "groupNameSnapshot",
        "optionId",
        "optionNameSnapshot",
        "effect",
        "consumption",
      ],
      "Recipe modifier preview",
    );
    text(scenario.groupId, "Preview group id", 120);
    text(scenario.groupNameSnapshot, "Preview group name", 120);
    text(scenario.optionId, "Preview option id", 120);
    text(scenario.optionNameSnapshot, "Preview option name", 120);
    if (!new Set(["none", "add", "substitute"]).has(scenario.effect))
      fail("invalid_preview", "Preview modifier effect is invalid.");
    if (!Array.isArray(scenario.consumption))
      fail("invalid_preview", "Preview consumption rows are invalid.");
    if (scenario.consumption.length > 240)
      fail(
        "invalid_preview",
        "Modifier scenario exceeds supported row limits.",
      );
    for (const usage of scenario.consumption) validateUsageSnapshot(usage);
    const key = modifierKey(scenario.groupId, scenario.optionId);
    const effect = preview.recipeSnapshot.modifierEffects.find(
      (candidate) =>
        candidate.groupId === scenario.groupId &&
        candidate.optionId === scenario.optionId,
    );
    if (
      !effect ||
      scenarioPairs.has(key) ||
      effect.groupNameSnapshot !== scenario.groupNameSnapshot ||
      effect.optionNameSnapshot !== scenario.optionNameSnapshot ||
      effect.effect !== scenario.effect ||
      !usageRowsMatch(
        scenario.consumption,
        buildUsageMap(preview.recipeSnapshot, [scenario], 1),
      )
    )
      fail(
        "invalid_preview",
        "Modifier scenario quantities do not match their saved modifier mapping.",
      );
    scenarioPairs.add(key);
  }
  for (const warning of preview.warnings) {
    exact(
      warning,
      ["code", "message", "itemId", "groupId", "optionId"],
      "Recipe warning",
    );
    text(warning.code, "Preview warning code", 80);
    text(warning.message, "Preview warning message", 250);
    for (const field of ["itemId", "groupId", "optionId"])
      if (warning[field] !== null)
        text(warning[field], `Preview warning ${field}`, 120);
  }
  if (
    typeof preview.complete !== "boolean" ||
    typeof preview.automaticConsumptionEligible !== "boolean" ||
    preview.orderFlowBlocked !== false
  )
    fail("invalid_preview", "Recipe preview readiness flags are invalid.");
}

function validateUsageSnapshot(usage) {
  exact(
    usage,
    [
      "itemId",
      "itemNameSnapshot",
      "itemKindSnapshot",
      "baseUnitSnapshot",
      "quantityBaseUnits",
      "formattedQuantity",
      "currentStockBaseUnits",
      "projectedStockBaseUnits",
      "stockProvenance",
    ],
    "Recipe consumption preview row",
  );
  text(usage.itemId, "Preview item id", 100);
  text(usage.itemNameSnapshot, "Preview item name", 120);
  if (
    !["Ingrediente", "Insumo", "Producto terminado"].includes(
      usage.itemKindSnapshot,
    )
  )
    fail("invalid_preview", "Preview item type is invalid.");
  if (!["g", "ml", "pz"].includes(usage.baseUnitSnapshot))
    fail("invalid_preview", "Preview item unit is invalid.");
  integer(usage.quantityBaseUnits, "Preview item quantity", 1);
  text(usage.formattedQuantity, "Preview formatted quantity", 40);
  integer(usage.currentStockBaseUnits, "Preview current stock");
  if (
    !Number.isSafeInteger(usage.projectedStockBaseUnits) ||
    usage.projectedStockBaseUnits !==
      usage.currentStockBaseUnits - usage.quantityBaseUnits ||
    usage.formattedQuantity !==
      formatBaseUnits(usage.quantityBaseUnits, usage.baseUnitSnapshot)
  )
    fail("invalid_preview", "Preview projected stock is invalid.");
  if (
    !new Set(["synthetic-seed-unverified", "operator-count"]).has(
      usage.stockProvenance,
    )
  )
    fail("invalid_preview", "Preview stock provenance is invalid.");
}

function usageRowsMatch(rows, expected) {
  return (
    rows.length === expected.length &&
    rows.every((row, index) => {
      const line = expected[index].line;
      return (
        row.itemId === line.itemId &&
        row.itemNameSnapshot === line.itemNameSnapshot &&
        row.itemKindSnapshot === line.itemKindSnapshot &&
        row.baseUnitSnapshot === line.baseUnitSnapshot &&
        row.quantityBaseUnits === expected[index].quantityBaseUnits
      );
    })
  );
}

function latestRecipe(recipes, productId) {
  return recipes.find((recipe) => recipe.productId === productId) || null;
}

export function validateRecipeCatalog(input) {
  if (!isRecord(input))
    fail("invalid_recipe_catalog", "Saved recipe catalog must be a record.");
  exact(
    input,
    ["schemaVersion", "revision", "recipes", "events"],
    "Saved recipe catalog",
  );
  if (input.schemaVersion !== SCHEMA_VERSION)
    fail(
      "invalid_recipe_catalog",
      "Saved recipe catalog version is unsupported.",
    );
  integer(input.revision, "Recipe catalog revision");
  if (!Array.isArray(input.recipes) || !Array.isArray(input.events))
    fail(
      "invalid_recipe_catalog",
      "Saved recipe catalog collections are invalid.",
    );
  if (
    input.recipes.length > MAX_RECIPE_RECORDS ||
    input.events.length > MAX_RECIPE_EVENTS
  )
    fail(
      "invalid_recipe_catalog",
      "Saved recipe catalog exceeds supported history limits.",
    );
  if (input.revision !== input.events.length)
    fail(
      "invalid_recipe_history",
      "Recipe catalog revision does not match its history.",
    );
  const current = [];
  const commandIds = new Set();
  for (let index = 0; index < input.events.length; index += 1) {
    const event = input.events[index];
    exact(
      event,
      ["catalogRevision", "recipeRevision", "command", "before", "after"],
      "Saved recipe event",
    );
    if (event.catalogRevision !== index + 1)
      fail(
        "invalid_recipe_history",
        "Recipe event revisions must be sequential.",
      );
    validatePublishCommand(event.command);
    if (commandIds.has(event.command.commandId))
      fail("invalid_recipe_history", "Recipe command ids must be unique.");
    commandIds.add(event.command.commandId);
    const prior = latestRecipe(current, event.command.productId);
    if (!same(event.before, prior))
      fail(
        "invalid_recipe_history",
        "Recipe event before-snapshot does not match prior history.",
      );
    validateRecipeSnapshot(event.after);
    const expectedVersion = (prior?.recipeRevision || 0) + 1;
    if (
      event.catalogRevision !==
        event.command.expectedRecipeCatalogRevision + 1 ||
      event.recipeRevision !== expectedVersion ||
      event.after.recipeRevision !== expectedVersion ||
      event.after.productId !== event.command.productId ||
      event.command.expectedRecipeRevision !== expectedVersion - 1 ||
      !same(event.command.preview.recipeSnapshot, event.after) ||
      event.command.expectedProductCatalogRevision !==
        event.after.productCatalogRevision ||
      event.command.expectedInventoryRevision !==
        event.after.sourceInventoryRevision ||
      event.command.expectedInventoryCatalogRevision !==
        event.after.inventoryCatalogRevision
    )
      fail(
        "invalid_recipe_history",
        "Recipe event revisions or published snapshot do not match its command.",
      );
    if (prior) current.splice(current.indexOf(prior), 1);
    current.push(event.after);
  }
  current.sort((a, b) => a.productId.localeCompare(b.productId));
  if (!same(input.recipes, current))
    fail(
      "invalid_recipe_history",
      "Current recipes do not match immutable publication history.",
    );
  return clone(input);
}

function sourceRevisions(recipeCatalog, productCatalog, inventoryState) {
  return {
    recipeCatalogRevision: recipeCatalog.revision,
    productCatalogRevision: productCatalog.revision,
    inventoryRevision: inventoryState.revision,
    inventoryCatalogRevision: inventoryState.catalogRevision ?? 0,
  };
}

function buildUsageMap(snapshot, modifiers, productQuantity) {
  const quantities = new Map();
  const add = (line, signedQuantity, basis) => {
    const perProduct = signedQuantity;
    const amount = perProduct * productQuantity;
    if (!Number.isSafeInteger(amount))
      fail(
        "unsafe_quantity",
        "Recipe consumption exceeds the safe integer range.",
      );
    const current = quantities.get(line.itemId) || {
      line,
      perProductBaseUnits: 0,
      quantityBaseUnits: 0,
      bases: [],
    };
    const nextPerProduct = current.perProductBaseUnits + perProduct;
    const nextTotal = current.quantityBaseUnits + amount;
    if (
      !Number.isSafeInteger(nextPerProduct) ||
      !Number.isSafeInteger(nextTotal)
    )
      fail(
        "unsafe_quantity",
        "Recipe consumption exceeds the safe integer range.",
      );
    current.perProductBaseUnits = nextPerProduct;
    current.quantityBaseUnits = nextTotal;
    current.bases.push({ basis, perProductBaseUnits: perProduct });
    quantities.set(line.itemId, current);
  };
  if (snapshot.mode === "recipe") {
    for (const line of snapshot.items)
      add(line, line.quantityBaseUnits, "base_recipe");
    if (snapshot.finishedGood)
      add(
        snapshot.finishedGood,
        snapshot.finishedGood.quantityBaseUnits,
        "finished_good",
      );
  } else if (snapshot.mode === "piece" && snapshot.finishedGood) {
    add(
      snapshot.finishedGood,
      snapshot.finishedGood.quantityBaseUnits,
      "finished_good",
    );
  }
  const effects = new Map(
    snapshot.modifierEffects.map((effect) => [
      modifierKey(effect.groupId, effect.optionId),
      effect,
    ]),
  );
  for (const modifier of modifiers) {
    const effect = effects.get(
      modifierKey(modifier.groupId, modifier.optionId),
    );
    if (!effect) continue;
    const modifierQuantity = modifier.quantity ?? 1;
    integer(modifierQuantity, "Captured modifier quantity", 1);
    for (const line of effect.remove)
      add(
        line,
        -line.quantityBaseUnits * modifierQuantity,
        "modifier_substitution",
      );
    for (const line of effect.add)
      add(line, line.quantityBaseUnits * modifierQuantity, "modifier_addition");
  }
  for (const [itemId, current] of quantities) {
    if (current.quantityBaseUnits < 0 || current.perProductBaseUnits < 0)
      fail(
        "invalid_substitution",
        `Modifier substitutions exceed the configured base quantity for ${itemId}.`,
      );
  }
  return [...quantities.values()].filter(
    (entry) => entry.quantityBaseUnits > 0,
  );
}

function stockRows(consumption, inventoryState, stocks) {
  return consumption.map(({ line, quantityBaseUnits }) => {
    const item = inventoryState.items.find(
      (candidate) => candidate.itemId === line.itemId,
    );
    const stockBaseUnits = stocks.get(line.itemId) ?? 0;
    return {
      itemId: line.itemId,
      itemNameSnapshot: line.itemNameSnapshot,
      itemKindSnapshot: line.itemKindSnapshot,
      baseUnitSnapshot: line.baseUnitSnapshot,
      quantityBaseUnits,
      formattedQuantity: formatBaseUnits(
        quantityBaseUnits,
        line.baseUnitSnapshot,
      ),
      currentStockBaseUnits: stockBaseUnits,
      projectedStockBaseUnits: stockBaseUnits - quantityBaseUnits,
      stockProvenance: item?.provenance || line.provenance,
    };
  });
}

function warningsForSnapshot(
  snapshot,
  productCatalog,
  inventoryState,
  baseConsumption,
) {
  const warnings = [];
  const product = productCatalog.products.find(
    (item) => item.id === snapshot.productId,
  );
  if (!productCatalog.importGate.readyForValidatedBusinessUse)
    warnings.push({
      code: "product_catalog_unverified",
      message:
        "El catálogo de producto aún no está validado para uso comercial.",
      itemId: null,
      groupId: null,
      optionId: null,
    });
  if (!product?.stockControl.validated)
    warnings.push({
      code: "product_stock_mapping_unverified",
      message:
        "La clasificación de control de stock del producto sigue sin validar.",
      itemId: null,
      groupId: null,
      optionId: null,
    });
  if (
    product &&
    product.stockControl.mode !== "unknown" &&
    product.stockControl.mode !== snapshot.mode
  )
    warnings.push({
      code: "stock_control_mismatch",
      message:
        "La receta no coincide con la clasificación de control de inventario del catálogo.",
      itemId: null,
      groupId: null,
      optionId: null,
    });
  const mappedPairs = new Set(
    snapshot.modifierEffects.map((effect) =>
      modifierKey(effect.groupId, effect.optionId),
    ),
  );
  if (["recipe", "piece"].includes(snapshot.mode) && product) {
    for (const groupId of product.modifierGroupIds) {
      const group = productCatalog.modifierGroups.find(
        (candidate) => candidate.id === groupId && candidate.active,
      );
      for (const option of group?.options.filter(
        (candidate) => candidate.active,
      ) || []) {
        if (!mappedPairs.has(modifierKey(group.id, option.id)))
          warnings.push({
            code: "modifier_unmapped",
            message: `Falta consumo configurado para ${group.name}: ${option.name}.`,
            itemId: null,
            groupId: group.id,
            optionId: option.id,
          });
      }
    }
  }
  const itemIds = new Set([
    ...snapshot.items.map((item) => item.itemId),
    ...(snapshot.finishedGood ? [snapshot.finishedGood.itemId] : []),
    ...snapshot.modifierEffects.flatMap((effect) =>
      [...effect.remove, ...effect.add].map((item) => item.itemId),
    ),
  ]);
  for (const itemId of itemIds) {
    const item = inventoryState.items.find(
      (candidate) => candidate.itemId === itemId,
    );
    if (item?.provenance !== "operator-count")
      warnings.push({
        code: "stock_unverified",
        message: `La existencia de ${item?.name || itemId} no tiene un conteo verificado.`,
        itemId,
        groupId: null,
        optionId: null,
      });
  }
  for (const usage of baseConsumption) {
    if (usage.projectedStockBaseUnits < 0)
      warnings.push({
        code: "insufficient_stock",
        message: `La vista previa deja existencia negativa para ${usage.itemNameSnapshot}.`,
        itemId: usage.itemId,
        groupId: null,
        optionId: null,
      });
  }
  if (snapshot.mode === "none")
    warnings.push({
      code: "not_stock_controlled",
      message:
        "Este producto se configuró explícitamente sin control de inventario.",
      itemId: null,
      groupId: null,
      optionId: null,
    });
  return warnings;
}

export function previewRecipePublication(
  recipeCatalogInput,
  productCatalogInput,
  inventoryStateInput,
  productId,
  draft,
) {
  const recipeCatalog = validateRecipeCatalog(recipeCatalogInput);
  const productCatalog = assertCatalog(productCatalogInput);
  const inventoryState = assertInventory(inventoryStateInput);
  text(productId, "Recipe product id", 120);
  const product = findProduct(productCatalog, productId);
  const recipeSnapshot = snapshotFromDraft(
    recipeCatalog,
    productCatalog,
    inventoryState,
    product,
    draft,
  );
  const stocks = new Map(
    inventorySummary(inventoryState).map((item) => [
      item.itemId,
      item.stockBaseUnits,
    ]),
  );
  const baseConsumption = stockRows(
    buildUsageMap(recipeSnapshot, [], 1),
    inventoryState,
    stocks,
  );
  const modifierScenarios = recipeSnapshot.modifierEffects.map((effect) => ({
    groupId: effect.groupId,
    groupNameSnapshot: effect.groupNameSnapshot,
    optionId: effect.optionId,
    optionNameSnapshot: effect.optionNameSnapshot,
    effect: effect.effect,
    consumption: stockRows(
      buildUsageMap(
        recipeSnapshot,
        [{ groupId: effect.groupId, optionId: effect.optionId }],
        1,
      ),
      inventoryState,
      stocks,
    ),
  }));
  const warnings = warningsForSnapshot(
    recipeSnapshot,
    productCatalog,
    inventoryState,
    baseConsumption,
  );
  for (const scenario of modifierScenarios) {
    for (const usage of scenario.consumption) {
      if (usage.projectedStockBaseUnits < 0)
        warnings.push({
          code: "insufficient_stock",
          message: `La opción ${scenario.optionNameSnapshot} deja existencia negativa para ${usage.itemNameSnapshot}.`,
          itemId: usage.itemId,
          groupId: scenario.groupId,
          optionId: scenario.optionId,
        });
    }
  }

  const revisions = sourceRevisions(
    recipeCatalog,
    productCatalog,
    inventoryState,
  );
  const complete = !warnings.some((warning) =>
    ["modifier_unmapped", "stock_control_mismatch"].includes(warning.code),
  );
  const automaticConsumptionEligible =
    recipeSnapshot.mode !== "none" && complete && warnings.length === 0;
  return {
    schemaVersion: SCHEMA_VERSION,
    ...revisions,
    recipeSnapshot,
    baseConsumption,
    modifierScenarios,
    warnings,
    complete,
    automaticConsumptionEligible,
    orderFlowBlocked: false,
  };
}

function authorityMatches(command, actor, allowedRoles) {
  if (
    !isRecord(actor) ||
    command.actorId !== actor.actorId ||
    command.roleSnapshot !== actor.role
  )
    fail(
      "not_authorized",
      "The current actor does not match the command identity.",
    );
  if (!allowedRoles.has(actor.role))
    fail(
      "not_authorized",
      "The current role cannot perform this recipe operation.",
    );
}

function cloneState(state) {
  return {
    schemaVersion: state.schemaVersion,
    revision: state.revision,
    recipes: state.recipes.map(clone),
    events: state.events.map((event) => ({
      ...event,
      command: clone(event.command),
      before: event.before ? clone(event.before) : null,
      after: clone(event.after),
    })),
  };
}

export function publishRecipe(
  recipeCatalogInput,
  command,
  actor,
  productCatalogInput,
  inventoryStateInput,
) {
  const recipeCatalog = validateRecipeCatalog(recipeCatalogInput);
  validatePublishCommand(command);
  authorityMatches(command, actor, CONFIG_ROLES);
  const duplicate = recipeCatalog.events.find(
    (event) => event.command.commandId === command.commandId,
  );
  if (duplicate) {
    if (!same(duplicate.command, command))
      fail(
        "command_conflict",
        "This recipe command id was reused with different content.",
      );
    return {
      catalog: recipeCatalog,
      event: duplicate,
      duplicate: true,
      changed: false,
    };
  }
  const productCatalog = assertCatalog(productCatalogInput);
  const inventoryState = assertInventory(inventoryStateInput);
  const expected = sourceRevisions(
    recipeCatalog,
    productCatalog,
    inventoryState,
  );
  if (
    command.expectedRecipeCatalogRevision !== expected.recipeCatalogRevision ||
    command.expectedProductCatalogRevision !==
      expected.productCatalogRevision ||
    command.expectedInventoryRevision !== expected.inventoryRevision ||
    command.expectedInventoryCatalogRevision !==
      expected.inventoryCatalogRevision
  )
    fail(
      "stale_source_revision",
      "A product, recipe, or inventory source changed after the preview.",
    );
  const current = latestRecipe(recipeCatalog.recipes, command.productId);
  if (command.expectedRecipeRevision !== (current?.recipeRevision || 0))
    fail(
      "stale_recipe_revision",
      "This product recipe changed after the editor opened.",
    );
  const preview = previewRecipePublication(
    recipeCatalog,
    productCatalog,
    inventoryState,
    command.productId,
    command.draft,
  );
  if (!same(preview, command.preview))
    fail(
      "stale_preview",
      "The recipe preview no longer matches current products, modifiers, inventory, and revisions.",
    );
  const before = current ? clone(current) : null;
  const after = clone(preview.recipeSnapshot);
  const next = cloneState(recipeCatalog);
  next.revision += 1;
  next.recipes = next.recipes.filter(
    (recipe) => recipe.productId !== after.productId,
  );
  next.recipes.push(after);
  next.recipes.sort((a, b) => a.productId.localeCompare(b.productId));
  const event = {
    catalogRevision: next.revision,
    recipeRevision: after.recipeRevision,
    command: clone(command),
    before,
    after: clone(after),
  };
  next.events.push(event);
  return {
    catalog: validateRecipeCatalog(next),
    event: next.events.at(-1),
    duplicate: false,
    changed: true,
  };
}

function validatePreparationLine(line) {
  exact(
    line,
    ["lineId", "productId", "productNameSnapshot", "quantity", "modifiers"],
    "Prepared order line",
  );
  text(line.lineId, "Prepared line id", 120);
  text(line.productId, "Prepared product id", 120);
  text(line.productNameSnapshot, "Captured product name", 160);
  integer(line.quantity, "Prepared product quantity", 1);
  if (!Array.isArray(line.modifiers) || line.modifiers.length > 500)
    fail("invalid_preparation", "Captured modifier snapshots are invalid.");
  const seen = new Set();
  for (const modifier of line.modifiers) {
    exact(
      modifier,
      ["groupId", "optionId", "quantity"],
      "Captured modifier snapshot",
    );
    text(modifier.groupId, "Captured modifier group id", 120);
    if (modifier.optionId !== null)
      text(modifier.optionId, "Captured modifier option id", 120);
    if (modifier.quantity !== null)
      integer(modifier.quantity, "Captured modifier quantity", 1);
    const key = modifierKey(modifier.groupId, modifier.optionId);
    if (seen.has(key))
      fail(
        "invalid_preparation",
        "Captured modifier pairs must be unique per line.",
      );
    seen.add(key);
  }
}

function validatePreparationCommand(command) {
  exact(
    command,
    [
      "commandId",
      "preparationId",
      "folio",
      "occurredAt",
      "actorId",
      "actorName",
      "roleSnapshot",
      "reason",
      "expectedRecipeCatalogRevision",
      "expectedProductCatalogRevision",
      "expectedInventoryRevision",
      "expectedInventoryCatalogRevision",
      "lines",
    ],
    "Preparation consumption command",
  );
  for (const field of [
    "commandId",
    "preparationId",
    "folio",
    "actorId",
    "actorName",
    "reason",
  ])
    text(
      command[field],
      `Preparation ${field}`,
      field === "reason" ? 250 : 160,
    );
  if (
    typeof command.occurredAt !== "string" ||
    !Number.isFinite(Date.parse(command.occurredAt))
  )
    fail("invalid_timestamp", "Preparation timestamp is invalid.");
  if (!PREPARATION_ROLES.has(command.roleSnapshot))
    fail("not_authorized", "Preparation actor role is invalid.");
  integer(command.expectedRecipeCatalogRevision, "Preparation recipe revision");
  integer(
    command.expectedProductCatalogRevision,
    "Preparation product catalog revision",
    1,
  );
  integer(command.expectedInventoryRevision, "Preparation inventory revision");
  integer(
    command.expectedInventoryCatalogRevision,
    "Preparation inventory catalog revision",
  );
  if (
    !Array.isArray(command.lines) ||
    command.lines.length === 0 ||
    command.lines.length > 500
  )
    fail(
      "invalid_preparation",
      "A preparation needs between one and 500 captured product lines.",
    );
  for (const line of command.lines) validatePreparationLine(line);
  if (
    new Set(command.lines.map((line) => line.lineId)).size !==
    command.lines.length
  )
    fail("invalid_preparation", "Prepared line ids must be unique.");
}

function validateUsageAllocation(allocation) {
  exact(
    allocation,
    [
      "lineId",
      "productId",
      "recipeRevision",
      "sourceItemNameSnapshot",
      "baseUnitSnapshot",
      "perProductBaseUnits",
      "quantityBaseUnits",
    ],
    "Consumption allocation",
  );
  text(allocation.lineId, "Consumption line id", 120);
  text(allocation.productId, "Consumption product id", 120);
  integer(allocation.recipeRevision, "Consumption recipe revision", 1);
  text(allocation.sourceItemNameSnapshot, "Consumption item name", 120);
  if (!["g", "ml", "pz"].includes(allocation.baseUnitSnapshot))
    fail("invalid_preparation", "Consumption allocation unit is invalid.");
  integer(
    allocation.perProductBaseUnits,
    "Consumption per-product quantity",
    1,
  );
  integer(allocation.quantityBaseUnits, "Consumption total quantity", 1);
}

function validatePreparationPlan(input) {
  exact(
    input,
    [
      "schemaVersion",
      "applicationState",
      "command",
      "lines",
      "movements",
      "warnings",
      "automaticConsumptionEligible",
      "orderFlowBlocked",
    ],
    "Saved preparation consumption plan",
  );
  if (
    input.schemaVersion !== SCHEMA_VERSION ||
    !["not_applied", "committed"].includes(input.applicationState)
  )
    fail(
      "invalid_preparation_history",
      "Preparation plan version or application state is invalid.",
    );
  validatePreparationCommand(input.command);
  if (
    !Array.isArray(input.lines) ||
    !Array.isArray(input.movements) ||
    !Array.isArray(input.warnings)
  )
    fail(
      "invalid_preparation_history",
      "Preparation plan collections are invalid.",
    );
  if (
    input.lines.length > 500 ||
    input.movements.length > MAX_PREPARATION_MOVEMENTS ||
    input.warnings.length > 20_000
  )
    fail(
      "invalid_preparation_history",
      "Preparation plan exceeds supported row limits.",
    );
  for (const line of input.lines) {
    exact(
      line,
      [
        "lineId",
        "productId",
        "productNameSnapshot",
        "quantity",
        "capturedModifiers",
        "readiness",
        "recipeSnapshot",
      ],
      "Preparation recipe snapshot",
    );
    text(line.lineId, "Preparation line id", 120);
    text(line.productId, "Preparation product id", 120);
    text(line.productNameSnapshot, "Preparation product name", 160);
    integer(line.quantity, "Preparation product quantity", 1);
    if (!Array.isArray(line.capturedModifiers))
      fail("invalid_preparation_history", "Captured modifier list is invalid.");
    for (const modifier of line.capturedModifiers)
      validatePreparationModifier(modifier);
    if (
      !["configured", "not_controlled", "unknown", "incomplete"].includes(
        line.readiness,
      )
    )
      fail(
        "invalid_preparation_history",
        "Preparation recipe readiness is invalid.",
      );
    if (line.recipeSnapshot !== null)
      validateRecipeSnapshot(line.recipeSnapshot);
  }
  const movementIds = new Set();
  const movementItemIds = new Set();
  for (const [index, movement] of input.movements.entries()) {
    exact(
      movement,
      [
        "movementId",
        "itemId",
        "itemNameSnapshot",
        "itemKindSnapshot",
        "baseUnitSnapshot",
        "quantityBaseUnits",
        "deltaBaseUnits",
        "expectedItemRevision",
        "sourceAllocations",
      ],
      "Planned inventory consumption",
    );
    text(movement.movementId, "Planned movement id", 200);
    text(movement.itemId, "Planned item id", 100);
    if (
      movement.movementId !==
        `${input.command.commandId}:movement:${index + 1}` ||
      movementIds.has(movement.movementId) ||
      movementItemIds.has(movement.itemId)
    )
      fail(
        "invalid_preparation_history",
        "Planned movement ids must be stable and each inventory item may be aggregated once.",
      );
    movementIds.add(movement.movementId);
    movementItemIds.add(movement.itemId);
    text(movement.itemNameSnapshot, "Planned item name", 120);
    if (
      !["Ingrediente", "Insumo", "Producto terminado"].includes(
        movement.itemKindSnapshot,
      ) ||
      !["g", "ml", "pz"].includes(movement.baseUnitSnapshot)
    )
      fail(
        "invalid_preparation_history",
        "Planned inventory item snapshot is invalid.",
      );
    integer(movement.quantityBaseUnits, "Planned consumption quantity", 1);
    if (movement.deltaBaseUnits !== -movement.quantityBaseUnits)
      fail(
        "invalid_preparation_history",
        "Consumption movement must reduce stock by its exact quantity.",
      );
    integer(movement.expectedItemRevision, "Planned item revision");
    if (
      !Array.isArray(movement.sourceAllocations) ||
      movement.sourceAllocations.length === 0
    )
      fail(
        "invalid_preparation_history",
        "Planned movement has no source allocation.",
      );
    if (movement.sourceAllocations.length > 500)
      fail(
        "invalid_preparation_history",
        "Planned movement has too many source allocations.",
      );
    for (const allocation of movement.sourceAllocations)
      validateUsageAllocation(allocation);
    const allocatedQuantity = movement.sourceAllocations.reduce(
      (sum, allocation) => sum + allocation.quantityBaseUnits,
      0,
    );
    if (
      !Number.isSafeInteger(allocatedQuantity) ||
      allocatedQuantity !== movement.quantityBaseUnits
    )
      fail(
        "invalid_preparation_history",
        "Movement quantity does not match its source allocations.",
      );
  }
  if (input.lines.length !== input.command.lines.length)
    fail(
      "invalid_preparation_history",
      "Preparation snapshots must preserve each captured order line.",
    );
  const planLinesById = new Map();
  for (const [index, line] of input.lines.entries()) {
    const source = input.command.lines[index];
    const expectedModifiers = source.modifiers.map(
      ({ groupId, optionId, quantity }) => ({ groupId, optionId, quantity }),
    );
    if (
      line.lineId !== source.lineId ||
      line.productId !== source.productId ||
      line.productNameSnapshot !== source.productNameSnapshot ||
      line.quantity !== source.quantity ||
      !same(line.capturedModifiers, expectedModifiers)
    )
      fail(
        "invalid_preparation_history",
        "Preparation snapshots do not match their captured order lines.",
      );
    const expectedReadiness = !line.recipeSnapshot
      ? "unknown"
      : line.recipeSnapshot.mode === "none"
        ? "not_controlled"
        : "configured";
    if (
      line.readiness !== expectedReadiness ||
      (line.recipeSnapshot && line.recipeSnapshot.productId !== line.productId)
    )
      fail(
        "invalid_preparation_history",
        "Preparation recipe snapshot does not match its order line status.",
      );
    planLinesById.set(line.lineId, line);
  }
  for (const movement of input.movements) {
    for (const allocation of movement.sourceAllocations) {
      const line = planLinesById.get(allocation.lineId);
      if (
        !line ||
        line.productId !== allocation.productId ||
        !line.recipeSnapshot ||
        line.readiness !== "configured"
      )
        fail(
          "invalid_preparation_history",
          "Consumption allocation does not reference a configured captured order line.",
        );
      if (allocation.recipeRevision !== line.recipeSnapshot.recipeRevision)
        fail(
          "invalid_preparation_history",
          "Consumption allocation recipe revision does not match its captured snapshot.",
        );
      const expectedTotal = allocation.perProductBaseUnits * line.quantity;
      if (
        !Number.isSafeInteger(expectedTotal) ||
        expectedTotal !== allocation.quantityBaseUnits
      )
        fail(
          "invalid_preparation_history",
          "Consumption allocation total does not match captured product quantity.",
        );
      const sourceItem = [
        ...line.recipeSnapshot.items,
        ...(line.recipeSnapshot.finishedGood
          ? [line.recipeSnapshot.finishedGood]
          : []),
        ...line.recipeSnapshot.modifierEffects.flatMap((effect) => effect.add),
      ].find((candidate) => candidate.itemId === movement.itemId);
      if (
        !sourceItem ||
        sourceItem.itemNameSnapshot !== allocation.sourceItemNameSnapshot ||
        sourceItem.baseUnitSnapshot !== allocation.baseUnitSnapshot
      )
        fail(
          "invalid_preparation_history",
          "Consumption allocation is not supported by its immutable recipe item snapshot.",
        );
    }
  }
  // Match amounts to frozen recipes, not merely to each other: a consistent
  // edited consumption must not inflate inventory restored by a later refund.
  const expectedAllocations = new Map();
  for (const line of input.lines) {
    if (!line.recipeSnapshot || line.readiness !== "configured") continue;
    let usage;
    try {
      usage = buildUsageMap(
        line.recipeSnapshot,
        line.capturedModifiers,
        line.quantity,
      );
    } catch (error) {
      if (
        !(error instanceof RecipeLedgerError) ||
        input.automaticConsumptionEligible ||
        !input.warnings.some(
          (warning) =>
            warning.lineId === line.lineId && warning.code === error.code,
        )
      )
        throw error;
      continue;
    }
    for (const entry of usage) {
      expectedAllocations.set(modifierKey(line.lineId, entry.line.itemId), {
        perProductBaseUnits: entry.perProductBaseUnits,
        quantityBaseUnits: entry.quantityBaseUnits,
        baseUnitSnapshot: entry.line.baseUnitSnapshot,
        itemKindSnapshot: entry.line.itemKindSnapshot,
      });
    }
  }
  for (const movement of input.movements) {
    for (const allocation of movement.sourceAllocations) {
      const key = modifierKey(allocation.lineId, movement.itemId);
      const expected = expectedAllocations.get(key);
      if (
        !expected ||
        expected.perProductBaseUnits !== allocation.perProductBaseUnits ||
        expected.quantityBaseUnits !== allocation.quantityBaseUnits ||
        expected.baseUnitSnapshot !== movement.baseUnitSnapshot ||
        expected.itemKindSnapshot !== movement.itemKindSnapshot
      )
        fail(
          "invalid_preparation_history",
          "Consumption differs from its immutable recipe quantities.",
        );
      expectedAllocations.delete(key);
    }
  }
  if (expectedAllocations.size)
    fail(
      "invalid_preparation_history",
      "Consumption omits immutable recipe allocations.",
    );
  for (const warning of input.warnings) {
    exact(
      warning,
      ["code", "message", "lineId", "productId"],
      "Preparation warning",
    );
    text(warning.code, "Preparation warning code", 80);
    text(warning.message, "Preparation warning message", 250);
    if (warning.lineId !== null) text(warning.lineId, "Warning line id", 120);
    if (warning.productId !== null)
      text(warning.productId, "Warning product id", 120);
  }
  if (
    typeof input.automaticConsumptionEligible !== "boolean" ||
    input.orderFlowBlocked !== false
  )
    fail("invalid_preparation_history", "Preparation plan flags are invalid.");
  return clone(input);
}

function validatePreparationModifier(modifier) {
  exact(
    modifier,
    ["groupId", "optionId", "quantity"],
    "Captured modifier snapshot",
  );
  text(modifier.groupId, "Captured modifier group id", 120);
  if (modifier.optionId !== null)
    text(modifier.optionId, "Captured modifier option id", 120);
  if (modifier.quantity !== null)
    integer(modifier.quantity, "Captured modifier quantity", 1);
}

function validatePreparationPrior(plans) {
  if (!Array.isArray(plans))
    fail(
      "invalid_preparation_history",
      "Saved preparation history must be an array.",
    );
  if (plans.length > 100_000)
    fail(
      "invalid_preparation_history",
      "Saved preparation history exceeds the supported limit.",
    );
  const seen = new Set();
  for (const plan of plans) {
    const valid = validatePreparationPlan(plan);
    const id = valid.command.commandId;
    if (seen.has(id))
      fail(
        "invalid_preparation_history",
        "Preparation command ids must be unique.",
      );
    seen.add(id);
  }
  return plans;
}

function itemSourceWarnings(snapshot, productCatalog, inventoryState) {
  const warnings = [];
  const product = productCatalog.products.find(
    (candidate) => candidate.id === snapshot.productId,
  );
  if (!product)
    warnings.push({
      code: "product_missing",
      message:
        "El producto ya no existe en el catálogo actual; se conserva su receta capturada.",
      itemId: null,
      groupId: null,
      optionId: null,
    });
  if (
    !productCatalog.importGate.readyForValidatedBusinessUse ||
    !snapshot.catalogStockControlValidated
  )
    warnings.push({
      code: "product_unverified",
      message:
        "El origen o la clasificación de inventario del producto sigue sin validación comercial.",
      itemId: null,
      groupId: null,
      optionId: null,
    });
  if (
    product &&
    product.stockControl.mode !== "unknown" &&
    product.stockControl.mode !== snapshot.mode
  )
    warnings.push({
      code: "stock_control_mismatch",
      message:
        "La receta guardada no coincide con la clasificación de control actual del producto; requiere revisión.",
      itemId: null,
      groupId: null,
      optionId: null,
    });
  for (const line of [
    ...snapshot.items,
    ...(snapshot.finishedGood ? [snapshot.finishedGood] : []),
    ...snapshot.modifierEffects.flatMap((effect) => [
      ...effect.remove,
      ...effect.add,
    ]),
  ]) {
    const item = inventoryState.items.find(
      (candidate) => candidate.itemId === line.itemId,
    );
    if (!item || item.archived)
      warnings.push({
        code: "inventory_item_unavailable",
        message: `El artículo ${line.itemNameSnapshot} ya no está disponible para consumo automático.`,
        itemId: line.itemId,
        groupId: null,
        optionId: null,
      });
    if (item?.provenance !== "operator-count")
      warnings.push({
        code: "stock_unverified",
        message: `La existencia de ${line.itemNameSnapshot} no tiene un conteo verificado.`,
        itemId: line.itemId,
        groupId: null,
        optionId: null,
      });
  }
  if (product && snapshot.mode === "recipe") {
    const mapped = new Set(
      snapshot.modifierEffects.map((effect) =>
        modifierKey(effect.groupId, effect.optionId),
      ),
    );
    for (const groupId of product.modifierGroupIds) {
      const group = productCatalog.modifierGroups.find(
        (candidate) => candidate.id === groupId && candidate.active,
      );
      for (const option of group?.options.filter(
        (candidate) => candidate.active,
      ) || []) {
        if (!mapped.has(modifierKey(groupId, option.id)))
          warnings.push({
            code: "modifier_unmapped",
            message: `Falta consumo configurado para ${group.name}: ${option.name}.`,
            itemId: null,
            groupId,
            optionId: option.id,
          });
      }
    }
  }
  return warnings;
}

function validateSourceRevisions(
  command,
  recipeCatalog,
  productCatalog,
  inventoryState,
) {
  const revisions = sourceRevisions(
    recipeCatalog,
    productCatalog,
    inventoryState,
  );
  if (
    command.expectedRecipeCatalogRevision !== revisions.recipeCatalogRevision ||
    command.expectedProductCatalogRevision !==
      revisions.productCatalogRevision ||
    command.expectedInventoryRevision !== revisions.inventoryRevision ||
    command.expectedInventoryCatalogRevision !==
      revisions.inventoryCatalogRevision
  )
    fail(
      "stale_source_revision",
      "Product, recipe, or inventory state changed after the preparation preview.",
    );
}

export function planPreparationConsumption(
  recipeCatalogInput,
  productCatalogInput,
  inventoryStateInput,
  command,
  actor,
  priorPlanInputs = [],
) {
  const recipeCatalog = validateRecipeCatalog(recipeCatalogInput);
  validatePreparationCommand(command);
  authorityMatches(command, actor, PREPARATION_ROLES);
  const priorPlans = validatePreparationPrior(priorPlanInputs);
  const duplicate = priorPlans.find(
    (plan) => plan.command.commandId === command.commandId,
  );
  if (duplicate) {
    if (!same(duplicate.command, command))
      fail(
        "command_conflict",
        "Preparation command id was reused with different captured lines.",
      );
    if (duplicate.applicationState !== "committed")
      fail(
        "invalid_preparation_history",
        "An unapplied preparation plan cannot be treated as a successful retry.",
      );
    return { plan: duplicate, duplicate: true, movements: [] };
  }
  const productCatalog = assertCatalog(productCatalogInput);
  const inventoryState = assertInventory(inventoryStateInput);
  validateSourceRevisions(
    command,
    recipeCatalog,
    productCatalog,
    inventoryState,
  );
  const stocks = new Map(
    inventorySummary(inventoryState).map((item) => [
      item.itemId,
      item.stockBaseUnits,
    ]),
  );
  const currentItems = new Map(
    inventoryState.items.map((item) => [item.itemId, item]),
  );
  const usageByItem = new Map();
  const warnings = [];
  const lines = [];
  let automaticConsumptionEligible =
    productCatalog.importGate.readyForValidatedBusinessUse;
  for (const sourceLine of command.lines) {
    const capturedModifiers = sourceLine.modifiers.map((modifier) => ({
      groupId: modifier.groupId,
      optionId: modifier.optionId,
      quantity: modifier.quantity,
    }));
    const recipe = latestRecipe(recipeCatalog.recipes, sourceLine.productId);
    if (!recipe) {
      lines.push({
        lineId: sourceLine.lineId,
        productId: sourceLine.productId,
        productNameSnapshot: sourceLine.productNameSnapshot,
        quantity: sourceLine.quantity,
        capturedModifiers,
        readiness: "unknown",
        recipeSnapshot: null,
      });
      warnings.push({
        code: "recipe_missing",
        message: `No hay receta publicada para ${sourceLine.productNameSnapshot}; el pedido no se bloquea.`,
        lineId: sourceLine.lineId,
        productId: sourceLine.productId,
      });
      automaticConsumptionEligible = false;
      continue;
    }
    const readiness =
      recipe.mode === "none"
        ? "not_controlled"
        : recipe.mode === "unknown"
          ? "unknown"
          : "configured";
    lines.push({
      lineId: sourceLine.lineId,
      productId: sourceLine.productId,
      productNameSnapshot: sourceLine.productNameSnapshot,
      quantity: sourceLine.quantity,
      capturedModifiers,
      readiness,
      recipeSnapshot: clone(recipe),
    });
    if (recipe.mode === "none") continue;
    if (recipe.mode === "unknown") {
      warnings.push({
        code: "recipe_unclassified",
        message: `El control de inventario de ${sourceLine.productNameSnapshot} requiere configuración; el pedido no se bloquea.`,
        lineId: sourceLine.lineId,
        productId: sourceLine.productId,
      });
      automaticConsumptionEligible = false;
      continue;
    }
    const recipeWarnings = itemSourceWarnings(
      recipe,
      productCatalog,
      inventoryState,
    );
    for (const warning of recipeWarnings) {
      warnings.push({
        code: warning.code,
        message: warning.message,
        lineId: sourceLine.lineId,
        productId: sourceLine.productId,
      });
      automaticConsumptionEligible = false;
    }
    const modifierMap = new Set(
      recipe.modifierEffects.map((effect) =>
        modifierKey(effect.groupId, effect.optionId),
      ),
    );
    for (const modifier of capturedModifiers) {
      if (!modifierMap.has(modifierKey(modifier.groupId, modifier.optionId))) {
        warnings.push({
          code: "modifier_unmapped",
          message: `El modificador ${modifier.groupId}/${modifier.optionId} no tiene consumo configurado; el pedido no se bloquea.`,
          lineId: sourceLine.lineId,
          productId: sourceLine.productId,
        });
        automaticConsumptionEligible = false;
      }
    }
    let usage;
    try {
      usage = buildUsageMap(recipe, capturedModifiers, sourceLine.quantity);
    } catch (error) {
      if (!(error instanceof RecipeLedgerError)) throw error;
      warnings.push({
        code: error.code,
        message: `Revisa la combinación de modificadores de ${sourceLine.productNameSnapshot}; el pedido no se bloquea.`,
        lineId: sourceLine.lineId,
        productId: sourceLine.productId,
      });
      automaticConsumptionEligible = false;
      continue;
    }
    for (const entry of usage) {
      const aggregate = usageByItem.get(entry.line.itemId) || {
        line: entry.line,
        quantityBaseUnits: 0,
        allocations: [],
      };
      const amount = aggregate.quantityBaseUnits + entry.quantityBaseUnits;
      if (!Number.isSafeInteger(amount))
        fail(
          "unsafe_quantity",
          "Combined order consumption exceeds the safe integer range.",
        );
      aggregate.quantityBaseUnits = amount;
      aggregate.allocations.push({
        lineId: sourceLine.lineId,
        productId: sourceLine.productId,
        recipeRevision: recipe.recipeRevision,
        sourceItemNameSnapshot: entry.line.itemNameSnapshot,
        baseUnitSnapshot: entry.line.baseUnitSnapshot,
        perProductBaseUnits: entry.perProductBaseUnits,
        quantityBaseUnits: entry.quantityBaseUnits,
      });
      usageByItem.set(entry.line.itemId, aggregate);
    }
  }
  const movements = [...usageByItem.values()].map((entry, index) => {
    const item = currentItems.get(entry.line.itemId);
    if (!item || item.archived) automaticConsumptionEligible = false;
    if (item?.provenance !== "operator-count")
      automaticConsumptionEligible = false;
    const resultingStock =
      (stocks.get(entry.line.itemId) ?? 0) - entry.quantityBaseUnits;
    if (!Number.isSafeInteger(resultingStock))
      fail(
        "unsafe_quantity",
        "Projected inventory balance exceeds the safe integer range.",
      );
    if (resultingStock < 0) {
      automaticConsumptionEligible = false;
      warnings.push({
        code: "insufficient_stock",
        message: `Existencia insuficiente de ${item?.name || entry.line.itemId}; el pedido no se bloquea en esta vista previa.`,
        lineId: null,
        productId: null,
      });
    }
    return {
      movementId: `${command.commandId}:movement:${index + 1}`,
      itemId: entry.line.itemId,
      itemNameSnapshot: item?.name || entry.line.itemNameSnapshot,
      itemKindSnapshot: item?.kind || entry.line.itemKindSnapshot,
      baseUnitSnapshot: item?.baseUnit || entry.line.baseUnitSnapshot,
      quantityBaseUnits: entry.quantityBaseUnits,
      deltaBaseUnits: -entry.quantityBaseUnits,
      expectedItemRevision: item?.revision ?? 0,
      sourceAllocations: entry.allocations,
    };
  });
  const plan = {
    schemaVersion: SCHEMA_VERSION,
    applicationState: "not_applied",
    command: clone(command),
    lines,
    movements,
    warnings,
    automaticConsumptionEligible,
    orderFlowBlocked: false,
  };
  validatePreparationPlan(plan);
  return { plan, duplicate: false, movements: clone(movements) };
}

function validateCompensationCommand(command) {
  exact(
    command,
    [
      "commandId",
      "sourceCommandId",
      "kind",
      "occurredAt",
      "actorId",
      "actorName",
      "roleSnapshot",
      "reason",
      "expectedInventoryRevision",
      "returnedLines",
    ],
    "Consumption compensation command",
  );
  for (const field of ["commandId", "sourceCommandId", "actorId", "actorName"])
    text(command[field], `Compensation ${field}`, 160);
  if (!new Set(["cancel", "refund"]).has(command.kind))
    fail("invalid_compensation", "Compensation kind must be cancel or refund.");
  if (
    typeof command.occurredAt !== "string" ||
    !Number.isFinite(Date.parse(command.occurredAt))
  )
    fail("invalid_timestamp", "Compensation timestamp is invalid.");
  if (!CONFIG_ROLES.has(command.roleSnapshot))
    fail(
      "not_authorized",
      "Only Dueña or Encargado can request inventory compensation.",
    );
  text(command.reason, "Compensation reason", 250);
  integer(command.expectedInventoryRevision, "Compensation inventory revision");
  if (!Array.isArray(command.returnedLines) || !command.returnedLines.length)
    fail(
      "invalid_compensation",
      "Compensation needs explicit returned order lines.",
    );
  if (command.returnedLines.length > 500)
    fail(
      "invalid_compensation",
      "Compensation supports at most 500 preparation lines.",
    );
  for (const line of command.returnedLines) {
    exact(line, ["lineId", "quantity"], "Returned preparation line");
    text(line.lineId, "Returned line id", 120);
    integer(line.quantity, "Returned product quantity", 1);
  }
  if (
    new Set(command.returnedLines.map((line) => line.lineId)).size !==
    command.returnedLines.length
  )
    fail("invalid_compensation", "Returned line ids must be unique.");
}

function validateCompensationPlan(input) {
  exact(
    input,
    [
      "schemaVersion",
      "applicationState",
      "command",
      "sourceCommandId",
      "movements",
      "automaticCompensationEligible",
    ],
    "Saved consumption compensation plan",
  );
  if (
    input.schemaVersion !== SCHEMA_VERSION ||
    !["not_applied", "committed"].includes(input.applicationState)
  )
    fail(
      "invalid_compensation_history",
      "Compensation plan version or status is invalid.",
    );
  validateCompensationCommand(input.command);
  text(input.sourceCommandId, "Compensation source command id", 160);
  if (
    input.sourceCommandId !== input.command.sourceCommandId ||
    !Array.isArray(input.movements)
  )
    fail(
      "invalid_compensation_history",
      "Compensation source or movement list is invalid.",
    );
  if (input.movements.length > MAX_PREPARATION_MOVEMENTS)
    fail(
      "invalid_compensation_history",
      "Saved compensation exceeds supported movement limits.",
    );
  for (const movement of input.movements) {
    exact(
      movement,
      [
        "movementId",
        "itemId",
        "itemNameSnapshot",
        "itemKindSnapshot",
        "baseUnitSnapshot",
        "quantityBaseUnits",
        "deltaBaseUnits",
        "expectedItemRevision",
        "sourceAllocations",
      ],
      "Planned consumption reversal",
    );
    text(movement.movementId, "Reversal movement id", 200);
    text(movement.itemId, "Reversal item id", 100);
    text(movement.itemNameSnapshot, "Reversal item name", 120);
    if (
      !["Ingrediente", "Insumo", "Producto terminado"].includes(
        movement.itemKindSnapshot,
      ) ||
      !["g", "ml", "pz"].includes(movement.baseUnitSnapshot)
    )
      fail(
        "invalid_compensation_history",
        "Reversal item snapshot is invalid.",
      );
    integer(movement.quantityBaseUnits, "Reversal quantity", 1);
    if (movement.deltaBaseUnits !== movement.quantityBaseUnits)
      fail(
        "invalid_compensation_history",
        "Reversal must restore its exact consumed quantity.",
      );
    integer(movement.expectedItemRevision, "Reversal item revision");
    if (
      !Array.isArray(movement.sourceAllocations) ||
      movement.sourceAllocations.length === 0 ||
      movement.sourceAllocations.length > 500
    )
      fail(
        "invalid_compensation_history",
        "Reversal source allocations are invalid.",
      );
    for (const allocation of movement.sourceAllocations)
      validateUsageAllocation(allocation);
    const allocatedQuantity = movement.sourceAllocations.reduce(
      (sum, allocation) => sum + allocation.quantityBaseUnits,
      0,
    );
    if (
      !Number.isSafeInteger(allocatedQuantity) ||
      allocatedQuantity !== movement.quantityBaseUnits
    )
      fail(
        "invalid_compensation_history",
        "Reversal amount does not match recorded source quantities.",
      );
  }
  if (typeof input.automaticCompensationEligible !== "boolean")
    fail("invalid_compensation_history", "Compensation readiness is invalid.");
  return clone(input);
}

function validateCompensationAgainstSource(compensation, preparationPlan) {
  const lineQuantities = new Map(
    preparationPlan.lines.map((line) => [line.lineId, line.quantity]),
  );
  const returned = new Map();
  for (const line of compensation.command.returnedLines) {
    const sourceQuantity = lineQuantities.get(line.lineId);
    if (sourceQuantity === undefined || line.quantity > sourceQuantity)
      fail(
        "invalid_compensation_history",
        "Saved compensation references a missing or oversized preparation line.",
      );
    returned.set(line.lineId, line.quantity);
  }
  const expectedByItem = new Map();
  for (const sourceMovement of preparationPlan.movements) {
    for (const sourceAllocation of sourceMovement.sourceAllocations) {
      const returnedQuantity = returned.get(sourceAllocation.lineId) || 0;
      if (!returnedQuantity) continue;
      const amount = sourceAllocation.perProductBaseUnits * returnedQuantity;
      if (!Number.isSafeInteger(amount))
        fail(
          "invalid_compensation_history",
          "Saved compensation quantity exceeds the safe integer range.",
        );
      const aggregate = expectedByItem.get(sourceMovement.itemId) || {
        sourceMovement,
        quantityBaseUnits: 0,
        allocations: [],
      };
      const total = aggregate.quantityBaseUnits + amount;
      if (!Number.isSafeInteger(total))
        fail(
          "invalid_compensation_history",
          "Saved compensation total exceeds the safe integer range.",
        );
      aggregate.quantityBaseUnits = total;
      aggregate.allocations.push({
        ...sourceAllocation,
        quantityBaseUnits: amount,
      });
      expectedByItem.set(sourceMovement.itemId, aggregate);
    }
  }
  const expected = [...expectedByItem.values()]
    .filter((entry) => entry.quantityBaseUnits > 0)
    .map((entry, index) => ({
      movementId: `${compensation.command.commandId}:movement:${index + 1}`,
      itemId: entry.sourceMovement.itemId,
      itemNameSnapshot: entry.sourceMovement.itemNameSnapshot,
      itemKindSnapshot: entry.sourceMovement.itemKindSnapshot,
      baseUnitSnapshot: entry.sourceMovement.baseUnitSnapshot,
      quantityBaseUnits: entry.quantityBaseUnits,
      deltaBaseUnits: entry.quantityBaseUnits,
      sourceAllocations: entry.allocations,
    }));
  if (expected.length !== compensation.movements.length)
    fail(
      "invalid_compensation_history",
      "Saved compensation movements do not reverse the requested recorded quantities.",
    );
  for (const [index, movement] of compensation.movements.entries()) {
    const source = expected[index];
    if (
      movement.movementId !== source.movementId ||
      movement.itemId !== source.itemId ||
      movement.itemNameSnapshot !== source.itemNameSnapshot ||
      movement.itemKindSnapshot !== source.itemKindSnapshot ||
      movement.baseUnitSnapshot !== source.baseUnitSnapshot ||
      movement.quantityBaseUnits !== source.quantityBaseUnits ||
      movement.deltaBaseUnits !== source.deltaBaseUnits ||
      !same(movement.sourceAllocations, source.sourceAllocations)
    )
      fail(
        "invalid_compensation_history",
        "Saved compensation content differs from recorded preparation consumption.",
      );
  }
}

export function planConsumptionCompensation(
  preparationPlanInput,
  command,
  actor,
  inventoryStateInput,
  priorCompensationInputs = [],
) {
  const preparationPlan = validatePreparationPlan(preparationPlanInput);
  validateCompensationCommand(command);
  authorityMatches(command, actor, CONFIG_ROLES);
  if (preparationPlan.applicationState !== "committed")
    fail(
      "source_consumption_not_recorded",
      "Compensation requires the original consumption to be committed first.",
    );
  if (command.sourceCommandId !== preparationPlan.command.commandId)
    fail(
      "unknown_consumption",
      "The source preparation consumption record does not match.",
    );
  if (!Array.isArray(priorCompensationInputs))
    fail(
      "invalid_compensation_history",
      "Saved compensation history must be an array.",
    );
  if (priorCompensationInputs.length > 100_000)
    fail(
      "invalid_compensation_history",
      "Saved compensation history exceeds the supported limit.",
    );
  const prior = priorCompensationInputs.map(validateCompensationPlan);
  if (prior.some((event) => event.applicationState !== "committed"))
    fail(
      "invalid_compensation_history",
      "Only committed compensations may reserve returned stock quantities.",
    );
  const seen = new Set();
  for (const compensation of prior) {
    if (seen.has(compensation.command.commandId))
      fail(
        "invalid_compensation_history",
        "Compensation command ids must be unique.",
      );
    seen.add(compensation.command.commandId);
    if (compensation.sourceCommandId !== command.sourceCommandId)
      fail(
        "invalid_compensation_history",
        "Compensation history references a different preparation.",
      );
    validateCompensationAgainstSource(compensation, preparationPlan);
  }
  const sourceQuantities = new Map(
    preparationPlan.lines.map((line) => [line.lineId, line.quantity]),
  );
  const priorReturned = new Map();
  for (const event of prior) {
    for (const line of event.command.returnedLines) {
      const sourceQuantity = sourceQuantities.get(line.lineId);
      const total = (priorReturned.get(line.lineId) || 0) + line.quantity;
      if (
        sourceQuantity === undefined ||
        !Number.isSafeInteger(total) ||
        total > sourceQuantity
      )
        fail(
          "invalid_compensation_history",
          "Saved compensation exceeds its recorded preparation line.",
        );
      priorReturned.set(line.lineId, total);
    }
  }
  const duplicate = prior.find(
    (compensation) => compensation.command.commandId === command.commandId,
  );
  if (duplicate) {
    if (!same(duplicate.command, command))
      fail(
        "command_conflict",
        "Compensation command id was reused with different returned quantities.",
      );
    if (duplicate.applicationState !== "committed")
      fail(
        "invalid_compensation_history",
        "An unapplied compensation cannot be treated as a successful retry.",
      );
    return { compensation: duplicate, duplicate: true, movements: [] };
  }
  const inventoryState = assertInventory(inventoryStateInput);
  if (command.expectedInventoryRevision !== inventoryState.revision)
    fail(
      "stale_source_revision",
      "Inventory changed after the compensation preview.",
    );
  const orderLines = preparationPlan.lines;
  const alreadyReturned = priorReturned;
  const returns = new Map();
  for (const line of command.returnedLines) {
    const sourceQuantity = sourceQuantities.get(line.lineId);
    if (sourceQuantity === undefined)
      fail(
        "unknown_consumption_line",
        "Returned line does not exist in the recorded preparation.",
      );
    const remaining = sourceQuantity - (alreadyReturned.get(line.lineId) || 0);
    if (line.quantity > remaining)
      fail(
        "excess_compensation",
        "Returned quantity exceeds the recorded unreturned preparation quantity.",
      );
    returns.set(line.lineId, line.quantity);
  }
  if (command.kind === "cancel") {
    const remainingLines = orderLines
      .map((line) => ({
        lineId: line.lineId,
        quantity: line.quantity - (alreadyReturned.get(line.lineId) || 0),
      }))
      .filter((line) => line.quantity > 0);
    if (!same(command.returnedLines, remainingLines))
      fail(
        "invalid_compensation",
        "Cancellation must restore every remaining recorded preparation line.",
      );
  }
  const byItem = new Map();
  for (const movement of preparationPlan.movements) {
    for (const allocation of movement.sourceAllocations) {
      const returnedQuantity = returns.get(allocation.lineId) || 0;
      if (!returnedQuantity) continue;
      const amount = allocation.perProductBaseUnits * returnedQuantity;
      if (!Number.isSafeInteger(amount))
        fail(
          "unsafe_quantity",
          "Compensation quantity exceeds the safe integer range.",
        );
      const aggregate = byItem.get(movement.itemId) || {
        movement,
        quantityBaseUnits: 0,
        allocations: [],
      };
      const next = aggregate.quantityBaseUnits + amount;
      if (!Number.isSafeInteger(next))
        fail(
          "unsafe_quantity",
          "Combined compensation exceeds the safe integer range.",
        );
      aggregate.quantityBaseUnits = next;
      aggregate.allocations.push({ ...allocation, quantityBaseUnits: amount });
      byItem.set(movement.itemId, aggregate);
    }
  }
  const itemByIdMap = new Map(
    inventoryState.items.map((item) => [item.itemId, item]),
  );
  const movements = [...byItem.values()].map((entry, index) => {
    const item = itemByIdMap.get(entry.movement.itemId);
    return {
      movementId: `${command.commandId}:movement:${index + 1}`,
      itemId: entry.movement.itemId,
      itemNameSnapshot: entry.movement.itemNameSnapshot,
      itemKindSnapshot: entry.movement.itemKindSnapshot,
      baseUnitSnapshot: entry.movement.baseUnitSnapshot,
      quantityBaseUnits: entry.quantityBaseUnits,
      deltaBaseUnits: entry.quantityBaseUnits,
      expectedItemRevision: item?.revision ?? 0,
      sourceAllocations: entry.allocations,
    };
  });
  const compensation = {
    schemaVersion: SCHEMA_VERSION,
    applicationState: "not_applied",
    command: clone(command),
    sourceCommandId: preparationPlan.command.commandId,
    movements,
    automaticCompensationEligible:
      preparationPlan.automaticConsumptionEligible &&
      movements.every((movement) => {
        const item = itemByIdMap.get(movement.itemId);
        return item && !item.archived;
      }),
  };
  validateCompensationPlan(compensation);
  return { compensation, duplicate: false, movements: clone(movements) };
}
