import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function product(request: APIRequestContext, brand: string, name = 'Protein pancake waffle mix') {
  const response = await request.post('/api/inventory', { data: { name, brand, quantity: 8, barcode: `BRAND-${randomUUID()}`, weightPerUnitLbs: '1', valuePerUnitUsd: '3' } });
  expect(response.status()).toBe(201);
  return response.json();
}

test('brand has its own visible line and matches mixed name/brand searches throughout staff entry', async ({ page, request }, info) => {
  const brand = `Test Brand ${randomUUID().slice(0,8)}`;
  const item = await product(request, brand);
  const other = await product(request, `Other Brand ${randomUUID().slice(0,8)}`);
  await page.goto('/check-in');
  await page.getByTestId('input-existing-item-name').fill(`${brand} pancake`);
  const option = page.getByRole('option', { name: new RegExp(brand) });
  await expect(option.getByTestId('product-brand')).toHaveText(brand);
  await expect(page.getByTestId(`input-existing-item-name-option-${other.id}`)).not.toBeVisible();
  await option.click();
  await expect(page.getByTestId('text-selected-item-details').getByTestId('product-brand')).toHaveText(brand);
  await page.goto('/check-out');
  await page.getByTestId('input-checkout-item-search').fill(brand);
  await page.getByRole('option', { name: new RegExp(brand) }).click();
  await expect(page.getByTestId(`input-cart-quantity-${item.id}`)).toHaveValue('1');
  await expect(page.getByRole('row').filter({ has: page.getByTestId(`input-cart-quantity-${item.id}`) }).getByTestId('product-brand')).toHaveText(brand);
  await page.goto('/inventory');
  await page.getByPlaceholder('Search by name, brand, category, or barcode').fill(`${brand} pancake`);
  await expect(page.getByTestId(`row-item-${item.id}`).getByTestId('product-brand')).toHaveText(brand);
  await expect(page.getByTestId(`row-item-${other.id}`)).not.toBeVisible();
  await page.setViewportSize({width:320,height:780});
  await expect(page.getByTestId(`row-item-${item.id}`).getByTestId('product-brand')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('brands-mobile.png'),fullPage:true});
});

test('student pickup browsing finds brands and keeps them in the selected item and confirmation', async ({page, request}) => {
  const brand=`Student Brand ${randomUUID().slice(0,8)}`;
  const item=await product(request,brand);
  await page.goto('/kiosk');
  await page.getByRole('button',{name:'Start a Request',exact:true}).click();
  await page.getByTestId('input-req-client-name').fill('Synthetic Brand Student');
  await page.getByTestId('input-req-client-identifier').fill(`BRAND-${randomUUID()}`);
  await page.getByTestId('button-req-continue').click();
  await page.getByTestId('input-item-search').fill(`${brand} pancake`);
  await expect(page.getByTestId(`card-item-${item.id}`).getByTestId('product-brand')).toHaveText(brand);
  await page.getByTestId(`button-item-plus-${item.id}`).click();
  await page.getByRole('button',{name:'Continue with 1 item(s)',exact:true}).click();
  await expect(page.getByTestId('product-brand')).toHaveText(brand);
  await page.getByTestId('textarea-req-reason').fill('Synthetic brand identity verification request.');
  await page.getByTestId('button-reason-submit').click();
  await expect(page.getByTestId('product-brand')).toHaveText(brand);
});

