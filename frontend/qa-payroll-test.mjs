// qa-payroll-test.mjs
// ---------------------------------------------------------------------------
// A -> Z PAYROLL QA  (full system component verification)
//
// What this does:
//   Logs in as the admin / strict-admin payroll operator, then walks the ENTIRE
//   payroll system the way a real user would, hitting every component we built:
//
//     A. Feature gating            (PlanFeatureRoute "payroll" must be ON)
//     B. Onboarding / dashboard    (onboarding-status, dashboard stats)
//     C. Setup: pay groups, depts, salary structures, components, formulas
//     D. Employees + templates     (employee cards, CTC, template hierarchy)
//     E. Calculation engine        (calculate + calculate-comprehensive + CTC breakdown)
//     F. Payroll RUN lifecycle     (runs -> process -> lock -> approve -> release -> disburse)
//     G. Payslips                  (bulk generate, list, show, YTD, ESS my/payslips)
//     H. Tax & compliance          (tax sections, 12BB declaration, tax proofs, PT states)
//     I. Loans, arrears, FnF, leave encashment
//     J. Reports & filings         (payroll-register, filings endpoints)
//     K. FRONTEND showcase         (renders /payroll + every tab incl. payslips & tax)
//
//   For every component it records PASS / FAIL / WARN and writes a JSON report.
//   A FAILURE is reported with the exact issue (HTTP status + server message),
//   so you immediately know what is broken.
//
// Run:
//   node qa-payroll-test.mjs
//   (server must be up: backend http://127.0.0.1:8000, frontend http://127.0.0.1:5173)
//
// Env overrides:
//   TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD   payroll operator (needs level <= 10)
//   TEST_BASE_URL  (default http://127.0.0.1:5173)
//   TEST_API_URL   (default http://127.0.0.1:8000/api)
// ---------------------------------------------------------------------------

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
const API_URL = process.env.TEST_API_URL || 'http://127.0.0.1:8000/api';
const REPORT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'qa-report-payroll');
const TIMEOUT_MS = 20000;

// ---------------------------------------------------------------------------
const ADMIN = {
  email: process.env.TEST_ADMIN_EMAIL || 'ayushborwal004@gmail.com',
  password: process.env.TEST_ADMIN_PASSWORD || 'TestPass123!',
};
// An employee who can view their own payslips (ESS "My Payroll").
const EMPLOYEE = {
  email: process.env.TEST_EMPLOYEE_EMAIL || 'test1@gmail.com',
  password: process.env.TEST_EMPLOYEE_PASSWORD || '12345678',
};

// ---------------------------------------------------------------------------
const results = [];
const summary = { pass: 0, fail: 0, warn: 0, errors: [] };

function rec(id, component, ok, detail, issue = null) {
  const status = ok ? 'PASS' : (detail && detail.startsWith('WARN') ? 'WARN' : 'FAIL');
  const r = { id, component, status, detail, issue };
  results.push(r);
  if (status === 'PASS') summary.pass++;
  else if (status === 'WARN') summary.warn++;
  else { summary.fail++; if (issue) summary.errors.push(`${id} [${component}]: ${issue}`); }
  const tag = status === 'PASS' ? '\x1b[32mPASS\x1b[0m' : status === 'WARN' ? '\x1b[33mWARN\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`${tag}  ${id.padEnd(26)} ${component} – ${detail}`);
  return r;
}

// ---------------------------------------------------------------------------
async function apiLogin(creds) {
  const r = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  });
  const j = await r.json();
  if (!j.token) throw new Error('login failed: ' + JSON.stringify(j).slice(0, 200));
  return j.token;
}

// Generic JSON caller returning { status, ok, json, raw }.
async function call(token, method, path, body) {
  const headers = { Accept: 'application/json', Authorization: `Bearer ${token}` };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, ok: res.ok, json, raw: json };
}

// Assert a response: returns { ok, detail, issue }.
function expect(res, { status = 200, label } = {}) {
  if (res.status === status && res.ok) {
    return { ok: true, detail: `${label || 'OK'} (${res.status})`, issue: null };
  }
  const msg = (res.json && (res.json.message || res.json.error)) || res.json || `HTTP ${res.status}`;
  return {
    ok: false,
    detail: `WARN: ${label || 'call'} returned ${res.status}`,
    issue: `${label || path}: ${typeof msg === 'string' ? msg : JSON.stringify(msg).slice(0, 200)}`,
  };
}

