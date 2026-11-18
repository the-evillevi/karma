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

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  barra: "Barra",
  mesero: "Mesero",
};

export function can(role: string, permission: Permission): boolean {
  return permissionsOf(role).includes(permission);
}

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

export type User = {
  userId: string;
  name: string;
  role: Role;
  pinDigest: string;
  active: boolean;
};

export function findUserByPinDigest(
  users: readonly User[],
  pinDigest: string,
): User | null {
  return (
    users.find((user) => user.active && user.pinDigest === pinDigest) ?? null
  );
}
