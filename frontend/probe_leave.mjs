import { chromium } from 'playwright';
const BASE='http://127.0.0.1:5173';
const b=await chromium.launch({args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
const ctx=await b.newContext({viewport:{width:1366,height:900}}); const p=await ctx.newPage(); p.setDefaultTimeout(8000);
await p.goto(BASE+'/login',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(600);
await p.fill('input[type=email]','test1@gmail.com'); await p.fill('input[type=password]','12345678'); await p.click('button[type=submit]'); await p.waitForTimeout(3000);
await p.goto(BASE+'/leave',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(3000);
// list buttons with details
const btns=await p.evaluate(()=>Array.from(document.querySelectorAll('button')).map(x=>({t:(x.innerText||'').replace(/\s+/g,' ').trim(), cls:x.className.slice(0,40), dis:x.disabled, vis:x.offsetParent!==null})));
console.log('LEAVE BTNS => '+JSON.stringify(btns.filter(x=>x.t).slice(0,20)));
// click submit leave request and inspect modal
const slr=await p.getByRole('button',{name:/submit leave request/i}).count();
console.log('submit-leave-request count='+slr);
await p.getByRole('button',{name:/submit leave request/i}).first().click().catch(e=>console.log('click err '+e.message));
await p.waitForTimeout(2000);
const after=await p.evaluate(()=>Array.from(document.querySelectorAll('button,textarea,input')).map(x=>({t:(x.innerText||x.value||x.getAttribute('placeholder')||'').replace(/\s+/g,' ').trim(), tag:x.tagName})).filter(x=>x.t).slice(0,25));
console.log('AFTER CLICK => '+JSON.stringify(after));
await b.close();
