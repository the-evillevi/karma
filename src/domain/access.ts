// Roles and permissions (EVL-118). Matrix from EVL-111, 13 Nov 2026:
// Admin can do everything, Barra can charge, Mesero cannot charge.

export const ROLES = ["admin", "barra", "mesero"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "capture-order",
  "send-comanda",
  "charge",
  "cancel",
  "discount",
  "edit-menu",
  "adjust-inventory",
  "view-reports",
  "manage-users",
  "configure-tables",
  "reprint",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Operator-facing role names, as written in Linear and shown in the app. */
export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  barra: "Barra",
  mesero: "Mesero",
};

/** Whether `role` may perform `permission`. Unknown roles may do nothing. */
export function can(role: string, permission: Permission): boolean {
  return permissionsOf(role).includes(permission);
}

/** Every permission the role has, in PERMISSIONS order. */
export function permissionsOf(role: string): Permission[] {
  switch (role) {
    case "admin":
      return [...PERMISSIONS];
    case "barra":
      return ["capture-order", "send-comanda", "charge"];
    case "mesero":
      return ["capture-order", "send-comanda"];
    default:
      return [];
  }
}
