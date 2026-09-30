import { expect, test } from '@playwright/test';

async function openSeededPos(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    localStorage.setItem('karma-pos-v1', JSON.stringify({ session: 'u1' }));
  });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Estación de venta' })).toBeVisible();
}

async function expectNoPageOverflow(page, width) {
  const dimensions = await page.evaluate(() => {
    const main = document.querySelector('.pos-main');
    const mainBounds = main?.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      main: main?.clientWidth ?? null,
      mainScroll: main?.scrollWidth ?? null,
      header: main?.querySelector('.pos-mobile-bar') ? [...main.querySelector('.pos-mobile-bar').children].map(child => `${child.tagName}.${String(child.className).slice(0, 28)}:${Math.round(child.getBoundingClientRect().left)}-${Math.round(child.getBoundingClientRect().right)} w${Math.round(child.getBoundingClientRect().width)}`).join(' | ') : '',
      offenders: main && mainBounds ? [...main.querySelectorAll('*')]
        .map(element => ({ element, bounds: element.getBoundingClientRect() }))
        .filter(({ bounds }) => bounds.right > mainBounds.right + 1 && bounds.width < 900)
        .slice(0, 8)
        .map(({ element, bounds }) => `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 48)} x=${Math.round(bounds.left)} right=${Math.round(bounds.right)} w=${Math.round(bounds.width)}`) : [],
    };
  });
  expect(dimensions.viewport).toBe(width);
  expect(dimensions.document).toBeLessThanOrEqual(width);
  expect(dimensions.body).toBeLessThanOrEqual(width);
  if (dimensions.main !== null) expect(dimensions.mainScroll, `${dimensions.header}\n${dimensions.offenders.join('\n')}`).toBeLessThanOrEqual(dimensions.main + 1);
}

async function selectMobileNav(page, label) {
  await page.getByRole('button', { name: 'Abrir menú de navegación' }).click();
  await page.getByRole('dialog', { name: 'Menú de navegación' }).getByRole('button', { name: new RegExp(`^${label}`) }).click();
}

test('POS shell and current order fit desktop, tablet, and phone widths', async ({ page }) => {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 667, height: 375 },
    { width: 430, height: 932 },
    { width: 390, height: 844 },
    { width: 320, height: 640 },
  ]) {
    await openSeededPos(page, viewport.width, viewport.height);
    await expectNoPageOverflow(page, viewport.width);

    if (viewport.width < 768) {
      const navTrigger = page.getByRole('button', { name: 'Abrir menú de navegación' });
      await expect(navTrigger).toBeVisible();
      await expect(page.locator('.pos-sidebar[data-state]')).toHaveCount(0);
      await navTrigger.click();
      const sheet = page.getByRole('dialog', { name: 'Menú de navegación' });
      await expect(sheet.getByText('Conectado')).toBeVisible();
      await expect(sheet.getByRole('button', { name: /^Órdenes abiertas/ })).toBeVisible();
      const syncButton = sheet.getByRole('button', { name: /Sincronizar ahora/ });
      await syncButton.scrollIntoViewIfNeeded();
      await expect(syncButton).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
      await expect(navTrigger).toBeFocused();
      const toggle = page.locator('.sales-mobile-cart-toggle');
      await expect(toggle).toBeVisible();
      await page.keyboard.press('Alt+ArrowDown');
      await expect(page.locator('#sales-cart')).toBeVisible();
      await expect.poll(() => page.locator('#sales-cart').evaluate(cart => cart.contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Escape');
      await expect(page.locator('#sales-cart')).toBeHidden();
      await expect(toggle).toBeFocused();
      await expectNoPageOverflow(page, viewport.width);
    } else {
      await expect(page.locator('[data-slot="sidebar-container"]')).toBeVisible();
      await expect(page.locator('.pos-mobile-bar')).toBeHidden();
      await expect(page.locator('#sales-cart')).toBeVisible();
    }

    await page.reload();
  }
});

test('mobile Sheet shows complete navigation, closes after selection, and restores focus', async ({ page }) => {
  await openSeededPos(page, 390, 844);
  const trigger = page.getByRole('button', { name: 'Abrir menú de navegación' });
  await trigger.click();

  const navigationSheet = page.getByRole('dialog', { name: 'Menú de navegación' });
  await expect(navigationSheet).toBeVisible();
  await expect(navigationSheet.getByRole('button', { name: /Sincronizar ahora/ })).toBeVisible();
  await expect(navigationSheet.getByText('Conectado')).toBeVisible();
  await expect(navigationSheet.getByRole('link', { name: 'Ver comanda de cocina' })).toBeVisible();
  await expect(navigationSheet.getByRole('button', { name: 'Salir' })).toBeVisible();
  await navigationSheet.getByRole('button', { name: 'Inventario' }).click();

  await expect(navigationSheet).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Inventario' })).toBeVisible();
  await expectNoPageOverflow(page, 390);
});

