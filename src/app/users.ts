import type { User } from "../domain/access.ts";

export const PILOT_USERS: readonly User[] = [
  {
    userId: "u-admin",
    name: "Admin",
    role: "admin",
    pinDigest:
      "e27aa2a5c116742b80903e208a4b650fc073318b83e9eccd64354e43f557b6f4",
    active: true,
  },
  {
    userId: "u-barra",
    name: "Barra",
    role: "barra",
    pinDigest:
      "cd57ba41ea510858f239c96d46144fc7b9758d002e9f5556127fb00b7f71282e",
    active: true,
  },
  {
    userId: "u-mesero",
    name: "Mesero",
    role: "mesero",
    pinDigest:
      "ae54c64095c2ee77dcdec6ad728dd1c1a69ec614a1d62cd157c465b3bf37454a",
    active: true,
  },
];
