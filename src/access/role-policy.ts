export const ACCESS_ROLES = ["duena", "encargado", "barra", "mesero"] as const;

export type AccessRole = (typeof ACCESS_ROLES)[number];
export type AccessAction =
  | "openOrder"
  | "checkout"
  | "cancelWithReason"
  | "cancelPreparationWithReason"
  | "discountWithReason"
  | "reprintWithReason"
  | "editMenu"
  | "adjustInventory"
  | "viewStock"
  | "viewReports"
  | "manageUsers"
  | "prepareOrder"
  | "configureTables";

const ACCESS_ACTIONS: readonly AccessAction[] = [
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
];

export type LegacyAccessAction =
  | "cancelar"
  | "descuento"
  | "ajuste"
  | "menu"
  | "inventario"
  | "reportes"
  | "usuarios"
  | "imprimir"
  | "cobrar"
  | "ordenes";

const legacyActionMap: Readonly<Record<LegacyAccessAction, AccessAction>> = {
  cancelar: "cancelWithReason",
  descuento: "discountWithReason",
  ajuste: "adjustInventory",
  menu: "editMenu",
  inventario: "viewStock",
  reportes: "viewReports",
  usuarios: "manageUsers",
  imprimir: "reprintWithReason",
  cobrar: "checkout",
  ordenes: "openOrder",
};

const permissions: Record<AccessRole, ReadonlySet<AccessAction>> = {
  duena: new Set([
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
  ]),
  encargado: new Set([
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
    "prepareOrder",
    "configureTables",
  ]),
  barra: new Set(["openOrder", "checkout", "viewStock", "prepareOrder"]),
  mesero: new Set(["openOrder", "viewStock", "prepareOrder"]),
};

export function isAccessRole(role: unknown): role is AccessRole {
  return (
    typeof role === "string" &&
    (ACCESS_ROLES as readonly string[]).includes(role)
  );
}

export function canPerform(
  role: AccessRole | null | undefined,
  action: AccessAction,
): boolean {
  return isAccessRole(role) && permissions[role].has(action);
}

export function resolveAccessAction(value: string): AccessAction | null {
  if ((ACCESS_ACTIONS as readonly string[]).includes(value))
    return value as AccessAction;
  if (Object.hasOwn(legacyActionMap, value))
    return legacyActionMap[value as LegacyAccessAction];
  return null;
}

/** Legacy seeded-only role adapter; never use this to construct a secure principal. */
export function seededRoleToAccessRole(role: unknown): AccessRole | null {
  if (isAccessRole(role)) return role;
  if (role === "dueno") return "duena";
  if (role === "cajero") return "barra";
  if (role === "cocina") return "mesero";
  return null;
}
