import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function post(api: APIRequestContext, url: string, data: unknown) {
  const response = await api.post(url, { data, headers: { 'Idempotency-Key': randomUUID() } });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

test('visible inventory review queue searches and filters, keeps drafts while browsing, and fits320px', async ({ page, request }, info) => {
  const prefix = `Review queue ${randomUUID().slice(0, 8)}`;
  const weight = await post(request, '/api/inventory', { name: `${prefix} weight`, quantity: 5, weightPerUnitLbs: '0', valuePerUnitUsd: '2' });
  const price = await post(request, '/api/inventory', { name: `${prefix} price`, quantity: 0, weightPerUnitLbs: '1', valuePerUnitUsd: '0' });
  const both = await post(request, '/api/inventory', { name: `${prefix} both`, quantity: 8, reservedQuantity: 2, weightPerUnitLbs: '0', valuePerUnitUsd: '0' });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/inventory');
  const panel = page.getByTestId('inventory-quality');
  await expect(panel.getByRole('heading', { name: 'Inventory data quality' })).toBeVisible();
  await expect(panel.getByRole('button', { name: /Missing both/ })).toBeVisible();
  await panel.getByLabel('Search review items', { exact: true }).fill(prefix);
  const queue = panel.getByRole('list', { name: 'Inventory measurement review queue' });
  await expect(queue.getByRole('listitem')).toHaveCount(3);
  await panel.getByLabel('Items to show', { exact: true }).selectOption('both');
  await expect(queue.getByRole('listitem')).toHaveCount(1);
  await expect(queue).toContainText(both.name);
  await expect(queue).toContainText('8 in stock; 2 reserved');
  const review = queue.getByRole('button', { name: `Review measurements for ${both.name}`, exact: true });
  await review.focus(); await page.keyboard.press('Enter');
  await expect(panel.getByRole('heading', { name: `Review: ${both.name}`, exact: true })).toBeFocused();
  await panel.getByLabel('Reviewed weight per unit', { exact: true }).fill('1.25');
  await panel.getByLabel('Weight source', { exact: true }).fill('Synthetic package label reviewed for queue test');
  await expect(panel.getByLabel('Correction scope', { exact: true })).toHaveValue('future_only');
  await panel.getByLabel('Items to show', { exact: true }).selectOption('value');
  await expect(queue.getByRole('listitem')).toHaveCount(2);
  await queue.getByRole('button', { name: `Review measurements for ${price.name}`, exact: true }).click();
  await expect(panel.getByLabel('Reviewed weight per unit', { exact: true })).toHaveValue('');
  await queue.getByRole('button', { name: `Review measurements for ${both.name}`, exact: true }).click();
  await expect(panel.getByLabel('Reviewed weight per unit', { exact: true })).toHaveValue('1.25');
  await panel.getByLabel('Items to show', { exact: true }).selectOption('weight');
  await expect(queue.getByRole('listitem')).toHaveCount(2); await expect(queue).toContainText(weight.name);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('inventory-quality-mobile320.png'), fullPage: true });
  await page.context().route('**/api/inventory/quality', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic quality fetch failure' }) }));
  await panel.getByRole('button', { name: 'Refresh completeness check', exact: true }).click();
  await expect(panel).toContainText('The totals below are from the last successful check.');
  await expect(panel.getByLabel('Reviewed weight per unit', { exact: true })).toHaveValue('1.25');
});

