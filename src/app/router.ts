import { useSyncExternalStore } from "react";
import { can } from "../domain/access.ts";

export const ROUTES = [
  { path: "/", label: "Venta" },
  { path: "/cuentas", label: "Cuentas abiertas" },
  { path: "/cocina", label: "Cocina" },
  { path: "/ventas", label: "Ventas de hoy" },
  { path: "/menu", label: "Menú" },
] as const;

export function mayOpenMenu(role: string): boolean {
  return can(role, "edit-menu") || can(role, "set-availability");
}

export function routesFor(role: string): readonly (typeof ROUTES)[number][] {
  return mayOpenMenu(role)
    ? ROUTES
    : ROUTES.filter((route) => route.path !== "/menu");
}

export type RoutePath = (typeof ROUTES)[number]["path"];

function isRoutePath(value: string): value is RoutePath {
  return ROUTES.some((route) => route.path === value);
}

export function currentRoute(hash: string = window.location.hash): RoutePath {
  const path = hash.replace(/^#/, "") || "/";
  return isRoutePath(path) ? path : "/";
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

export function useRoute(): RoutePath {
  return useSyncExternalStore(subscribe, () => currentRoute());
}

export function hrefFor(path: RoutePath): string {
  return `#${path}`;
}

export function navigate(path: RoutePath): void {
  window.location.hash = path;
}
