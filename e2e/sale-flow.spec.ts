// Spec: Linear EVL-116, slice [B]. Test names are the scenario titles.
import { expect, test } from "@playwright/test";
import { PIN, addProduct, order, signIn } from "./helpers.ts";

test("[B] Venta rápida en efectivo de principio a fin", async ({ page }) => {
  // Dado la app recién abierta, cuando entro como Barra (2222), agrego un
  // Americano ($50.00) y cobro con $100.00 en efectivo, entonces veo cambio
  // de $50.00 y la venta aparece en "Ventas de hoy"
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
  await page.getByRole("button", { name: "Listo" }).click();

  await page.getByRole("link", { name: "Ventas de hoy" }).click();
  const sale = page.getByRole("listitem", { name: "Venta A-0001" });
  await expect(sale).toContainText("Efectivo");
  await expect(sale).toContainText("$50.00");

  // A closed sale is still there after the app is reopened.
  await page.reload();
  await signIn(page, PIN.admin);
  await page.getByRole("link", { name: "Ventas de hoy" }).click();
  await expect(
    page.getByRole("listitem", { name: "Venta A-0001" }),
  ).toBeVisible();
});

test("[B] Cuenta de mesa guardada, enviada a cocina y cobrada", async ({
  page,
}) => {
  // Dado una sesión de Mesero (3333), cuando guardo un Latte con Avena en la
  // mesa 3, envío la comanda, recargo la app y Barra (2222) reabre y cobra la
  // cuenta, entonces cocina muestra la comanda, la cuenta conserva partidas y
  // total de $75.00, y la venta queda cerrada
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
  // Paying does not remove the pending comanda (EVL-185).
  await page.getByRole("link", { name: "Cocina" }).click();
  await expect(
    page.getByRole("listitem", { name: "Comanda A-0001" }),
  ).toBeVisible();
});

test("[B] Mesero no puede cobrar", async ({ page }) => {
  // Dado una sesión de Mesero (3333) con una orden de $25.00, cuando busca
  // la acción de cobrar, entonces no está disponible
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
  // EVL-124 [B] Una comanda nueva aparece sin recargar
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
