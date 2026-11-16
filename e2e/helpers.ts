import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Pilot PINs (Linear EVL-118). */
export const PIN = { admin: "1111", barra: "2222", mesero: "3333" } as const;

export async function signIn(page: Page, pin: string): Promise<void> {
  await expect(page.getByText("Captura tu PIN para entrar")).toBeVisible();
  for (const digit of pin) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await expect(
    page.getByRole("navigation", { name: "Secciones" }),
  ).toBeVisible();
}

export function menu(page: Page) {
  return page.getByRole("region", { name: "Menú" });
}

export function order(page: Page) {
  return page.getByRole("region", { name: "Orden actual" });
}

export async function addProduct(page: Page, name: string): Promise<void> {
  await menu(page)
    .getByRole("button", { name: new RegExp(`^${name}\\s*\\$`) })
    .click();
}
