import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
let api: APIRequestContext;
const names = { donor: 'Entity E2E Donor', partner: 'Entity E2E Partner', student: 'Entity E2E Student' };
const ids: Record<string, string> = {};
async function post(url: string, data: unknown) {
  const key = createHash('sha256').update(JSON.stringify([url,data])).digest('hex');
  const response = await api.post(url, {data, headers:{'Idempotency-Key':`entity-report-${key}`}});
  expect(response.status(), await response.text()).toBe(201); return response.json();
}
test.beforeAll(async ({playwright,baseURL}) => {
  api = await playwright.request.newContext({baseURL,storageState:path.resolve(process.env.FRC_E2E_AUTH_DIR || '.tmp/e2e-auth','admin.json')});
  ids.donor = (await post('/api/donors',{name:names.donor,email:'entity-donor@example.test'})).id;
  for(const kind of ['partner','student']) ids[kind] = (await post('/api/clients',{name:names[kind as keyof typeof names],identifier:`ENTITY-E2E-${kind}`,clientType:kind,email:`entity-${kind}@example.test`})).id;
  const item = await post('/api/inventory',{name:'Entity E2E Rice',quantity:100,weightPerUnitLbs:'0.5',valuePerUnitUsd:'1.25'});
  const items=[{inventoryItemId:item.id,name:item.name,quantity:1,weightPerUnitLbs:'0.5',valuePerUnitUsd:'1.25'}];
  for(const kind of ['donor','partner','student']) {
    await post('/api/transactions',{type:'IN',timestamp:'2023-09-30T18:00:00Z',source:'Donation',donor:names[kind as keyof typeof names],...(kind==='donor'?{donorId:ids[kind]}:{clientId:ids[kind]}),items});
    if(kind!=='donor') await post('/api/transactions',{type:'OUT',timestamp:'2023-09-30T18:01:00Z',clientId:ids[kind],items});
  }
  for(let i=0;i<27;i++) await post('/api/transactions',{type:'OUT',timestamp:`2023-09-30T19:${String(i).padStart(2,'0')}:00Z`,clientId:ids.partner,items});
});
test.afterAll(async()=>{await api?.dispose();});
async function select(page:Page, kind:keyof typeof names){
  await page.getByTestId('picker-entity-report').click();
  await page.getByTestId('picker-entity-report-search').fill(names[kind]);
  await page.getByRole('option').filter({hasText:names[kind]}).click();
  await expect(page.getByTestId('text-entity-report-name')).toHaveText(names[kind]);
}
async function open(page:Page){
  await page.goto('/reports');
  await page.getByTestId('input-report-from').fill('2023-09-30');
  await page.getByTestId('input-report-to').fill('2023-09-30');
  await expect(page.getByTestId('picker-entity-report')).toBeEnabled();
}
test('staff can search all three entity types and export every partner entry beyond the visible page',async({page},testInfo)=>{
  await open(page);
  for(const kind of ['donor','student','partner'] as const){
    await select(page,kind);
    await expect(page.getByTestId('entity-report-body')).toContainText('Contributed to the pantry');
    await expect(page.getByTestId('entity-report-body')).toContainText('Distributed by the pantry');
  }
  await expect(page.getByRole('navigation',{name:'Record activity pages'})).toContainText('of 29');
  await expect(page.locator('[data-testid^="row-entity-report-"]')).toHaveCount(25);
  const download=page.waitForEvent('download');
  await page.getByTestId('button-export-entity-report').click();
  const file=await download; const output=testInfo.outputPath('individual-partner.csv'); await file.saveAs(output);
  const csv=await readFile(output,'utf8'); expect(csv).toContain('Rows in this file,29'); expect(csv.match(/Entity E2E Rice/g)).toHaveLength(29);
  await page.getByRole('navigation',{name:'Record activity pages'}).getByRole('button',{name:'Next'}).click();
  await expect(page.locator('[data-testid^="row-entity-report-"]')).toHaveCount(4);
});
test('a report read failure is visible and retryable without a false zero activity claim',async({page})=>{
  await page.context().route('**/api/reports/entity/**', route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic report outage'})}));
  await open(page);
  await page.getByTestId('picker-entity-report').click();
  await page.getByTestId('picker-entity-report-search').fill(names.student);
  await page.getByRole('option').filter({hasText:names.student}).click();
  await expect(page.getByTestId('error-entity-report')).toContainText('Could not load');
  await expect(page.getByTestId('text-entity-report-no-rows')).toHaveCount(0);
  await expect(page.getByTestId('button-export-entity-report')).toHaveCount(0);
  await page.context().unroute('**/api/reports/entity/**');
  await page.getByRole('button',{name:'Retry activity'}).click();
  await expect(page.getByTestId('text-entity-report-name')).toHaveText(names.student);
});
test('volunteers cannot call the individual export endpoint',async({playwright,baseURL})=>{
  const email=process.env.FRC_E2E_VOLUNTEER_EMAIL,password=process.env.FRC_E2E_VOLUNTEER_PASSWORD;
  if(!email||!password) throw new Error('Synthetic volunteer credentials are required.');
  const volunteer=await playwright.request.newContext({baseURL,storageState:{cookies:[],origins:[]}});
  try {
    expect((await volunteer.post('/api/auth/login',{data:{email,password}})).status()).toBe(200);
    expect((await volunteer.get(`/api/reports/entity/partner/${ids.partner}`)).status()).toBe(200);
    expect((await volunteer.get(`/api/reports/entity/partner/${ids.partner}/export`)).status()).toBe(403);
  } finally {await volunteer.dispose();}
});
