// qa-e2e-test.mjs
// End-to-end flow smoke test: drives the live web app through REAL user
// journeys (not just navigation) and verifies the resulting state via the API
// (the frontend calls the same endpoints). Proves "the flow actually works".
//
// Flows:
//   A. Employee attendance check-in -> check-out (UI click + API verify)
//   B. Employee leave apply (UI form submit + API verify)
//   C. Admin approval-inbox shows the pending leave (closes the loop)
//   D. Admin create employee (UI form + API verify)
//   E. Employee timer start -> stop on /time-tracker
// Produces qa-report-e2e/summary.json

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
const API_URL = process.env.TEST_API_URL || 'http://127.0.0.1:8000/api';
const REPORT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'qa-report-e2e');

const ADMIN = { email: process.env.TEST_ADMIN_EMAIL || 'ayushborwal004@gmail.com', password: process.env.TEST_ADMIN_PASSWORD || 'TestPass123!' };
const EMPLOYEE = { email: process.env.TEST_EMPLOYEE_EMAIL || 'test1@gmail.com', password: process.env.TEST_EMPLOYEE_PASSWORD || '12345678' };

const results = [];
function log(role, flow, ok, detail) {
  results.push({ role, flow, ok, detail });
  console.log(`[${role}/${flow}] ${ok ? 'PASS' : 'FAIL'} - ${detail}`);
}

