import {
  formatBaseUnits,
  validateInventoryState,
} from "../inventory/inventory-ledger.mjs";
import { validateRecipeCatalog } from "../inventory/recipe-ledger.mjs";

const MAX_PROJECTED_EVENTS = 200_000;
const UTC_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

export class AuditHistoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AuditHistoryError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new AuditHistoryError(code, message);
}

/** Accept only an explicit, round-tripping UTC instant recorded by a command. */
export function recordedAuditInstant(value) {
  if (typeof value !== "string") return null;
  const match = UTC_INSTANT.exec(value);
  if (!match) return null;
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return null;
  const iso = new Date(instant).toISOString();
  const fraction = match[7] ? match[7].padEnd(3, "0") : "000";
  if (iso.slice(0, 19) !== value.slice(0, 19) || iso.slice(20, 23) !== fraction)
    return null;
  return iso;
}

function requireInstant(value) {
  const instant = recordedAuditInstant(value);
  if (!instant)
    fail(
      "invalid_timestamp",
      "El historial contiene una fecha sin un instante UTC verificable.",
    );
  return instant;
}

function formatQuantity(quantity, unit) {
  try {
    return formatBaseUnits(quantity, unit);
  } catch {
    fail(
      "invalid_inventory_history",
      "El historial de existencias requiere revisión.",
    );
  }
}

function displayValue(value) {
  if (value === null || value === undefined) return "Sin dato";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  return JSON.stringify(value);
}

function arrayIdentity(value, index) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (typeof value.itemId === "string")
      return { kind: "item", itemId: value.itemId };
    if (typeof value.groupId === "string" && typeof value.optionId === "string")
      return {
        kind: "modifier",
        groupId: value.groupId,
        optionId: value.optionId,
      };
  }
  return { kind: "row", index: index + 1 };
}

function flatten(value, path, output, budget) {
  budget.count += 1;
  if (budget.count > 12_000)
    fail(
      "history_too_large",
      "Un detalle del historial excede el límite de lectura.",
    );
  if (Array.isArray(value)) {
    if (!value.length) output.set(JSON.stringify(path), "Sin elementos");
    else
      value.forEach((child, index) =>
        flatten(child, [...path, arrayIdentity(child, index)], output, budget),
      );
    return;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    if (!keys.length) output.set(JSON.stringify(path), "Sin campos");
    else
      keys.forEach((key) =>
        flatten(
          value[key],
          [...path, { kind: "field", name: key }],
          output,
          budget,
        ),
      );
    return;
  }
  output.set(JSON.stringify(path), displayValue(value));
}

function changeField(pathKey, labels) {
  const path = JSON.parse(pathKey);
  if (path.length === 0) return "Valor";
  return path
    .map((part) => {
      if (part.kind === "field")
        return Object.hasOwn(labels, part.name)
          ? labels[part.name]
          : recipeFieldLabel(part.name);
      if (part.kind === "item") return `Artículo ${part.itemId}`;
      if (part.kind === "modifier")
        return `Grupo ${part.groupId}, opción ${part.optionId}`;
      return `Fila ${part.index}`;
    })
    .join(" · ");
}

function snapshotChanges(before, after, labels = {}) {
  const oldValues = new Map();
  const newValues = new Map();
  if (before !== null) flatten(before, [], oldValues, { count: 0 });
  if (after !== null) flatten(after, [], newValues, { count: 0 });
  const paths = [...new Set([...oldValues.keys(), ...newValues.keys()])].sort();
  const changed = paths.filter(
    (path) => oldValues.get(path) !== newValues.get(path),
  );
  return changed.map((path) => ({
    field: changeField(path, labels),
    beforeValue:
      before === null
        ? "Sin registro previo"
        : (oldValues.get(path) ?? "Sin valor"),
    afterValue:
      after === null ? "Sin valor" : (newValues.get(path) ?? "Sin valor"),
  }));
}