test('phone modules keep primary flows, dialogs, and tables within the viewport', async ({ page }) => {
  await openSeededPos(page, 390, 844);

  await selectMobileNav(page, 'Órdenes abiertas');
  await expect(page.getByRole('heading', { name: 'Órdenes abiertas' })).toBeVisible();
  await expectNoPageOverflow(page, 390);
  await page.getByRole('button', { name: 'Cobrar' }).first().click();
  await expect(page.getByRole('heading', { name: /Cobro/ })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar al pago' }).click();
  await expect(page.getByRole('textbox', { name: /Monto con Efectivo/ })).toBeVisible();
  await expectNoPageOverflow(page, 390);

  await selectMobileNav(page, 'Menú');
  await expect(page.getByRole('textbox', { name: 'Buscar en el menú' })).toBeVisible();
  await expectNoPageOverflow(page, 390);

  await selectMobileNav(page, 'Inventario');
  await expect(page.getByRole('heading', { name: 'Inventario' })).toBeVisible();
  const stockTableCard = page.locator('.pos-main [data-slot="card"]').filter({ has: page.locator('table') }).first();
  await expect(stockTableCard).toBeVisible();
  const tableScroller = stockTableCard.locator('[data-slot="table-container"]');
  const tableCardMetrics = await tableScroller.evaluate(card => ({
    client: card.clientWidth,
    scroll: card.scrollWidth,
    overflowX: getComputedStyle(card).overflowX,
    table: card.querySelector('table')?.getBoundingClientRect().width,
  }));
  expect(tableCardMetrics.scroll, JSON.stringify(tableCardMetrics)).toBeGreaterThan(tableCardMetrics.client);
  await expectNoPageOverflow(page, 390);
  await page.getByRole('button', { name: 'Recetas' }).click();
  await expect(page.getByText('Latte café')).toBeVisible();
  await expectNoPageOverflow(page, 390);

  await selectMobileNav(page, 'Reportes');
  const saleDetailTrigger = page.getByRole('button', { name: /A-1047/ });
  await saleDetailTrigger.click();
  const detail = page.getByRole('dialog', { name: /A-1047/ });
  await expect(detail).toBeVisible();
  const bounds = await detail.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  await page.keyboard.press('Escape');
  await expect(saleDetailTrigger).toBeFocused();
  await expectNoPageOverflow(page, 390);

  await selectMobileNav(page, 'Usuarios y configuración');
  await expect(page.getByRole('heading', { name: 'Usuarios y configuración' })).toBeVisible();
  await page.getByRole('button', { name: 'Usuarios' }).click();
  await page.getByRole('button', { name: 'Marcela Ortiz', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Nombre completo' })).toBeVisible();
  await expectNoPageOverflow(page, 390);
  await page.getByRole('button', { name: 'Configuración' }).click();
  await expect(page.getByRole('switch', { name: 'Imprimir comanda automáticamente' })).toBeVisible();
  await expectNoPageOverflow(page, 390);
});

test('Comanda remains usable without page overflow on phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/comanda.html');
  await expect(page.getByRole('button', { name: 'Marcar listo' }).first()).toBeVisible();
  await expectNoPageOverflow(page, 390);
});

test('phone cart item controls keep touch size and product editor fits the viewport', async ({ page }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
    await openSeededPos(page, viewport.width, viewport.height);
    await page.getByRole('button', { name: /^Americano, \$50\.00/ }).click();
    const editor = page.getByRole('dialog', { name: 'Americano' });
    await expect(editor).toBeVisible();
    const editorBounds = await editor.boundingBox();
    expect(editorBounds.x).toBeGreaterThanOrEqual(0);
    expect(editorBounds.y).toBeGreaterThanOrEqual(0);
    expect(editorBounds.x + editorBounds.width).toBeLessThanOrEqual(viewport.width);
    expect(editorBounds.y + editorBounds.height).toBeLessThanOrEqual(viewport.height);
    await editor.getByRole('button', { name: /^Agregar/ }).click();

    const cartToggle = page.locator('.sales-mobile-cart-toggle');
    await cartToggle.click();
    const increment = page.getByRole('button', { name: 'Aumentar Americano' });
    const target = await increment.boundingBox();
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
    await increment.click();
    await expect(page.locator('.sales-quantity-controls').getByText('2')).toBeVisible();
    await expectNoPageOverflow(page, viewport.width);
    await page.reload();
  }
});
