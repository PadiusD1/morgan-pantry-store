import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext } from '@playwright/test';
const unique=(label:string)=>`E2E ${label} ${randomUUID().slice(0,8)}`;
async function item(api:APIRequestContext, name=unique('Rice 16oz'), measured=true){
  const response=await api.post('/api/inventory',{data:{name,category:'Grains',quantity:30,weightPerUnitLbs:measured?'1':'0',valuePerUnitUsd:measured?'2.35':'0'}});
  expect(response.status(),await response.text()).toBe(201);return response.json();
}

test('independent donor and partner exports retain new zero-activity directory entries',async({page,request},info)=>{
  for(const kind of ['donor','partner'] as const){
    const name=unique(`New ${kind}`);
    const response=await request.post(kind==='donor'?'/api/donors':'/api/clients',{data:kind==='donor'?{name,status:'active'}:{name,identifier:`SYN${randomUUID()}`,clientType:'partner',status:'active'}});
    expect(response.status()).toBe(201);
    await page.goto(kind==='donor'?'/donors':'/partners');
    const panel=page.getByTestId(`${kind}-directory-report`);await panel.locator('summary').click();
    const pending=page.waitForEvent('download');await panel.getByRole('button',{name:`Download ${kind} report CSV`,exact:true}).click();const file=await pending;const output=info.outputPath(`${kind}-directory.csv`);await file.saveAs(output);
    const csv=await readFile(output,'utf8');expect(csv).toContain(name);expect(csv).not.toContain('email');
  }
});

test('reviewed measurements preserve stock and product photos load on the student catalogue',async({page,request},info)=>{
  const rice=await item(request,unique('Reviewed rice 16oz'),false);await page.goto('/inventory');
  const panel=page.getByTestId('inventory-quality');await panel.locator('summary').click();await page.getByLabel('Item to complete',{exact:true}).selectOption(rice.id);
  await expect(page.getByLabel('Reviewed weight per unit',{exact:true})).toHaveValue('1');
  await page.getByLabel('Reviewed estimated value per unit',{exact:true}).fill('2.35');await page.getByLabel('Value source',{exact:true}).fill('Synthetic test price on 2026-10-15');
  await page.getByRole('button',{name:'Save reviewed measurements',exact:true}).click();await expect(panel).toContainText('Saved. Current stock and historical transaction measurements were not changed.');
  const refreshed=page.waitForResponse(response=>response.url().endsWith('/api/inventory/quality') && response.request().method()==='GET');
  await panel.getByRole('button',{name:'Refresh completeness check',exact:true}).click();await refreshed;
  await expect(panel).toContainText('Saved. Current stock and historical transaction measurements were not changed.');
  const current=await(await request.get('/api/inventory')).json();const updated=current.find((i:any)=>i.id===rice.id);expect(updated.quantity).toBe(30);expect(Number(updated.weightPerUnitLbs)).toBe(1);expect(Number(updated.valuePerUnitUsd)).toBe(2.35);
  const photo=await request.put(`/api/inventory/${rice.id}/photo`,{data:{dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lC8AAAAASUVORK5CYII=',description:'Synthetic test pixel, not real product artwork'}});expect(photo.status()).toBe(200);
  const login=await page.context().request.post('/api/auth/login',{data:{email:process.env.FRC_E2E_STUDENT_EMAIL,password:process.env.FRC_E2E_STUDENT_PASSWORD}});expect(login.status()).toBe(200);
  await page.goto('/portal');await page.getByRole('button',{name:'Start a Request',exact:true}).click();await page.getByTestId('input-item-search').fill(rice.name);
  const img=page.getByTestId(`product-photo-${rice.id}`).locator('img');await expect(img).toBeVisible();
  await expect.poll(()=>img.evaluate((image:any)=>image.complete&&image.naturalWidth>0)).toBe(true);
  await page.setViewportSize({width:320,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('catalogue-photo-mobile.png'),fullPage:true});
});

test('integration settings distinguish configuration from verified service operation',async({page},info)=>{
  await page.goto('/settings');const panel=page.getByTestId('integration-status');await panel.locator('summary').click();
  await expect(panel).toContainText('not configured');await expect(panel).toContainText('Cloudflare');await expect(panel).toContainText('migration');
  await page.screenshot({path:info.outputPath('integration-status.png'),fullPage:true});
});

// Query refetches must not overwrite typed values or advance the reviewed version.
test('a concurrent item refresh preserves the measurement draft and refuses a stale save',async({page,request})=>{
  const rice=await item(request,unique('Concurrent rice 16oz'),false);await page.goto('/inventory');
  const panel=page.getByTestId('inventory-quality');await panel.locator('summary').click();await page.getByLabel('Item to complete',{exact:true}).selectOption(rice.id);
  await page.getByLabel('Reviewed estimated value per unit',{exact:true}).fill('3.50');
  await page.getByLabel('Value source',{exact:true}).fill('Synthetic draft source kept during refresh');
  const concurrent=await request.patch(`/api/inventory/${rice.id}/measurements`,{data:{expectedUpdatedAt:rice.updatedAt,valuePerUnitUsd:2.80,valueSource:'Synthetic concurrent verified price',costIsEstimated:true}});expect(concurrent.status()).toBe(200);
  const refreshed=page.waitForResponse(response=>response.url().endsWith('/api/inventory/quality') && response.request().method()==='GET');
  await panel.getByRole('button',{name:'Refresh completeness check',exact:true}).click();await refreshed;
  await expect(page.getByLabel('Reviewed estimated value per unit',{exact:true})).toHaveValue('3.50');
  await expect(page.getByLabel('Value source',{exact:true})).toHaveValue('Synthetic draft source kept during refresh');
  await expect(panel).toContainText('This item changed since your review began.');
  const denied=page.waitForResponse(response=>response.url().endsWith(`/api/inventory/${rice.id}/measurements`) && response.request().method()==='PATCH');
  await panel.getByRole('button',{name:'Save reviewed measurements',exact:true}).click();expect((await denied).status()).toBe(409);
  await expect(page.getByLabel('Reviewed estimated value per unit',{exact:true})).toHaveValue('3.50');
  const current=await(await request.get('/api/inventory')).json();expect(Number(current.find((i:any)=>i.id===rice.id).valuePerUnitUsd)).toBe(2.80);
  await panel.getByRole('button',{name:'Review latest saved values',exact:true}).click();
  await expect(page.getByLabel('Reviewed estimated value per unit',{exact:true})).toHaveValue('');
});