function recipeFieldLabel(path) {
  const keys = {
    productId: "ID de producto",
    productNameSnapshot: "Producto (nombre guardado)",
    productCatalogRevision: "Versión del catálogo de productos",
    productSourceKind: "Origen de producto",
    productSourcePath: "Ruta de origen del producto",
    catalogStockControlMode: "Control de existencias del catálogo",
    catalogStockControlValidated: "Control del catálogo validado",
    catalogStockControlEvidence: "Evidencia del catálogo",
    inventoryCatalogRevision: "Versión del catálogo de insumos",
    sourceInventoryRevision: "Versión de existencias usada",
    recipeRevision: "Versión de receta",
    mode: "Modo de control de existencias",
    evidence: "Evidencia de receta",
    provenance: "Procedencia",
    items: "Ingredientes",
    finishedGood: "Producto terminado",
    modifierEffects: "Efectos de modificadores",
    itemId: "ID de insumo",
    itemNameSnapshot: "Insumo (nombre guardado)",
    itemKindSnapshot: "Tipo de insumo",
    baseUnitSnapshot: "Unidad base guardada",
    displayUnitSnapshot: "Unidad visible guardada",
    quantityText: "Cantidad capturada",
    unitSnapshot: "Unidad capturada",
    quantityBaseUnits: "Cantidad en unidad base",
    itemRevision: "Versión del insumo",
    itemCatalogRevision: "Versión del catálogo del insumo",
    groupId: "ID de grupo de modificador",
    groupNameSnapshot: "Grupo (nombre guardado)",
    optionId: "ID de opción",
    optionNameSnapshot: "Opción (nombre guardado)",
    effect: "Efecto de inventario",
    remove: "Insumos sustituidos",
    add: "Insumos agregados",
  };
  return Object.hasOwn(keys, path) ? keys[path] : path;
}

function eventBase({
  id,
  occurredAt,
  entityType,
  entityId,
  entityLabel,
  action,
  actionLabel,
  actorId,
  actorName,
  reason,
  source,
  status,
  sourceRevision,
  changes,
}) {
  return {
    id,
    occurredAt: requireInstant(occurredAt),
    entityType,
    entityId,
    entityLabel,
    action,
    actionLabel,
    actorId,
    actorName,
    reason,
    source,
    status,
    sourceRevision,
    changes,
  };
}

const inventoryActionLabels = {
  opening: "Saldo inicial",
  entry: "Entrada de existencias",
  waste: "Merma",
  adjustment: "Ajuste manual",
  threshold: "Cambio de mínimo",
};

function projectInventory(valid) {
  if (!valid) return [];
  const balances = new Map(valid.items.map((item) => [item.itemId, 0]));
  const events = [];
  for (const entry of valid.entries) {
    const name =
      typeof entry.itemNameSnapshot === "string"
        ? entry.itemNameSnapshot
        : null;
    const entityLabel = name || `Artículo ${entry.itemId}`;
    let changes;
    if (entry.kind === "threshold") {
      changes = [
        {
          field: "Mínimo de existencias",
          beforeValue: formatQuantity(
            entry.thresholdBeforeBaseUnits,
            entry.unitSnapshot,
          ),
          afterValue: formatQuantity(
            entry.thresholdBaseUnits,
            entry.unitSnapshot,
          ),
        },
      ];
    } else {
      const before = balances.get(entry.itemId) || 0;
      const after = before + entry.deltaBaseUnits;
      if (!Number.isSafeInteger(after) || after < 0)
        fail(
          "invalid_inventory_history",
          "El historial de existencias requiere revisión.",
        );
      balances.set(entry.itemId, after);
      const beforeValue =
        entry.kind === "opening"
          ? "Sin saldo previo · apertura"
          : formatQuantity(before, entry.unitSnapshot);
      changes = [
        {
          field: "Existencia antes",
          beforeValue,
          afterValue: formatQuantity(after, entry.unitSnapshot),
        },
        {
          field: "Movimiento",
          beforeValue: "Sin movimiento",
          afterValue: `${entry.quantityText} ${entry.unitSnapshot}`,
        },
      ];
    }
    events.push(
      eventBase({
        id: `inventory-entry:${entry.movementId}`,
        occurredAt: entry.occurredAt,
        entityType: "inventory",
        entityId: entry.itemId,
        entityLabel,
        action: entry.kind,
        actionLabel: inventoryActionLabels[entry.kind],
        actorId: entry.actorId,
        actorName: entry.actorName,
        reason: entry.reason,
        source: "Libro local de existencias",
        status:
          entry.syncStatus === "unverified"
            ? "Saldo inicial sin verificar"
            : "Acuse del servidor desconocido",
        sourceRevision: entry.sourceRevision,
        changes,
      }),
    );
  }
  for (const event of valid.catalogEvents || []) {
    const labels = {
      itemId: "ID de artículo",
      name: "Nombre",
      kind: "Tipo de artículo",
      baseUnit: "Unidad base",
      displayUnit: "Unidad visible",
      archived: "Archivado",
      provenance: "Procedencia",
    };
    events.push(
      eventBase({
        id: `inventory-catalog:${event.catalogEventId}`,
        occurredAt: event.occurredAt,
        entityType: "catalog",
        entityId: event.itemId,
        entityLabel: event.after.name,
        action: event.kind,
        actionLabel: {
          create: "Artículo creado",
          edit: "Artículo actualizado",
          archive: "Artículo archivado",
        }[event.kind],
        actorId: event.actorId,
        actorName: event.actorName,
        reason: event.reason,
        source: "Catálogo local de insumos",
        status: "Acuse del servidor desconocido",
        sourceRevision: event.sourceRevision,
        changes: snapshotChanges(event.before, event.after, labels),
      }),
    );
  }
  return events;
}

