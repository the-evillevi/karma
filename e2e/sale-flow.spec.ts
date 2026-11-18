import { expect, test } from "@playwright/test";
import { PIN, addProduct, order, signIn } from "./helpers.ts";

test("[B] Venta rápida en efectivo de principio a fin", async ({ page }) => {
  await page.goto("/");
  await signIn(page, PIN.barra);
  await addProduct(page, "Americano");
  await page.getByRole("button", { name: "Agregar · $50.00" }).click();
  await page.getByRole("button", { name: "Cobrar · $50.00" }).click();

  const checkout = page.getByRole("dialog", { name: "Cobrar A-0001" });
  await checkout.getByLabel("Efectivo recibido").fill("100");
  await expect(checkout.getByTestId("checkout-change")).toHaveText("$50.00");
  await checkout.getByRole("button", { name: "Registrar pago" }).click();

  const ticket = page.getByRole("article", { name: "Ticket A-0001" });
  await expect(ticket.getByText("Cambio")).toBeVisible();
  await expect(ticket.getByText("$100.00")).toBeVisible();
  await expect(
    ticket.getByText("Cambio", { exact: true }).locator("..").locator("dd"),
  ).toHaveText("$50.00");
  await page.getByRole("button", { name: "Listo" }).click();

  await page.getByRole("link", { name: "Ventas de hoy" }).click();
  const sale = page.getByRole("listitem", { name: "Venta A-0001" });
  await expect(sale).toContainText("Efectivo");
  await expect(sale).toContainText("$50.00");

  await page.reload();
  await signIn(page, PIN.admin);
  await page.getByRole("link", { name: "Ventas de hoy" }).click();
  await expect(
    page.getByRole("listitem", { name: "Venta A-0001" }),
  ).toBeVisible();
  await expect(
    page.getByRole("listitem", { name: "Venta A-0001" }),
  ).toContainText("$50.00");
  await expect(
    page.getByRole("listitem", { name: "Venta A-0001" }),
  ).toContainText("Efectivo");
});

test("[B] Cuenta de mesa guardada, enviada a cocina y cobrada", async ({
  page,
}) => {
  await page.goto("/");
  await signIn(page, PIN.mesero);
  await addProduct(page, "Latte");
  const modifiers = page.getByRole("dialog", { name: "Latte" });
  await modifiers.getByRole("radio", { name: "Avena +$10.00" }).click();
  await modifiers.getByRole("button", { name: "Agregar · $75.00" }).click();
  await order(page).getByRole("radio", { name: "Mesa", exact: true }).click();
  await order(page).getByRole("radio", { name: "Mesa 3" }).click();
  await order(page).getByRole("button", { name: "Enviar comanda" }).click();
  await expect(
    page.getByText("Comanda de A-0001 enviada a cocina"),
  ).toBeVisible();

  await page.reload();
  await signIn(page, PIN.barra);
  await page.getByRole("link", { name: "Cocina" }).click();
  const comanda = page.getByRole("listitem", { name: "Comanda A-0001" });
  await expect(comanda).toContainText("Mesa 3");
  await expect(comanda).toContainText("Avena");
  await expect(comanda).toContainText("En cola");

  await page.getByRole("link", { name: "Cuentas abiertas" }).click();
  const account = page.getByRole("listitem", { name: "Cuenta A-0001" });
  await expect(account).toContainText("$75.00");
  await account.getByRole("button", { name: "Abrir" }).click();
  await expect(order(page).getByTestId("order-total")).toHaveText("$75.00");
  await order(page).getByRole("button", { name: "Cobrar · $75.00" }).click();

  const checkout = page.getByRole("dialog", { name: "Cobrar A-0001" });
  await checkout.getByRole("radio", { name: "Tarjeta manual" }).click();
  await checkout.getByRole("button", { name: "Registrar pago" }).click();
  await expect(
    page.getByRole("article", { name: "Ticket A-0001" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Listo" }).click();

  await page.getByRole("link", { name: "Cuentas abiertas" }).click();
  await expect(page.getByText("No hay cuentas abiertas")).toBeVisible();
  await page.getByRole("link", { name: "Cocina" }).click();
  await expect(
    page.getByRole("listitem", { name: "Comanda A-0001" }),
  ).toBeVisible();
});

test("[B] Mesero no puede cobrar", async ({ page }) => {
  await page.goto("/");
  await signIn(page, PIN.mesero);
  await addProduct(page, "Coca Cola");
  await expect(
    order(page).getByRole("button", { name: "Guardar cuenta" }),
  ).toBeVisible();
  await expect(
    order(page).getByRole("button", { name: /^Cobrar/ }),
  ).toHaveCount(0);
});

test("la cocina en otra pestaña recibe la comanda sin recargar", async ({
  context,
}) => {
  const caja = await context.newPage();
  const cocina = await context.newPage();
  await cocina.goto("/#/cocina");
  await signIn(cocina, PIN.mesero);
  await expect(cocina.getByText("Sin comandas pendientes")).toBeVisible();

  await caja.goto("/");
  await signIn(caja, PIN.mesero);
  await addProduct(caja, "Coca Cola");
  await order(caja).getByRole("button", { name: "Enviar comanda" }).click();

  await expect(
    cocina.getByRole("listitem", { name: "Comanda A-0001" }),
  ).toBeVisible();
});