test('staff preview missing history and explicitly replace incorrect measurements without changing stock or recipients', async ({ page, request }, info) => {
  const name = `History package ${randomUUID().slice(0, 8)}`;
  const item = await post(request, '/api/inventory', { name, quantity: 20, weightPerUnitLbs: '0', valuePerUnitUsd: '0' });
  const client = await post(request, '/api/clients', { name: `History partner ${randomUUID()}`, identifier: randomUUID(), clientType: 'partner' });
  const transactions = [];
  for (const [index, spec] of [{ type: 'IN', quantity: 3, weight: '0', value: '0' }, { type: 'OUT', quantity: 2, weight: '0', value: '0' }, { type: 'OUT', quantity: 1, weight: '0.5', value: '2' }].entries()) {
    transactions.push(await post(request, '/api/transactions', { type: spec.type, timestamp: `2022-03-12T18:0${index}:00Z`, clientId: client.id, items: [{ inventoryItemId: item.id, name, quantity: spec.quantity, weightPerUnitLbs: spec.weight, valuePerUnitUsd: spec.value }] }));
  }
  const before = await (await request.get(`/api/inventory/${item.id}`)).json();
  const originalHistory = (await (await request.get('/api/transactions')).json()).filter((t: any) => transactions.some(tx => tx.id === t.id));
  await page.goto('/inventory'); const panel = page.getByTestId('inventory-quality');
  await panel.getByLabel('Search review items', { exact: true }).fill(name);
  await panel.getByRole('button', { name: `Review measurements for ${name}`, exact: true }).click();
  await panel.getByLabel('Reviewed weight per unit', { exact: true }).fill('1');
  await panel.getByLabel('Reviewed estimated value per unit', { exact: true }).fill('4');
  await panel.getByLabel('Weight source', { exact: true }).fill('Synthetic unchanged package net mass source');
  await panel.getByLabel('Value source', { exact: true }).fill('Synthetic dated receipt for unchanged package');
  await panel.getByLabel('Correction scope', { exact: true }).selectOption('missing_only');
  await panel.getByLabel('Historical start date', { exact: true }).fill('2022-03-12');
  await panel.getByLabel('Historical end date', { exact: true }).fill('2022-03-12');
  await panel.getByRole('button', { name: 'Preview historical corrections', exact: true }).click();
  await expect(panel.getByTestId('measurement-history-preview')).toContainText('2 historical lines across 2 transactions would change.');
  const save = panel.getByRole('button', { name: 'Save reviewed measurements', exact: true });
  await expect(save).toBeDisabled();
  await panel.getByRole('checkbox', { name: 'I verified that these historical entries use this same package and measurement basis.', exact: true }).check();
  await save.click(); await expect(panel).toContainText('Saved reviewed measurements and the previewed historical corrections.');
  let saved = await (await request.get(`/api/inventory/${item.id}`)).json(); expect(saved.quantity).toBe(before.quantity); expect(saved.reservedQuantity).toBe(before.reservedQuantity);
  let history = (await (await request.get('/api/transactions')).json()).filter((t: any) => transactions.some(tx => tx.id === t.id));
  for (const tx of history) {
    const original = originalHistory.find((t: any) => t.id === tx.id); expect(tx.clientId).toBe(original.clientId); expect(tx.timestamp).toBe(original.timestamp); expect(tx.items[0].quantity).toBe(original.items[0].quantity);
    expect(Number(tx.items[0].weightPerUnitLbs)).toBe(Number(original.items[0].weightPerUnitLbs) > 0 ? 0.5 : 1);
    expect(Number(tx.items[0].valuePerUnitUsd)).toBe(Number(original.items[0].valuePerUnitUsd) > 0 ? 2 : 4);
  }
  await panel.getByLabel('Items to show', { exact: true }).selectOption('all');
  await expect(panel.getByRole('list', { name: 'Inventory measurement review queue' })).toContainText(name);
  await panel.getByLabel('Correction scope', { exact: true }).selectOption('replace_incorrect');
  await panel.getByLabel('Reviewed weight per unit', { exact: true }).fill('2');
  await panel.getByLabel('Weight source', { exact: true }).fill('Synthetic verified correction to same package net mass');
  await panel.getByLabel('Correction reason', { exact: true }).fill('Correct synthetic historical package weight transcription');
  await panel.getByLabel('Historical start date', { exact: true }).fill('2022-03-12'); await panel.getByLabel('Historical end date', { exact: true }).fill('2022-03-12');
  await panel.getByRole('button', { name: 'Preview historical corrections', exact: true }).click();
  await expect(panel.getByTestId('measurement-history-preview')).toContainText('3 historical lines across 3 transactions would change.');
  await panel.getByRole('checkbox', { name: 'I verified that these historical entries use this same package and measurement basis.', exact: true }).check(); await expect(save).toBeDisabled();
  await panel.getByRole('checkbox', { name: 'I reviewed the preview and confirm replacing the incorrect historical measurements.', exact: true }).check();
  await page.setViewportSize({ width: 320, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('inventory-history-replacement-preview320.png'), fullPage: true });
  await save.click(); await expect(panel).toContainText('Saved reviewed measurements and the previewed historical corrections.');
  await expect(panel).toContainText('Correct synthetic historical package weight transcription');
  saved = await (await request.get(`/api/inventory/${item.id}`)).json(); expect(saved.quantity).toBe(before.quantity);
  history = (await (await request.get('/api/transactions')).json()).filter((t: any) => transactions.some(tx => tx.id === t.id));
  for (const tx of history) { expect(Number(tx.items[0].weightPerUnitLbs)).toBe(2); expect(Number(tx.items[0].valuePerUnitUsd)).toBe(tx.id === transactions[2].id ? 2 : 4); }
});