function projectRecipes(valid) {
  if (!valid) return [];
  return valid.events.map((event) => {
    const command = event.command;
    return eventBase({
      id: `recipe-publication:${command.commandId}`,
      occurredAt: command.occurredAt,
      entityType: "recipe",
      entityId: command.productId,
      entityLabel: event.after.productNameSnapshot,
      action: "publish",
      actionLabel: event.before ? "Receta actualizada" : "Receta publicada",
      actorId: command.actorId,
      actorName: command.actorName,
      reason: command.reason,
      source: "Publicación local de receta",
      status: "Local · sin acuse de servidor",
      sourceRevision: command.expectedRecipeCatalogRevision,
      changes: snapshotChanges(event.before, event.after),
    });
  });
}

/** Project only validated append-only inventory/catalog/recipe records. */
export function projectAuditHistory({
  inventoryState = null,
  recipeCatalog = null,
} = {}) {
  const inventoryRecordCount =
    inventoryState && typeof inventoryState === "object"
      ? [inventoryState.entries, inventoryState.catalogEvents]
          .filter(Array.isArray)
          .reduce((total, records) => total + records.length, 0)
      : 0;
  const recipeRecordCount =
    recipeCatalog &&
    typeof recipeCatalog === "object" &&
    Array.isArray(recipeCatalog.events)
      ? recipeCatalog.events.length
      : 0;
  if (inventoryRecordCount + recipeRecordCount > MAX_PROJECTED_EVENTS)
    fail(
      "history_too_large",
      "El historial excede el límite de lectura. Ajusta los filtros o revisa la estación.",
    );
  let validInventory = null;
  let validRecipes = null;
  try {
    if (inventoryState !== null)
      validInventory = validateInventoryState(inventoryState);
    if (recipeCatalog !== null)
      validRecipes = validateRecipeCatalog(recipeCatalog);
  } catch {
    fail(
      "invalid_history",
      "El historial local requiere revisión. No se muestran cambios.",
    );
  }
  const events = [
    ...projectInventory(validInventory),
    ...projectRecipes(validRecipes),
  ];
  if (events.length > MAX_PROJECTED_EVENTS)
    fail(
      "history_too_large",
      "El historial excede el límite de lectura. Ajusta los filtros o revisa la estación.",
    );
  const ids = new Set();
  for (const event of events) {
    if (ids.has(event.id))
      fail("invalid_history", "Hay identificadores de historial repetidos.");
    ids.add(event.id);
  }
  return events.sort(
    (a, b) =>
      Date.parse(b.occurredAt) - Date.parse(a.occurredAt) ||
      a.id.localeCompare(b.id),
  );
}

function validDate(value) {
  if (value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function createDateFormatter(timeZone) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    fail("invalid_time_zone", "La zona horaria del historial no es válida.");
  }
}

function dateInZone(instant, formatter) {
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(instant))
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}`;
}

/** Filter by actual recorded instants, projecting their calendar date in the explicit branch zone. */
export function filterAuditHistory(
  events,
  {
    from = "",
    through = "",
    timeZone = "America/Mexico_City",
    entityType = "all",
    action = "all",
    actorId = "all",
  } = {},
) {
  if (
    !Array.isArray(events) ||
    !validDate(from) ||
    !validDate(through) ||
    (from && through && from > through)
  )
    fail("invalid_filter", "Revisa el intervalo de fechas del historial.");
  const allowedEntities = new Set([
    "all",
    "inventory",
    "catalog",
    "recipe",
    "conflict",
  ]);
  if (!allowedEntities.has(entityType))
    fail("invalid_filter", "El filtro de entidad no es válido.");
  if (typeof timeZone !== "string" || !timeZone.trim())
    fail("invalid_time_zone", "La zona horaria del historial no es válida.");
  const formatter = createDateFormatter(timeZone);
  return events.filter((event) => {
    if (entityType === "conflict") return false;
    if (entityType !== "all" && event.entityType !== entityType) return false;
    if (action !== "all" && event.action !== action) return false;
    if (actorId !== "all" && event.actorId !== actorId) return false;
    const day = dateInZone(event.occurredAt, formatter);
    return (!from || day >= from) && (!through || day <= through);
  });
}
