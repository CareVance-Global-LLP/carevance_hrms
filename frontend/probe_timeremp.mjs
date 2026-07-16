import { chromium } from 'playwright';
const BASE='http://127.0.0.1:5173';
const b=await chromium.launch({args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
async function login(p,email,pass){ await p.goto(BASE+'/login',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(600); if(p.url().includes('/login')){ await p.fill('input[type=email]',email); await p.fill('input[type=password]',pass); await p.click('button[type=submit]'); await p.waitForTimeout(3000);} }
// employee timer
const ec=await b.newContext({viewport:{width:1366,height:900}}); const ep=await ec.newPage(); ep.setDefaultTimeout(8000);
await login(ep,'test1@gmail.com','12345678');
await ep.goto(BASE+'/time-tracker',{waitUntil:'domcontentloaded'}); await ep.waitForTimeout(4000);
const tbtns=await ep.evaluate(()=>Array.from(document.querySelectorAll('button')).map(x=>(x.innerText||'').replace(/\s+/g,' ').trim()).filter(t=>/start|stop|pause|break/i.test(t)));
console.log('TIMER BTNS => '+JSON.stringify(tbtns));
// admin employees
const ac=await b.newContext({viewport:{width:1366,height:900}}); const ap=await ac.newPage(); ap.setDefaultTimeout(8000);
await login(ap,'ayushborwal004@gmail.com','TestPass123!');
await ap.goto(BASE+'/employees',{waitUntil:'domcontentloaded'}); await ap.waitForTimeout(5000);
const ebtns=await ap.evaluate(()=>Array.from(document.querySelectorAll('button')).map(x=>(x.innerText||'').replace(/\s+/g,' ').trim()).filter(t=>/add employee|add user|invite/i.test(t)));
console.log('EMPLOYEES ADD BTN => '+JSON.stringify(ebtns));
await b.close();
