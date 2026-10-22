import { test, expect, type APIRequestContext, type Page, type Response } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
const unique = (label: string) => `${label} ${randomUUID().slice(0, 8)}`;
const transactionWrite = (response: Response) => new URL(response.url()).pathname === '/api/transactions' && response.request().method() === 'POST';
async function post(api: APIRequestContext, url: string, data: unknown) {
  const response = await api.post(url, { data, headers: { 'Idempotency-Key': randomUUID() } });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}
async function item(api: APIRequestContext) {
  return post(api, '/api/inventory', { name: unique('Shared workflow rice'), category:'Grains', quantity:20, weightPerUnitLbs:'1', valuePerUnitUsd:'2' });
}
async function prepareReceiving(page: Page, savedItem: {id:string;name:string}, quantity: string) {
  await page.goto('/check-in');
  await page.getByTestId('input-existing-item-name').fill(savedItem.name);
  await expect(page.getByTestId(`input-existing-item-name-option-${savedItem.id}`)).toBeVisible();
  await page.getByTestId('input-existing-item-name').press('Enter');
  await page.getByTestId('input-quantity-received').fill(quantity);
  await page.getByLabel('Source', {exact:true}).click();
  await page.getByRole('option', {name:'Donation',exact:true}).click();
}

test('two devices share Pastor James after inline receiving while the second keeps its unsaved item and quantity', async ({browser, request, baseURL}, testInfo) => {
  test.setTimeout(75_000);
  const savedItem = await item(request);
  const donorName = unique('Synthetic Pastor James');
  const auth = path.resolve(process.env.FRC_E2E_AUTH_DIR || '.tmp/e2e-auth','admin.json');
  const deviceA = await browser.newContext({baseURL,storageState:auth});
  const deviceB = await browser.newContext({baseURL,storageState:auth});
  try {
    const a = await deviceA.newPage(), b = await deviceB.newPage();
    await prepareReceiving(a,savedItem,'2');
    await prepareReceiving(b,savedItem,'7');
    let navigations = 0;
    b.on('framenavigated', frame => {if(frame===b.mainFrame()) navigations++;});
    await b.getByTestId('picker-donor').click();
    await b.getByTestId('picker-donor-search').fill(donorName);
    await expect(b.getByText('No saved source matches that.',{exact:false})).toBeVisible();
    // B stays open on an unmatched query; no reload, focus call or manual refresh.
    const bReads: number[] = [];
    b.on('response', response => { if(new URL(response.url()).pathname==='/api/donation-sources' && response.status()===200) bReads.push(Date.now()); });
    await a.getByTestId('picker-donor').click();
    await a.getByTestId('picker-donor-register-new').click();
    await a.getByRole('textbox',{name:'New donor name',exact:true}).fill(donorName);
    const [first] = await Promise.all([a.waitForResponse(transactionWrite),a.getByTestId('button-save-check-in').click()]);
    expect(first.status(),await first.text()).toBe(201);
    const firstTx = await first.json();
    expect(firstTx.donorId).toEqual(expect.any(String));
    const firstSavedAt = Date.now();
    await expect(b.getByTestId(`picker-donor-option-donor:${firstTx.donorId}`)).toBeVisible({timeout:45_000});
    await expect(b.getByTestId('input-existing-item-name')).toHaveValue(savedItem.name);
    await expect(b.getByTestId('input-quantity-received')).toHaveValue('7');
    await expect(b.getByTestId('picker-donor-search')).toHaveValue(donorName);
    expect(navigations).toBe(0);
    expect(bReads.length).toBeGreaterThan(0);
    // Typing a matching name and pressing Enter must choose the saved record,
    // even though the always-available Register option is in the same command.
    await b.getByTestId('picker-donor-search').fill(donorName.slice(0,-1));
    await b.getByTestId('picker-donor-search').fill(donorName);
    await b.getByTestId('picker-donor-search').press('Enter');
    await expect(b.getByTestId('picker-donor')).toContainText(donorName);
    await expect(b.getByRole('textbox',{name:'New donor name',exact:true})).toHaveCount(0);
    const [second] = await Promise.all([b.waitForResponse(transactionWrite),b.getByTestId('button-save-check-in').click()]);
    expect(second.status(),await second.text()).toBe(201);
    expect((await second.json()).donorId).toBe(firstTx.donorId);
    const donors = await (await request.get('/api/donors')).json();
    expect(donors.filter((row:{name:string})=>row.name===donorName)).toHaveLength(1);
    const inventory = await (await request.get(`/api/inventory/${savedItem.id}`)).json();
    expect(inventory.quantity).toBe(29);
    await testInfo.attach('shared-source-freshness',{body:JSON.stringify({noNavigation:navigations===0,firstSavedAt,observedRefreshes:bReads,donorId:firstTx.donorId,preservedQuantity:7}),contentType:'application/json'});
    await b.screenshot({path:testInfo.outputPath('shared-pastor-james-receiving.png'),fullPage:true,animations:'disabled'});
  } finally {await deviceA.close();await deviceB.close();}
});