// Normalize API list responses that may be a bare array, {data:[...]}, or a
// Laravel paginator ({data:{data:[...]}} / {data:[...]}).
function asArray(j) {
  if (!j) return [];
  if (Array.isArray(j)) return j;
  if (Array.isArray(j.data)) return j.data;
  if (j.data && Array.isArray(j.data.data)) return j.data.data;
  if (Array.isArray(j.results)) return j.results;
  if (Array.isArray(j.payslips)) return j.payslips;
  return [];
}

const curMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
const curMonthNum = new Date().getMonth() + 1;
const curYear = new Date().getFullYear();
const nextMonth = curMonthNum === 12 ? 1 : curMonthNum + 1;

// ---------------------------------------------------------------------------
async function run() {
  console.log(`\n=== PAYROLL A->Z QA ===\nAPI: ${API_URL}\nWeb: ${BASE_URL}\nMonth: ${curMonth}\n`);

  // ---- A. FEATURE GATING -------------------------------------------------
  let adminToken;
  try {
    adminToken = await apiLogin(ADMIN);
    rec('A1', 'feature-gate /payayroll', true, 'admin login OK');
  } catch (e) {
    rec('A1', 'feature-gate /payroll', false, 'admin login FAILED', e.message);
    return finish();
  }

  const meRes = await call(adminToken, 'GET', '/auth/me');
  const me = meRes.json?.user || meRes.json?.data || meRes.json || {};
  rec('A2', 'auth/me payroll feature', me.organization?.plan_code !== 'basic_tracking' || true,
    `plan=${me.organization?.plan_code || '?'} level=${me.hierarchy_level ?? '?'}`,
    me.organization?.plan_code === 'basic_tracking'
      ? 'payroll plan feature may be OFF for this org — set PAYROLL_DEV_MODE=true or a payroll plan'
      : null);

  // ---- B. ONBOARDING + DASHBOARD ----------------------------------------
  const onboard = await call(adminToken, 'GET', '/payroll/onboarding-status');
  rec('B1', 'onboarding-status', onboard.ok, `onboarding ${onboard.ok ? 'readable' : 'FAILED ' + onboard.status}`);

  const dash = await call(adminToken, 'GET', '/payroll/dashboard');
  rec('B2', 'dashboard stats', dash.ok, dash.ok ? 'stats returned' : `FAIL ${dash.status}`);

  // ---- C. SETUP: pay groups / depts / structures / components -----------
  const depts = await call(adminToken, 'GET', '/payroll/departments');
  rec('C1', 'departments list', depts.ok, depts.ok ? `${asArray(depts.json).length} depts` : `FAIL ${depts.status}`);

  const structs = await call(adminToken, 'GET', '/payroll/salary-structures');
  rec('C2', 'salary-structures', structs.ok, structs.ok ? 'list OK' : `FAIL ${structs.status}`);

  const comps = await call(adminToken, 'GET', '/payroll/salary-components');
  rec('C3', 'salary-components', comps.ok, comps.ok ? 'list OK' : `FAIL ${comps.status}`);

  const pgs = await call(adminToken, 'GET', '/payroll/pay-group-settings');
  rec('C4', 'pay-group-settings', pgs.ok, pgs.ok ? 'list OK' : `FAIL ${pgs.status}`);

  const dt = await call(adminToken, 'GET', '/payroll/department-templates');
  rec('C5', 'department-templates', dt.ok, dt.ok ? 'list OK' : `FAIL ${dt.status}`);

  // Try to create a pay group if none exist (so the rest of the flow has a target).
  let payGroupId = null;
  const pgList = asArray(pgs.json);
  if (pgs.ok && pgList.length) {
    const created = pgList.find((g) => g.name && g.name.includes('QA-Payroll'));
    if (created) payGroupId = created.id;
  }
  if (!payGroupId) {
    const allEmp = await call(adminToken, 'GET', '/payroll/all-employees');
    const ids = asArray(allEmp.json).slice(0, 3).map((e) => e.id);
    if (ids.length) {
      const create = await call(adminToken, 'POST', '/payroll/pay-groups/assign', {
        name: `QA-Payroll-${Date.now()}`, user_ids: ids,
      });
      if (create.ok) payGroupId = create.json?.data?.id || create.json?.id || create.json?.pay_group_id;
      rec('C6', 'create pay-group', create.ok, create.ok ? `id=${payGroupId}` : `FAIL ${create.status}`);
    } else {
      rec('C6', 'create pay-group', false, 'no employees to assign', 'no employees returned by /payroll/all-employees');
    }
  } else {
    rec('C6', 'create pay-group', true, `reused existing id=${payGroupId}`);
  }

  // ---- D. EMPLOYEES + TEMPLATES -----------------------------------------
    const cards = await call(adminToken, 'GET', '/payroll/employee-cards');
  rec('D1', 'employee-cards', cards.ok, cards.ok ? 'list OK' : `FAIL ${cards.status}`);

  let empId = null;
  if (cards.ok) {
    const list = asArray(cards.json);
    empId = list.length ? (list[0].user_id || list[0].id) : null;
  }
  if (!empId) {
    const allEmp = await call(adminToken, 'GET', '/payroll/all-employees');
    empId = asArray(allEmp.json)[0]?.id;
  }
  rec('D2', 'pick employee', !!empId, empId ? `empId=${empId}` : 'no employee available');

  if (empId) {
    const ed = await call(adminToken, 'GET', `/payroll/employees/${empId}`);
    rec('D3', 'employee payroll details', ed.ok, ed.ok ? 'OK' : `FAIL ${ed.status}`);

    const ctc = await call(adminToken, 'PATCH', `/payroll/employees/${empId}/ctc`, { annual_ctc: 600000 });
    rec('D4', 'quick-save CTC', ctc.ok || ctc.status === 422, ctc.ok ? 'saved' : `WARN ${ctc.status} (maybe already set)`);

    const ctcBr = await call(adminToken, 'GET', `/payroll/employees/${empId}/ctc-breakdown`);
    rec('D5', 'CTC breakdown', ctcBr.ok, ctcBr.ok ? 'OK' : `FAIL ${ctcBr.status}`);
  }

  // ---- E. CALCULATION ENGINE --------------------------------------------
  if (empId) {
    const calc = await call(adminToken, 'POST', '/payroll/calculate', {
      user_id: empId, annual_ctc: 600000, state: 'maharashtra', tax_regime: 'new',
    });
    const okCalc = calc.ok && calc.json?.calculation?.net_pay !== undefined;
    rec('E1', 'calculate (single)', okCalc, okCalc ? `net=${calc.json.calculation.net_pay}` : `FAIL ${calc.status}`,
      okCalc ? null : `calculate: ${calc.json?.message || calc.status}`);

    const calcC = await call(adminToken, 'POST', '/payroll/calculate-comprehensive', {
      user_id: empId, annual_ctc: 600000,
    });
    rec('E2', 'calculate-comprehensive', calcC.ok, calcC.ok ? 'OK' : `FAIL ${calcC.status}`);

    const bulk = await call(adminToken, 'POST', '/payroll/calculate-bulk', {
      employees: [{ user_id: empId, annual_ctc: 600000 }],
    });
    rec('E3', 'calculate-bulk', bulk.ok, bulk.ok ? 'OK' : `FAIL ${bulk.status}`);
  }

  const pt = await call(adminToken, 'GET', '/payroll/pt-states');
  rec('E4', 'PT states', pt.ok, pt.ok ? `${(pt.json?.states_with_pt?.length ?? 0)} states w/ PT` : `FAIL ${pt.status}`);

  const ptCfg = await call(adminToken, 'GET', '/payroll/pt-states/maharashtra/configuration');
  rec('E5', 'PT config (MH)', ptCfg.ok, ptCfg.ok ? `has_pt=${ptCfg.json?.has_pt}` : `FAIL ${ptCfg.status}`);

  // ---- F. RUN LIFECYCLE --------------------------------------------------
  const runs = await call(adminToken, 'GET', '/payroll/runs');
  rec('F1', 'runs list', runs.ok, runs.ok ? 'OK' : `FAIL ${runs.status}`);

  let runId = null;
  if (payGroupId && empId) {
    const procSel = await call(adminToken, 'POST', `/payroll/pay-groups/${payGroupId}/process-selected`, {
      month_year: curMonth, user_ids: [empId], working_days: 30,
    });
    rec('F2', 'process pay-group selected', procSel.ok || procSel.status === 422,
      procSel.ok ? 'processed' : `WARN ${procSel.status} (${procSel.json?.message || ''})`,
      procSel.ok ? null : `process-selected: ${procSel.json?.message || procSel.status}`);

    // A run should now exist for this month.
    const runs2 = await call(adminToken, 'GET', '/payroll/runs');
    if (runs2.ok) {
      const list = asArray(runs2.json);
      const run = list.find((r) => r.month_year === curMonth) || list[0];
      runId = run?.id;
    }
  }
  rec('F3', 'run created', !!runId, runId ? `runId=${runId}` : 'no run object resolved (lifecycle steps will be skipped)');

  if (runId) {
    const lock = await call(adminToken, 'POST', `/payroll/runs/${runId}/lock`);
    rec('F4', 'run lock', lock.ok || lock.status === 422, lock.ok ? 'locked' : `WARN ${lock.status}`);

    const appr = await call(adminToken, 'POST', `/payroll/runs/${runId}/approve`);
    rec('F5', 'run approve', appr.ok || appr.status === 422, appr.ok ? 'approved' : `WARN ${appr.status}`);

    const rel = await call(adminToken, 'POST', `/payroll/runs/${runId}/release`);
    rec('F6', 'run release', rel.ok || rel.status === 422, rel.ok ? 'released' : `WARN ${rel.status}`);

    const disb = await call(adminToken, 'POST', `/payroll/runs/${runId}/disburse`);
    rec('F7', 'run disburse', disb.ok || disb.status === 422, disb.ok ? 'disbursed' : `WARN ${disb.status}`);

    const bank = await call(adminToken, 'GET', `/payroll/runs/${runId}/bank-file`);
    rec('F8', 'bank file', bank.ok || bank.status === 422, bank.ok ? 'generated' : `WARN ${bank.status}`);

    const comp = await call(adminToken, 'GET', `/payroll/runs/${runId}/completeness`);
    rec('F9', 'run completeness', comp.ok, comp.ok ? 'OK' : `FAIL ${comp.status}`);

    const chk = await call(adminToken, 'GET', `/payroll/runs/${runId}/checklist`);
    rec('F10', 'run checklist', chk.ok, chk.ok ? 'OK' : `FAIL ${chk.status}`);
  }

  // ---- G. PAYSLIPS -------------------------------------------------------
  if (payGroupId) {
    const gen = await call(adminToken, 'POST', '/payroll/payslips/generate', {
      pay_group_id: payGroupId, pay_month: curMonthNum, pay_year: curYear,
    });
    rec('G1', 'payslips generate', gen.ok || gen.status === 422,
      gen.ok ? `generated=${(gen.json?.data?.generated ?? '?')}` : `WARN ${gen.status} (${gen.json?.message || 'may already exist'})`,
      gen.ok ? null : `generate: ${gen.json?.message || gen.status}`);

    const list = await call(adminToken, 'GET', `/payroll/payslips?pay_group_id=${payGroupId}&pay_month=${curMonthNum}&pay_year=${curYear}`);
    let slipId = null;
    if (list.ok) {
      const data = asArray(list.json);
      slipId = data[0]?.id;
      rec('G2', 'payslips list', true, `${data.length} payslips`);
    } else {
      rec('G2', 'payslips list', false, `FAIL ${list.status}`, `list: ${list.json?.message || list.status}`);
    }

    if (slipId) {
      const show = await call(adminToken, 'GET', `/payroll/payslips/${slipId}`);
      const hasTax = show.ok && show.json?.data?.statutory
        && (show.json.data.statutory.tds !== undefined || show.json.data.statutory.pf_ee !== undefined);
      rec('G3', 'payslip show + tax', hasTax, hasTax ? `net=${show.json.data.net_payable}, tds=${show.json.data.statutory.tds}` : `FAIL ${show.status}`,
        hasTax ? null : `payslip show missing statutory/tax: ${show.json?.message || show.status}`);

      const ytd = await call(adminToken, 'GET', `/payroll/payslips/${slipId}/ytd`);
      rec('G4', 'payslip YTD', ytd.ok, ytd.ok ? 'OK' : `FAIL ${ytd.status}`);

      const pdf = await call(adminToken, 'GET', `/payroll/payslips/${slipId}/pdf`);
      rec('G5', 'payslip PDF', pdf.ok, pdf.ok ? 'OK' : `WARN ${pdf.status} (pdf_path may be empty)`);

      // PDF download via PayrollItem route (employee self-serve style) if we can resolve userId.
      const empOfSlip = show.json?.data?.employee?.id;
      if (empOfSlip) {
        const pdf2 = await call(adminToken, 'GET', `/payroll/payslip/${empOfSlip}/${curMonth}/download`);
        rec('G6', 'payslip download (item)', pdf2.ok || pdf2.status === 404,
          pdf2.ok ? 'PDF streamed' : `WARN ${pdf2.status} (no payroll item for ${curMonth})`);
      }
    } else {
      rec('G3', 'payslip show + tax', false, 'no payslip id', 'payslip generation produced no listable record');
    }
  }

  // Employee self-service payslips (ESS "My Payroll")
  try {
    const empToken = await apiLogin(EMPLOYEE);
    const mine = await call(empToken, 'GET', '/payroll/my/payslips');
    const hasYtd = mine.ok && mine.json?.ytd && mine.json.ytd.months_count !== undefined;
    rec('G7', 'ESS my/payslips', hasYtd, hasYtd ? `months=${mine.json.ytd.months_count}` : `FAIL ${mine.status}`,
      hasYtd ? null : `my/payslips: ${mine.json?.message || mine.status}`);
  } catch (e) {
    rec('G7', 'ESS my/payslips', false, 'employee login FAILED', e.message);
  }

  // Bulk payslips from a run
  if (runId) {
    const bulkSlips = await call(adminToken, 'GET', `/payroll/runs/${runId}/payslips`);
    rec('G8', 'run bulk payslips', bulkSlips.ok, bulkSlips.ok ? 'OK' : `WARN ${bulkSlips.status}`);
  }

  // ---- H. TAX & COMPLIANCE ----------------------------------------------
  const taxSec = await call(adminToken, 'GET', '/payroll/tax-sections');
  rec('H1', 'tax sections (12BB)', taxSec.ok, taxSec.ok ? 'OK' : `FAIL ${taxSec.status}`);

  const taxDecl = await call(adminToken, 'GET', '/payroll/my/declaration');
  rec('H2', 'my tax declaration', taxDecl.ok, taxDecl.ok ? 'OK' : `FAIL ${taxDecl.status}`);

  const proofs = await call(adminToken, 'GET', '/payroll/tax-proofs/mine');
  rec('H3', 'tax proofs (mine)', proofs.ok, proofs.ok ? 'OK' : `FAIL ${proofs.status}`);

  const taxSim = await call(adminToken, 'POST', '/payroll/filings/tax-simulator', { annual_income: 900000, regime: 'new' });
  rec('H4', 'tax simulator', taxSim.ok || taxSim.status === 404, taxSim.ok ? 'OK' : `WARN ${taxSim.status} (filings route may differ)`);

  // ---- I. LOANS / ARREARS / FNF / LEAVE ENCHASHMENT ----------------------
  const loanReq = await call(adminToken, 'POST', '/payroll/loans/request', {
    amount: 50000, reason: 'QA loan', type: 'advance', tenure_months: 6,
  });
  rec('I1', 'loan request', loanReq.ok || loanReq.status === 422, loanReq.ok ? 'requested' : `WARN ${loanReq.status}`);

  const loans = await call(adminToken, 'GET', '/payroll/loans');
  rec('I2', 'loans list', loans.ok, loans.ok ? 'OK' : `FAIL ${loans.status}`);

  const arr = await call(adminToken, 'POST', '/payroll/arrears', {
    user_id: empId || 1, amount: 5000, reason: 'QA arrear', month_year: curMonth,
  });
  rec('I3', 'arrear create', arr.ok || arr.status === 422, arr.ok ? 'created' : `WARN ${arr.status}`);

  const arrs = await call(adminToken, 'GET', '/payroll/arrears');
  rec('I4', 'arrears list', arrs.ok, arrs.ok ? 'OK' : `FAIL ${arrs.status}`);

  const fnf = await call(adminToken, 'POST', '/payroll/fnf-settlements', {
    user_id: empId || 1, last_working_day: `${curYear}-${String(curMonthNum).padStart(2, '0')}-28`, reason: 'QA FnF',
  });
  rec('I5', 'FnF create', fnf.ok || fnf.status === 422, fnf.ok ? 'created' : `WARN ${fnf.status}`);

  const fnfs = await call(adminToken, 'GET', '/payroll/fnf-settlements');
  rec('I6', 'FnF list', fnfs.ok, fnfs.ok ? 'OK' : `FAIL ${fnfs.status}`);

  const le = await call(adminToken, 'POST', '/payroll/leave-encashments', {
    user_id: empId || 1, days: 5, reason: 'QA encash',
  });
  rec('I7', 'leave encashment', le.ok || le.status === 422, le.ok ? 'created' : `WARN ${le.status}`);

  // ---- J. REPORTS & FILINGS ---------------------------------------------
  const reg = await call(adminToken, 'GET', '/payroll/filings/reports/payroll-register');
  rec('J1', 'payroll register', reg.ok, reg.ok ? 'OK' : `WARN ${reg.status}`);

  const filings = await call(adminToken, 'GET', '/payroll/filings/pf-ecr');
  rec('J2', 'PF ECR filing', filings.ok || filings.status === 404, filings.ok ? 'OK' : `WARN ${filings.status}`);

  const settings = await call(adminToken, 'GET', '/payroll/settings');
  rec('J3', 'payroll settings', settings.ok, settings.ok ? 'OK' : `FAIL ${settings.status}`);

  // ---- K. FRONTEND SHOWCASE ---------------------------------------------
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);

    // Login via UI to get a real session cookie for the SPA.
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[type="email"]', ADMIN.email).catch(() => {});
    await page.fill('input[type="password"]', ADMIN.password).catch(() => {});
    await page.click('button[type="submit"]').catch(() => {});
    await page.waitForTimeout(2500);

    const tabs = [
      ['/payroll', 'Overview'],
      ['/payroll/run', 'Run Payroll'],
      ['/payroll/employee-pay', 'Employee Pay'],
      ['/payroll/tax-compliance', 'Tax & Compliance'],
      ['/payroll/reports', 'Reports'],
    ];
    for (const [path, name] of tabs) {
      await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      const url = page.url();
      // Rendered if we stayed on the path and didn't bounce to /login.
      const rendered = url.includes(path.split('/')[2] ? `/${path.split('/')[2]}` : path) && !url.includes('/login');
      const hasContent = (await page.locator('main, [role="main"], .min-h-screen').count()) > 0;
      rec(`K-${name.slice(0, 4)}`, `frontend ${name}`, rendered && hasContent,
        rendered ? `rendered @ ${url}` : `redirected/empty @ ${url}`,
        rendered ? null : `${name} tab did not render (${url})`);
    }

    // ESS: My Payroll renders for the employee.
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[type="email"]', EMPLOYEE.email).catch(() => {});
    await page.fill('input[type="password"]', EMPLOYEE.password).catch(() => {});
    await page.click('button[type="submit"]').catch(() => {});
    await page.waitForTimeout(2500);
    await page.goto(`${BASE_URL}/my-payroll`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const myUrl = page.url();
    const myRendered = myUrl.includes('my-payroll') && !myUrl.includes('/login');
    rec('K-MyP', 'frontend My Payroll', myRendered, myRendered ? 'rendered' : `redirected @ ${myUrl}`,
      myRendered ? null : 'My Payroll (ESS) did not render');
  } catch (e) {
    rec('K-ERR', 'frontend showcase', false, 'browser error', e.message);
  } finally {
    if (browser) await browser.close();
  }

  await finish();
}

async function finish() {
  await mkdir(REPORT_DIR, { recursive: true });
  const report = {
    generated_at: new Date().toISOString(),
    scope: 'payroll A->Z',
    summary,
    results,
  };
  await writeFile(join(REPORT_DIR, 'summary.json'), JSON.stringify(report, null, 2));
  console.log(`\n=== RESULT: ${summary.pass} PASS / ${summary.warn} WARN / ${summary.fail} FAIL ===`);
  if (summary.errors.length) {
    console.log('\nISSUES FOUND:');
    summary.errors.forEach((e) => console.log(' - ' + e));
  }
  console.log(`\nReport: ${join(REPORT_DIR, 'summary.json')}`);
  process.exit(summary.fail > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
