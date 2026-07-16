import { chromium } from 'playwright';
const BASE='http://127.0.0.1:5173';
const b=await chromium.launch({args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
const adm=await b.newContext({viewport:{width:1366,height:900}}); const ap=await adm.newPage(); ap.setDefaultTimeout(8000);
await ap.goto(BASE+'/login',{waitUntil:'domcontentloaded'}); await ap.waitForTimeout(600);
await ap.fill('input[type=email]','ayushborwal004@gmail.com'); await ap.fill('input[type=password]','TestPass123!'); await ap.click('button[type=submit]'); await ap.waitForTimeout(3000);
await ap.goto(BASE+'/employees',{waitUntil:'domcontentloaded'}); await ap.waitForTimeout(3500);
// scan ALL buttons incl icon-only
const all=await ap.evaluate(()=>Array.from(document.querySelectorAll('button, a')).map(x=>({t:(x.innerText||'').replace(/\s+/g,' ').trim(), aria:x.getAttribute('aria-label')||'', title:x.title||''})).filter(x=>x.t||x.aria||x.title));
console.log('EMPLOYEES ALL => '+JSON.stringify(all.map(x=>x.t||x.aria||x.title).slice(0,40)));
// click "Employees" nav item if present, then rescan
const empNav=await ap.getByText('Employees',{exact:false}).first();
await empNav.click().catch(e=>console.log('nav click err '+e.message));
await ap.waitForTimeout(2000);
const all2=await ap.evaluate(()=>Array.from(document.querySelectorAll('button, a')).map(x=>(x.innerText||'').replace(/\s+/g,' ').trim()).filter(t=>t));
console.log('AFTER EMP NAV => '+JSON.stringify(all2.slice(0,40)));
await b.close();