test('typed partner selection and Enter use the existing partner for checkout',async({page,request})=>{
  const partner = await post(request,'/api/clients',{name:unique('Shared workflow partner'),identifier:unique('PARTNER'),clientType:'partner',email:`${randomUUID()}@example.test`});
  const savedItem=await item(request);
  await page.goto('/check-out');
  await page.getByTestId('button-client-search').click();
  await page.getByTestId('input-client-search').fill(partner.name);
  await expect(page.getByTestId(`option-client-${partner.id}`)).toBeVisible();
  await page.getByTestId('input-client-search').press('Enter');
  await expect(page.getByTestId('input-client-name')).toHaveValue(partner.name);
  await expect(page.getByTestId('input-client-identifier')).toHaveValue(partner.identifier);
  await page.getByTestId('select-cart-item').click();
  await page.getByTestId(`option-cart-item-${savedItem.id}`).click();
  const [response]=await Promise.all([page.waitForResponse(transactionWrite),page.getByTestId('button-save-check-out').click()]);
  expect(response.status(),await response.text()).toBe(201); expect((await response.json()).clientId).toBe(partner.id);
  const clients=await (await request.get('/api/clients')).json();
  expect(clients.filter((row:{name:string})=>row.name===partner.name)).toHaveLength(1);
});

test('a 320px source picker exposes failed reads, retries, fits the viewport and selects by keyboard',async({page,request},testInfo)=>{
  const donor=await post(request,'/api/donors',{name:unique('Mobile shared donor')});
  const savedItem=await item(request);
  await page.setViewportSize({width:320,height:800});
  await page.context().route('**/api/donation-sources',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic directory outage'})}));
  await prepareReceiving(page,savedItem,'7');
  await expect(page.getByTestId('picker-donor-error')).toContainText('Could not load saved sources');
  await expect(page.getByTestId('picker-donor')).toBeDisabled();
  await page.context().unroute('**/api/donation-sources');
  await page.getByRole('button',{name:'Retry sources',exact:true}).click();
  await expect(page.getByTestId('picker-donor')).toBeEnabled();
  await expect(page.getByTestId('input-quantity-received')).toHaveValue('7');
  await page.getByTestId('picker-donor').click();
  await page.getByTestId('picker-donor-search').fill(donor.name);
  const bounds=await page.getByRole('listbox').boundingBox();
  expect(bounds).not.toBeNull(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(321);
  await page.screenshot({path:testInfo.outputPath('320px-source-picker.png'),fullPage:true,animations:'disabled'});
  await page.getByTestId('picker-donor-search').press('Enter');
  await expect(page.getByTestId('picker-donor')).toContainText(donor.name);
  await expect(page.getByTestId('input-quantity-received')).toHaveValue('7');
  const layout=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width+1);
});
