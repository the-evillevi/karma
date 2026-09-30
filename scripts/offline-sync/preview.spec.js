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
