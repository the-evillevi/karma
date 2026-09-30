import { expect, test } from '@playwright/test';

test('demo preview labels test data and preserves POS/kitchen navigation under its host prefix', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.name));
  await page.goto('./');
  await expect(page.getByLabel('Entorno de demostración')).toContainText('Sin cobros reales');
  await expect(page.getByText('¿Quién abre la estación?')).toBeVisible();
  for (let index = 0; index < 4; index++) await page.getByRole('button', { name: '3', exact: true }).click();
  const kitchen = page.getByRole('link', { name: 'Ver comanda de cocina →' });
  await expect(kitchen).toHaveAttribute('href', '/karma/comanda.html');
  await kitchen.click();
  await expect(page).toHaveURL(/\/karma\/comanda\.html$/);
  await expect(page.getByText('Comanda · Cocina y barra', { exact: true })).toBeVisible();
  const pos = page.getByRole('link', { name: 'Ir a la caja →' });
  await expect(pos).toHaveAttribute('href', '/karma/');
  await pos.click();
  await expect(page).toHaveURL(/\/karma\/$/);
  expect(errors).toEqual([]);
});

test('built preview offsets the desktop sidebar below its notice and layers mobile navigation above it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem('karma-pos-v1', JSON.stringify({ session: 'u1' }));
  });
  await page.goto('./');
  await expect(page.getByLabel('Entorno de demostración')).toBeVisible();

  const desktopSidebar = page.locator('[data-slot="sidebar-container"]');
  await expect(desktopSidebar).toBeVisible();
  const desktopMetrics = await page.evaluate(() => {
    const notice = document.querySelector('.karma-preview-notice')?.getBoundingClientRect();
    const sidebar = document.querySelector('[data-slot="sidebar-container"]')?.getBoundingClientRect();
    return {
      noticeBottom: notice?.bottom ?? -1,
      sidebarTop: sidebar?.top ?? -1,
      sidebarBottom: sidebar?.bottom ?? -1,
      viewportHeight: window.innerHeight,
      appOffset: getComputedStyle(document.documentElement).getPropertyValue('--karma-app-offset').trim(),
    };
  });
  expect(desktopMetrics.appOffset).toBe('40px');
  expect(desktopMetrics.sidebarTop).toBeGreaterThanOrEqual(desktopMetrics.noticeBottom - 1);
  expect(desktopMetrics.sidebarBottom).toBeLessThanOrEqual(desktopMetrics.viewportHeight + 1);

  await page.setViewportSize({ width: 390, height: 844 });
  const menuTrigger = page.getByRole('button', { name: 'Abrir menú de navegación' });
  await menuTrigger.click();
  const navigationSheet = page.getByRole('dialog', { name: 'Menú de navegación' });
  await expect(navigationSheet).toBeVisible();
  const layerMetrics = await page.evaluate(() => ({
    notice: Number.parseInt(getComputedStyle(document.querySelector('.karma-preview-notice')).zIndex, 10),
    overlay: Number.parseInt(getComputedStyle(document.querySelector('[data-slot="sheet-overlay"]')).zIndex, 10),
    sheet: Number.parseInt(getComputedStyle(document.querySelector('[data-mobile="true"][data-sidebar="sidebar"]')).zIndex, 10),
  }));
  expect(layerMetrics.overlay).toBeGreaterThan(layerMetrics.notice);
  expect(layerMetrics.sheet).toBeGreaterThan(layerMetrics.notice);
  await page.keyboard.press('Escape');
});
