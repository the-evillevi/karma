export const ACCESS_ROLES = ["duena", "encargado", "barra", "mesero"] as const;

export type AccessRole = (typeof ACCESS_ROLES)[number];
export type AccessAction =
  | "openOrder"
  | "checkout"
  | "cancelWithReason"
  | "discountWithReason"
  | "editMenu"
  | "adjustInventory"
  | "viewStock"
  | "viewReports"
  | "manageUsers"
  | "prepareOrder";

const permissions: Record<AccessRole, ReadonlySet<AccessAction>> = {
  duena: new Set([
    "openOrder",
    "checkout",
    "cancelWithReason",
    "discountWithReason",
    "editMenu",
    "adjustInventory",
    "viewStock",
    "viewReports",
    "manageUsers",
    "prepareOrder",
  ]),
  encargado: new Set([
    "openOrder",
    "checkout",
    "cancelWithReason",
    "discountWithReason",
    "editMenu",
    "adjustInventory",
    "viewStock",
    "viewReports",
    "prepareOrder",
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
  return role !== null && role !== undefined && permissions[role].has(action);
}

/** Legacy seeded-only role adapter; never use this to construct a secure principal. */
export function seededRoleToAccessRole(role: unknown): AccessRole | null {
  if (isAccessRole(role)) return role;
  if (role === "cajero") return "barra";
  if (role === "cocina") return "mesero";
  return null;
}
