import { chromium } from 'playwright-core';
const URL = 'http://localhost:5192/debug-org.html';
const logs = [];
const browser = await chromium.launch();
const page = await browser.newPage();
page.setDefaultTimeout(15000);
await page.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }));
page.on('console', (m) => logs.push(m.text()));
page.on('pageerror', (e) => logs.push('PAGEERROR> ' + e.message));
const c = () => ({ Z: logs.filter(l=>l.startsWith('[ZOOM]')).length, S: logs.filter(l=>l.startsWith('[STAGESIZE SET]')).length, D: logs.filter(l=>l.startsWith('[DRAW]')).length, C: logs.filter(l=>l.startsWith('[CONNECTOR EFFECT RUN]')).length });
async function snap(label){ const a=c(); await page.waitForTimeout(2500); const b=c(); const g=k=>b[k]-a[k]; console.log(`${label}: @0`,a,'@2.5s',b,'idle-growth',{Z:g('Z'),S:g('S'),D:g('D'),C:g('C')}, g('Z')>3||g('S')>3||g('D')>10?'>>> RUNAWAY':'ok'); }
await page.goto(URL, { waitUntil: 'domcontentloaded' });
try { await page.waitForSelector('[data-node-id]', { timeout: 10000 }); console.log('TREE RENDERED'); } catch { console.log('NO TREE:\n'+logs.slice(-15).join('\n')); }
await page.waitForTimeout(800); await snap('BASELINE');
await page.evaluate(() => { const vp=document.querySelector('.overflow-auto'); (vp||document.body).dispatchEvent(new WheelEvent('wheel',{deltaY:-100,ctrlKey:true,bubbles:true,cancelable:true})); });
await snap('after CTRL+WHEEL');
for(let i=0;i<3;i++){ try{await page.locator('button:has-text("+")').first().click();}catch{} await page.waitForTimeout(150);} await snap('after 3x ZOOM-IN');
console.log('FINAL', c(), 'ERR', logs.filter(l=>l.startsWith('PAGEERROR')).length);
await browser.close();
