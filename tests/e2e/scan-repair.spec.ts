import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('checkout scans without Enter and searches saved names while typing', async ({ page, request }) => {
  const code = `FRC-${randomUUID()}`;
  const name = `Protein pancake waffle mix ${randomUUID().slice(0, 8)}`;
  const response = await request.post('/api/inventory', { data: { name, barcode: code, quantity: 8, weightPerUnitLbs: '1', valuePerUnitUsd: '3' }, headers: { 'Idempotency-Key': randomUUID() } });
  expect(response.ok()).toBeTruthy();
  const item = await response.json();
  await page.goto('/check-out');
  const scan = page.getByTestId('input-barcode');
  await scan.focus();
  await scan.pressSequentially(code, { delay: 2 });
  await expect(page.getByTestId(`input-cart-quantity-${item.id}`)).toBeVisible();
  await expect(scan).toHaveValue('');
  const search = page.getByRole('combobox', { name: 'Search inventory to add to cart' });
  await search.fill('Protein pancake');
  await expect(page.getByRole('option', { name: new RegExp(name) })).toBeVisible();
  await search.press('Enter');
  await expect(page.getByTestId(`input-cart-quantity-${item.id}`)).toHaveValue('2');
  await page.reload();
  await page.getByTestId('input-barcode').fill(code);
  await expect(page.getByTestId(`input-cart-quantity-${item.id}`)).toHaveValue('1');
});

test('checkin remembers a nonnumeric saved QR identifier without Enter', async ({ page, request }) => {
  const code = `https://inventory.example.invalid/item/${randomUUID()}`;
  const name = `Remembered package ${randomUUID().slice(0, 8)}`;
  const response = await request.post('/api/inventory', { data: { name, barcode: code, quantity: 0 }, headers: { 'Idempotency-Key': randomUUID() } });
  expect(response.ok()).toBeTruthy();
  await page.goto('/check-in');
  await page.getByTestId('input-checkin-barcode-scan').fill(code);
  await expect(page.getByTestId('text-selected-item-details')).toContainText(name);
});

test('a previously unknown code attaches to the selected item and survives a fresh page', async ({ page, request }) => {
  const name = `Remember my code ${randomUUID().slice(0, 8)}`;
  const code = `LOCAL-${randomUUID()}`;
  const firstScan = `WRONG-${randomUUID()}`;
  const created = await request.post('/api/inventory', { data: { name, quantity: 0 } });
  const item = await created.json();
  await page.goto('/check-in');
  await page.getByTestId('input-checkin-barcode-scan').fill(firstScan);
  await expect(page.getByTestId('input-new-item-name')).toBeVisible();
  await page.getByTestId('input-new-item-barcode').fill(code);
  await page.getByTestId('input-new-item-name').fill(name);
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await expect(page.getByTestId('text-selected-item-details')).toContainText(code);
  await page.getByTestId('input-quantity-received').fill('2');
  await page.getByTestId('button-save-check-in').click();
  await expect.poll(async () => (await (await request.get(`/api/inventory/${item.id}`)).json()).quantity).toBe(2);
  const saved = await (await request.get(`/api/inventory/${item.id}`)).json();
  expect(saved.barcode).toBe(code);
  await page.reload();
  await page.getByTestId('input-checkin-barcode-scan').fill(code);
  await expect(page.getByTestId('text-selected-item-details')).toContainText(name);
  const another = await (await request.post('/api/inventory', { data: { name: `${name} separate`, quantity: 0 } })).json();
  const conflict = await request.post(`/api/inventory/${another.id}/barcode`, { data: { barcode: code } });
  expect(conflict.status()).toBe(409);
  const replacement = await request.post(`/api/inventory/${item.id}/barcode`, { data: { barcode: `OTHER-${randomUUID()}` } });
  expect(replacement.status()).toBe(409);
});

test('photo upload keeps typed numbers and saving advances and focuses the next correction', async ({ page, request }, info) => {
  const prefix = `Repair queue ${randomUUID().slice(0, 8)}`;
  const rows = [];
  for (const suffix of ['A', 'B']) rows.push(await (await request.post('/api/inventory', { data: { name: `${prefix} ${suffix}`, quantity: 4, weightPerUnitLbs: '0', valuePerUnitUsd: '0' } })).json());
  await page.goto('/inventory');
  const panel = page.getByTestId('inventory-quality');
  await panel.getByLabel('Search review items', { exact: true }).fill(prefix);
  await panel.getByRole('button', { name: `Review measurements for ${rows[0].name}`, exact: true }).click();
  await panel.getByLabel('Reviewed weight per unit', { exact: true }).fill('1.25');
  await panel.getByLabel('Reviewed estimated value per unit', { exact: true }).fill('2.50');
  await panel.getByLabel('Weight source', { exact: true }).fill('Synthetic package net mass label');
  await panel.getByLabel('Value source', { exact: true }).fill('Synthetic dated package receipt');
  const photo = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16; const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#f08020'; ctx.fillRect(0, 0, 16, 16); return canvas.toDataURL('image/png').split(',')[1]; });
  await panel.locator('input[type=file]').setInputFiles({ name: 'synthetic-product.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64') });
  await expect(panel).toContainText('Photo saved. Your measurement entries are kept.');
  await expect(panel.getByLabel('Reviewed weight per unit', { exact: true })).toHaveValue('1.25');
  const save = panel.getByRole('button', { name: 'Save reviewed measurements', exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(panel.getByRole('heading', { name: `Review: ${rows[1].name}`, exact: true })).toBeFocused();
  const saved = await (await request.get(`/api/inventory/${rows[0].id}`)).json();
  expect(Number(saved.weightPerUnitLbs)).toBe(1.25); expect(Number(saved.valuePerUnitUsd)).toBe(2.5); expect(saved.quantity).toBe(4);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('correction-next-mobile.png'), fullPage: true });
  await panel.getByLabel('Items to show', { exact: true }).selectOption('all');
  await panel.getByRole('button', { name: `Review measurements for ${rows[0].name}`, exact: true }).click();
  await expect(panel.getByLabel('Reviewed weight per unit', { exact: true })).toHaveValue('');
  await panel.getByLabel('Reviewed estimated value per unit', { exact: true }).fill('3.25');
  await panel.getByLabel('Value source', { exact: true }).fill('Synthetic corrected package price');
  await panel.getByRole('button', { name: 'Save reviewed measurements', exact: true }).click();
  await expect.poll(async () => Number((await (await request.get(`/api/inventory/${rows[0].id}`)).json()).valuePerUnitUsd)).toBe(3.25);
});


