import { chromium } from 'playwright';
const BASE='http://127.0.0.1:5173';
async function login(page,email,pass){ await page.goto(BASE+'/login',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(600); if(page.url().includes('/login')){ await page.fill('input[type=email]',email); await page.fill('input[type=password]',pass); await page.click('button[type=submit]'); await page.waitForTimeout(3000);} }
const b=await chromium.launch({args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
const emp=await b.newContext({viewport:{width:1366,height:900}}); const ep=await emp.newPage(); ep.setDefaultTimeout(8000);
await login(ep,'test1@gmail.com','12345678');
for(const p of ['/attendance','/leave','/time-tracker']){ await ep.goto(BASE+p,{waitUntil:'domcontentloaded'}); await ep.waitForTimeout(2500); const btns=await ep.evaluate(()=>Array.from(document.querySelectorAll('button')).map(x=>(x.innerText||'').replace(/\s+/g,' ').trim()).filter(t=>t)); console.log('EMP '+p+' => '+JSON.stringify(btns.slice(0,25))); }
const adm=await b.newContext({viewport:{width:1366,height:900}}); const ap=await adm.newPage(); ap.setDefaultTimeout(8000);
await login(ap,'ayushborwal004@gmail.com','TestPass123!');
for(const p of ['/employees','/approval-inbox']){ await ap.goto(BASE+p,{waitUntil:'domcontentloaded'}); await ap.waitForTimeout(3000); const btns=await ap.evaluate(()=>Array.from(document.querySelectorAll('button')).map(x=>(x.innerText||'').replace(/\s+/g,' ').trim()).filter(t=>t)); console.log('ADM '+p+' => '+JSON.stringify(btns.slice(0,25))); }
await b.close();