async function apiLogin(creds) {
  const r = await fetch(`${API_URL}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  });
  const j = await r.json();
  if (!j.token) throw new Error('login failed: ' + JSON.stringify(j).slice(0, 200));
  return j.token;
}
async function apiGet(path, token) {
  const r = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  return r;
}

async function dismissConsent(page) {
  // A fixed cookie-consent banner can intercept pointer events over page
  // content until it is dismissed. Dismiss it if present.
  const btns = ['Reject non-essential', 'Accept analytics', 'Accept all', 'Reject all', 'Got it'];
  for (const label of btns) {
    const b = page.getByRole('button', { name: new RegExp(label, 'i') }).first();
    if (await b.isVisible().catch(() => false)) {
      await b.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(500);
      return true;
    }
  }
  return false;
}

async function loginUI(page, creds) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(600);
  if (page.url().endsWith('/login') || page.url().endsWith('/login/')) {
    await page.fill('input[type="email"], input[name="email"]', creds.email);
    await page.fill('input[type="password"], input[name="password"]', creds.password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
  }
  await dismissConsent(page);
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });

  // ---- Flow A + B + E: employee ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(10000);
    await loginUI(page, EMPLOYEE);
    const empToken = await apiLogin(EMPLOYEE);

    // A. Attendance punch-in / punch-out
    try {
      await page.goto(`${BASE_URL}/attendance`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      const punchInBtn = page.getByRole('button', { name: /punch in/i }).first();
      if (await punchInBtn.isVisible().catch(() => false)) {
        await punchInBtn.click();
        await page.waitForTimeout(2500);
        const r = await apiGet('/attendance/today', empToken);
        const j = await r.json();
        const rec = j?.record || j?.data || j;
        const checkedIn = !!(rec?.is_checked_in || rec?.check_in_at);
        log('employee', 'attendance-punch-in', checkedIn, checkedIn ? 'API shows checked-in' : 'API: ' + JSON.stringify(j).slice(0, 160));
        const punchOutBtn = page.getByRole('button', { name: /punch out/i }).first();
        if (await punchOutBtn.isVisible().catch(() => false)) {
          await punchOutBtn.click();
          await page.waitForTimeout(2000);
          const r2 = await apiGet('/attendance/today', empToken);
          const j2 = await r2.json();
          const rec2 = j2?.record || j2?.data || j2;
          const checkedOut = !(rec2?.is_checked_in);
          log('employee', 'attendance-punch-out', checkedOut, checkedOut ? 'API shows checked-out' : 'still checked in');
        } else {
          log('employee', 'attendance-punch-out', false, 'punch-out button not visible');
        }
      } else {
        log('employee', 'attendance-punch-in', false, 'punch-in button not visible');
      }
    } catch (e) {
      log('employee', 'attendance', false, String(e.message || e).slice(0, 200));
    }

    // B. Leave apply
    try {
      await page.goto(`${BASE_URL}/leave`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      const applyBtn = page.getByRole('button', { name: /submit leave request/i }).last();
      if (await applyBtn.isVisible().catch(() => false)) {
        await applyBtn.click();
        await page.waitForTimeout(1800);
        // Modal may open with a reason textarea
        const ta = page.locator('textarea').first();
        if (await ta.isVisible().catch(() => false)) {
          await ta.fill('E2E smoke test leave request');
          await page.waitForTimeout(300);
        }
        const submit = page.getByRole('button', { name: /submit leave request|submit/i }).last();
        if (await submit.isVisible().catch(() => false)) {
          await submit.click();
          await page.waitForTimeout(3000);
          const r = await apiGet('/leave-requests?status=pending&limit=50', empToken);
          const j = await r.json();
          const list = j?.data?.data || j?.data || j || [];
          const arr = Array.isArray(list) ? list : (list.data || []);
          const found = arr.find((x) => (x.reason || '').includes('E2E smoke test leave request'));
          log('employee', 'leave-apply', !!found, found ? `created leave id=${found.id}` : 'no matching pending leave in API');
        } else {
          log('employee', 'leave-apply', false, 'submit button not visible after apply click');
        }
      } else {
        log('employee', 'leave-apply', false, 'submit-leave-request button not visible');
      }
    } catch (e) {
      log('employee', 'leave-apply', false, String(e.message || e).slice(0, 200));
    }

    // E. Timer start/stop
    // The running timer is reported by GET /time-entries/active (whereNull end_time),
    // NOT GET /time-entries?active=1 (which ignores the flag and returns all entries).
    // The UI "Pause" (aria-label "Pause timer") is enabled only while a timer runs.
    try {
      await page.goto(`${BASE_URL}/time-tracker`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(8000);

      const startBtn = page.getByRole('button', { name: /start/i }).first();
      const pauseBtn = page.getByRole('button', { name: /pause/i }).first();

      // Wait for the Start control to become visible/enabled (page hydrates and
      // the timer context loads). Use Playwright's waitFor rather than polling.
      let startEnabled = false;
      try {
        await startBtn.waitFor({ state: 'visible', timeout: 20000 });
        startEnabled = !(await startBtn.isDisabled().catch(() => true));
      } catch {
        startEnabled = false;
      }

      let hasActive = false;
      if (startEnabled) {
        await startBtn.click();
        await page.waitForTimeout(4000);
        const r = await apiGet('/time-entries/active', empToken);
        const j = await r.json();
        const activeObj = (Array.isArray(j) ? (j[0] || null) : j) || null;
        hasActive = !!(activeObj && activeObj.id);
        log('employee', 'timer-start', hasActive, hasActive ? `running timer id=${activeObj.id}` : 'no running timer after start');
      } else {
        const allBtns = await page.locator('button').allInnerTexts().catch(() => []);
        console.log('DEBUG timer page buttons:', JSON.stringify(allBtns.filter(Boolean)));
        const dbgBody = await page.locator('body').innerText().catch(() => '');
        console.log('DEBUG timer page body snippet:', dbgBody.slice(0, 300));
        log('employee', 'timer-start', false, 'start button not enabled/visible');
      }

      let pauseEnabled = false;
      try {
        await pauseBtn.waitFor({ state: 'visible', timeout: 20000 });
        pauseEnabled = !(await pauseBtn.isDisabled().catch(() => true));
      } catch {
        pauseEnabled = false;
      }
      if (hasActive && pauseEnabled) {
        await pauseBtn.click();
        await page.waitForTimeout(4000);
        const r2 = await apiGet('/time-entries/active', empToken);
        const j2 = await r2.json();
        const activeObj2 = (Array.isArray(j2) ? (j2[0] || null) : j2) || null;
        log('employee', 'timer-stop', !(activeObj2 && activeObj2.id), activeObj2 && activeObj2.id ? `still running id=${activeObj2.id}` : 'no running timer after pause');
      } else {
        log('employee', 'timer-stop', false, hasActive ? 'pause button not enabled' : 'no running timer to stop');
      }
    } catch (e) {
      log('employee', 'timer', false, String(e.message || e).slice(0, 200));
    }

    await ctx.close();
  }

  // ---- Flow C + D: admin ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(10000);
    await loginUI(page, ADMIN);
    const adminToken = await apiLogin(ADMIN);

    // C. Approval inbox shows pending leave (closes loop B)
    try {
      await page.goto(`${BASE_URL}/approval-inbox`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      const r = await apiGet('/leave-requests?status=pending&limit=50', adminToken);
      const j = await r.json();
      const list = j?.data?.data || j?.data || [];
      const arr = Array.isArray(list) ? list : (list.data || []);
      const found = arr.find((x) => (x.reason || '').includes('E2E smoke test leave request'));
      log('admin', 'approval-inbox-shows-pending-leave', !!found, found ? `pending leave id=${found.id} visible in API` : 'pending E2E leave not found via API');
    } catch (e) {
      log('admin', 'approval-inbox', false, String(e.message || e).slice(0, 200));
    }

    // D. Create employee (drives the /add-user wizard end-to-end)
    try {
      await page.goto(`${BASE_URL}/add-user`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(9000);

      const uniqueEmail = `qa.e2e.${Date.now()}@carevance.test`;

      // Step 1 required fields
      await page.locator('input[placeholder="John"]').first().fill('QA');
      await page.locator('input[placeholder="Doe"]').first().fill('E2E');
      await page.locator('input[type="email"]').first().fill(uniqueEmail);
      await page.locator('input[placeholder="+91 98765 43210"]').first().fill('+919876543210');
      await page.locator('input[placeholder="e.g., Software Engineer"]').first().fill('QA Engineer');
      await page.locator('input[type="date"]').first().fill('2024-01-01');

      // Role / Work Location / Timezone are CustomSelect components.
      // Click the trigger (whose text is the current value or placeholder),
      // then click the option whose label contains the target text.
      async function selectCustom(currentText, optionLabel) {
        const trigger = page.locator('button[aria-haspopup="listbox"]', { hasText: new RegExp(currentText, 'i') }).first();
        await trigger.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(500);
        const opt = page.locator('[role="option"]', { hasText: optionLabel }).first();
        await opt.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(300);
      }
      await selectCustom('Select role|Employee', 'Employee');
      await selectCustom('Select location|Office', 'Office');
      await selectCustom('Select timezone', 'IST');

      // Department chip: first rounded-full button (department name chip).
      const firstDept = page.locator('button.rounded-full').first();
      if (await firstDept.isVisible().catch(() => false)) {
        await firstDept.click();
        await page.waitForTimeout(300);
      } else {
        log('admin', 'create-employee', false, 'department chip not found');
      }

      // Submit Step 1
      const createBtn = page.getByRole('button', { name: /create account|continue/i }).first();
      if (await createBtn.isVisible().catch(() => false)) {
        await createBtn.click();
        await page.waitForTimeout(3500);

        // Step 2 -> Continue
        const cont2 = page.getByRole('button', { name: /continue/i }).first();
        if (await cont2.isVisible().catch(() => false)) {
          await cont2.click();
          await page.waitForTimeout(5000); // Step 3 auto-creates the user
        }

        // Verify the wizard reached the success state (user is auto-created on
        // Step 3 load). The user-listing endpoint ignores the `search` param, so
        // we fetch the full org directory (period=all) and find the email in JS.
        let apiFound = false;
        for (let attempt = 0; attempt < 4 && !apiFound; attempt++) {
          const r = await apiGet('/users?period=all', adminToken);
          const j = await r.json();
          const arr = Array.isArray(j) ? j : (j?.data?.data || j?.data || []);
          if (arr.find((u) => u.email === uniqueEmail)) { apiFound = true; break; }
          await page.waitForTimeout(2000);
        }
        const successBanner = await page.getByText(/user created successfully/i).first().isVisible().catch(() => false);
        log('admin', 'create-employee', apiFound || successBanner, apiFound ? `created user (api)` : (successBanner ? 'user created (success banner shown)' : 'user not confirmed after wizard'));
      } else {
        log('admin', 'create-employee', false, 'create account button not visible on step 1');
      }
    } catch (e) {
      log('admin', 'create-employee', false, String(e.message || e).slice(0, 200));
    }

    await ctx.close();
  }

  await browser.close();
  await writeFile(join(REPORT_DIR, 'summary.json'), JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n=== E2E FLOW SMOKE SUMMARY ===`);
  console.log(`Flows: ${results.length}, Passed: ${passed}, Failed: ${results.length - passed}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
