import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

for (const width of [1440, 320]) {
  test(`event checkout without registration at ${width}px`, async ({ page, request }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const label = `Thanksgiving synthetic ${randomUUID()}`;
    const eventResponse = await request.post('/api/frc-events', { data: { name: label, startsAt: new Date().toISOString() } });
    expect(eventResponse.status()).toBe(201);
    const event = await eventResponse.json();
    const item = await (await request.post('/api/inventory', { data: { name: label, quantity: 100 } })).json();
    const clientsBefore = await (await request.get('/api/clients')).json();
    expect((await request.put('/api/frc-events/session', { data: { eventId: null } })).ok()).toBeTruthy();
    await page.goto('/check-out');
    await page.getByRole('radio', { name: 'Event only', exact: true }).check();
    await expect(page.getByTestId('input-client-name')).toHaveCount(0);
    await page.getByTestId('select-cart-item').click();
    await page.getByTestId(`option-cart-item-${item.id}`).click();
    await page.getByTestId(`input-cart-quantity-${item.id}`).fill('25');
    await expect(page.getByTestId('button-save-check-out')).toBeDisabled();
    await page.getByTestId('select-active-event').click();
    await page.getByTestId(`option-event-${event.id}`).click();
    await expect(page.getByTestId('button-save-check-out')).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('event-only-cart.png'), fullPage: true });
    const [response] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === '/api/transactions' && r.request().method() === 'POST'),
      page.getByTestId('button-save-check-out').click(),
    ]);
    expect(response.status(), await response.text()).toBe(201);
    const saved = await response.json();
    expect(saved).toMatchObject({ clientId: null, clientName: null, eventId: event.id });
    expect(saved.items[0].quantity).toBe(25);
    const receipt = page.getByRole('dialog', { name: 'Distribution Receipt' });
    await receipt.hover();
    await expect(receipt).toHaveCSS('opacity', '1');
    await expect(receipt).toContainText('Distribution without individual information');
    await expect(receipt).toContainText(label);
    await page.screenshot({ path: info.outputPath('event-only-receipt.png'), fullPage: true });
    expect((await (await request.get(`/api/inventory/${item.id}`)).json()).quantity).toBe(75);
    expect(await (await request.get('/api/clients')).json()).toEqual(clientsBefore);
    // Retrying the exact saved request must replay the same transaction.
    const original = response.request();
    const replay = await request.post('/api/transactions', { data: original.postDataJSON(), headers: { 'Idempotency-Key': original.headers()['idempotency-key'] } });
    expect(replay.ok()).toBeTruthy();
    expect((await replay.json()).id).toBe(saved.id);
    expect((await (await request.get(`/api/inventory/${item.id}`)).json()).quantity).toBe(75);
    await receipt.getByRole('button', { name: 'Close', exact: true }).first().click();
    await page.getByRole('radio', { name: 'Individual information', exact: true }).check();
    await expect(page.getByTestId('input-client-name')).toBeVisible();
  });
}

test('a check in save error has a visible named dismiss control and keeps the entry', async ({ page, request }, info) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const barcode = `ERROR-${randomUUID()}`;
  const item = await (await request.post('/api/inventory', { data: { name: barcode, barcode, quantity: 0 } })).json();
  await page.goto('/check-in');
  await page.getByTestId('input-checkin-barcode-scan').fill(barcode);
  await expect(page.getByTestId('text-selected-item-details')).toContainText(barcode);
  await page.getByTestId('input-quantity-received').fill('3');
  await page.context().route('**/api/transactions', async route => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic save failure' }) });
    else await route.continue();
  });
  await page.getByTestId('button-save-check-in').click();
  const close = page.getByRole('listitem').filter({ hasText: 'Check-in failed' }).getByRole('button', { name: 'Dismiss notification', exact: true });
  await expect(close).toBeVisible();
  await expect(close).toHaveCSS('opacity', '1');
  await page.screenshot({ path: info.outputPath('checkin-error.png'), fullPage: true });
  await close.click();
  await expect(close).toBeHidden();
  await expect(page.getByTestId('input-quantity-received')).toHaveValue('3');
  expect((await (await request.get(`/api/inventory/${item.id}`)).json()).quantity).toBe(0);
  await page.context().unroute('**/api/transactions');
  await page.getByTestId('button-save-check-in').click();
  await expect.poll(async () => (await (await request.get(`/api/inventory/${item.id}`)).json()).quantity).toBe(3);
});