test('server saves canonical brands on receipts and pickup records and keeps them after inventory edits', async ({request}) => {
  const brand=`Saved Brand ${randomUUID().slice(0,8)}`;
  const item=await product(request,brand);
  const txResponse=await request.post('/api/transactions',{data:{type:'OUT',items:[{inventoryItemId:item.id,name:'Forged client description',quantity:1,weightPerUnitLbs:'1',valuePerUnitUsd:'3'}]}});
  expect(txResponse.status()).toBe(201);
  const tx=await txResponse.json();
  expect(tx.items[0].name).toBe(`${brand} — ${item.name}`);
  const reqResponse=await request.post('/api/requests',{data:{clientName:'Synthetic Brand Student',clientIdentifier:`BRAND-${randomUUID()}`,reason:'Synthetic brand snapshot request.',items:[{inventoryItemId:item.id,itemName:'Forged client description',requestedQuantity:1}]}});
  expect(reqResponse.status()).toBe(201);
  const saved=await reqResponse.json();
  expect(saved.items[0].itemName).toBe(`${brand} — ${item.name}`);
  expect((await request.patch(`/api/inventory/${item.id}`,{data:{brand:'Changed later'}})).status()).toBe(200);
  const history=await(await request.get('/api/transactions')).json();
  expect(history.find((row:any)=>row.id===tx.id).items[0].name).toBe(`${brand} — ${item.name}`);
  expect((await(await request.get(`/api/requests/${saved.id}`)).json()).items[0].itemName).toBe(`${brand} — ${item.name}`);
  expect((await request.post(`/api/requests/${saved.id}/approve`,{data:{items:[{id:saved.items[0].id,approvedQuantity:1}]}})).status()).toBe(200);
  expect((await request.post(`/api/requests/${saved.id}/fulfill`,{data:{items:[{id:saved.items[0].id,fulfilledQuantity:1}]}})).status()).toBe(200);
  const completed=await(await request.get(`/api/requests/${saved.id}`)).json();
  const movements=await(await request.get('/api/transactions')).json();
  expect(movements.find((row:any)=>row.id===completed.transactionId).items[0].name).toBe(`${brand} — ${item.name}`);
});

test('checkout saves a new item brand and finds it again after reload',async({page,request})=>{
  const brand=`New Checkout Brand ${randomUUID().slice(0,8)}`;
  const name=`Pancake mix ${randomUUID().slice(0,8)}`;
  await page.goto('/check-out');
  await page.getByRole('button',{name:'New item not in system',exact:true}).click();
  await page.getByPlaceholder('e.g. Canned Soup, Rice (5 lb bag)').fill(name);
  await page.getByLabel('Brand (optional)',{exact:true}).fill(brand);
  await page.getByRole('button',{name:'Save item & add to cart',exact:true}).click();
  await expect(page.getByTestId('product-brand')).toHaveText(brand);
  const inventory=await(await request.get('/api/inventory')).json();
  expect(inventory.find((row:any)=>row.name===name).brand).toBe(brand);
  await page.reload();
  await page.getByTestId('input-checkout-item-search').fill(brand);
  await expect(page.getByRole('option',{name:new RegExp(brand)}).getByTestId('product-brand')).toHaveText(brand);
});

test('signed-in student can find the saved brand in the mobile pickup catalogue', async ({browser,baseURL,request},info) => {
  const brand=`Portal Brand ${randomUUID().slice(0,8)}`;
  const item=await product(request,brand);
  const context=await browser.newContext({baseURL,viewport:{width:320,height:780},storageState:{cookies:[],origins:[]}});
  try {
    const login=await context.request.post('/api/auth/login',{data:{email:process.env.FRC_E2E_STUDENT_EMAIL,password:process.env.FRC_E2E_STUDENT_PASSWORD}});
    expect(login.status()).toBe(200);
    const page=await context.newPage();
    await page.goto('/portal');
    await page.getByRole('button',{name:'Start a Request',exact:true}).click();
    await page.getByTestId('input-item-search').fill(brand);
    await expect(page.getByTestId(`card-item-${item.id}`).getByTestId('product-brand')).toHaveText(brand);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath('student-brand-mobile.png'),fullPage:true});
    // The student name appears at the wider breakpoint; keep long names bounded.
    const longName='Synthetic Long Student Name '.repeat(8);
    await context.route('**/api/auth/me',async route=>{
      const response=await route.fetch();
      const body=await response.json();
      await route.fulfill({response,json:{...body,user:{...body.user,name:longName}}});
    });
    await page.setViewportSize({width:640,height:780});
    await page.reload();
    await expect(page.getByTestId('text-portal-user')).toBeVisible();
    await expect(page.getByTestId('text-portal-user')).toHaveText(longName);
    await expect(page.getByTestId('button-portal-logout')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  } finally { await context.close(); }
});
