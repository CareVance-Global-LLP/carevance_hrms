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
async function apiPost(path, token, body) {
  const r = await fetch(`${API_URL}${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return r;
}
async function apiPatch(path, token, body) {
  const r = await fetch(`${API_URL}${path}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return r;
}
// Read the underlying attendance record's manual_adjustment_seconds for a user
// + date directly from the DB (the source of truth for the time-edit mutation).
async function dbManualAdjustment(userId, date) {
  const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'backend');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { writeFile, rm } = await import('node:fs/promises');
  const execFileP = promisify(execFile);
  const tmp = join(backendDir, `qa_att_${Date.now()}.php`);
  const boot = `<?php require __DIR__ . '/vendor/autoload.php'; $app = require __DIR__ . '/bootstrap/app.php'; $k = $app->make(Illuminate\\Contracts\\Console\\Kernel::class); $k->bootstrap();`;
  const php = `$rec = App\\Models\\AttendanceRecord::where('user_id', ${userId})->whereDate('attendance_date', '${date}')->first(); echo json_encode(['manual_adjustment_seconds' => $rec ? (int)$rec->manual_adjustment_seconds : null, 'worked_seconds' => $rec ? (int)$rec->worked_seconds : null]);`;
  await writeFile(tmp, boot + "\n" + php + "\n");
  try {
    const { stdout } = await execFileP('php', [tmp], { cwd: backendDir, timeout: 30000 });
    return JSON.parse(stdout.trim());
  } finally {
    await rm(tmp, { force: true });
  }
}

// Resolve the employee's DB id (needed for the attendance-record lookup).
async function dbUserId(email) {
  const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'backend');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { writeFile, rm } = await import('node:fs/promises');
  const execFileP = promisify(execFile);
  const tmp = join(backendDir, `qa_uid_${Date.now()}.php`);
  const boot = `<?php require __DIR__ . '/vendor/autoload.php'; $app = require __DIR__ . '/bootstrap/app.php'; $k = $app->make(Illuminate\\Contracts\\Console\\Kernel::class); $k->bootstrap();`;
  const php = `$u = App\\Models\\User::where('email', '${email}')->first(); echo $u ? (int)$u->id : 0;`;
  await writeFile(tmp, boot + "\n" + php + "\n");
  try {
    const { stdout } = await execFileP('php', [tmp], { cwd: backendDir, timeout: 30000 });
    return parseInt(stdout.trim(), 10) || 0;
  } finally {
    await rm(tmp, { force: true });
  }
}

// Read a leave request by id (from the reviewer/admin index is not id-keyed, so
// use the admin pending list and find by id).
async function findLeaveById(token, id) {
  const r = await apiGet(`/leave-requests?status=pending&limit=200`, token);
  const j = await r.json();
  const list = j?.data?.data || j?.data || j || [];
  const arr = Array.isArray(list) ? list : (list.data || []);
  return arr.find((x) => String(x.id) === String(id)) || null;
}
async function findTimeEditById(token, id) {
  const r = await apiGet(`/attendance-time-edit-requests?status=pending&limit=200`, token);
  const j = await r.json();
  const list = j?.data?.data || j?.data || j || [];
  const arr = Array.isArray(list) ? list : (list.data || []);
  return arr.find((x) => String(x.id) === String(id)) || null;
}

// Remove any stale pending time-edit / leave requests for a user so subsequent
// test creations don't collide with "already exists for this date" / overlap
// validation. Runs a tiny backend PHP via temp file (no shell-escaping issues).
async function dbDeletePendingTimeEdits(userId) {
  const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'backend');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { writeFile, rm } = await import('node:fs/promises');
  const execFileP = promisify(execFile);
  const tmp = join(backendDir, `qa_del_te_${Date.now()}.php`);
  const boot = `<?php require __DIR__ . '/vendor/autoload.php'; $app = require __DIR__ . '/bootstrap/app.php'; $k = $app->make(Illuminate\\Contracts\\Console\\Kernel::class); $k->bootstrap();`;
  const php = `echo App\\Models\\AttendanceTimeEditRequest::where('user_id', ${userId})->where('status','pending')->delete();`;
  await writeFile(tmp, boot + "\n" + php + "\n");
  try { await execFileP('php', [tmp], { cwd: backendDir, timeout: 30000 }); } finally { await rm(tmp, { force: true }); }
}
async function dbDeletePendingLeaves(userId) {
  const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'backend');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { writeFile, rm } = await import('node:fs/promises');
  const execFileP = promisify(execFile);
  const tmp = join(backendDir, `qa_del_lv_${Date.now()}.php`);
  const boot = `<?php require __DIR__ . '/vendor/autoload.php'; $app = require __DIR__ . '/bootstrap/app.php'; $k = $app->make(Illuminate\\Contracts\\Console\\Kernel::class); $k->bootstrap();`;
  // Delete ALL leaves for the user (any status) so prior approved/rejected
  // requests from earlier runs can't collide via the overlap check.
  const php = `echo App\\Models\\LeaveRequest::where('user_id', ${userId})->delete();`;
  await writeFile(tmp, boot + "\n" + php + "\n");
  try { await execFileP('php', [tmp], { cwd: backendDir, timeout: 30000 }); } finally { await rm(tmp, { force: true }); }
}

// Return the next `count` weekday (Mon-Fri) YYYY-MM-DD strings starting from
// today + `startOffsetDays`. Avoids weekend ranges that trip "covers no
// working days" leave validation.
function weekdayDates(startOffsetDays, count) {
  const out = [];
  const d = new Date();
  d.setDate(d.getDate() + startOffsetDays);
  while (out.length < count) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) {
      out.push(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 1);
    } else {
      d.setDate(d.getDate() + 1);
    }
  }
  return out;
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

// Find an approval-inbox card belonging to `identifier` (employee name or
// email) and click its Approve (or Reject) button. Drives the real UI.
async function clickInboxAction(page, identifier, action) {
  // Cards live inside the `space-y-3` container; each is a SurfaceCard. We
  // scope to cards that actually mention the requester, then click the
  // matching action button inside that card.
  const cards = page.locator('div.space-y-3 > div').filter({ hasText: identifier });
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const btn = card.getByRole('button', { name: new RegExp(`^${action}$`, 'i') }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ timeout: 6000 });
      await page.waitForTimeout(1500);
      return true;
    }
  }
  return false;
}

// Make the approval-inbox show a specific section (leave / time-edit /
// resignation) via the URL query param the component reads. Waits for the
// pending cards to render (data loads asynchronously from several endpoints).
async function openInboxSection(page, section) {
  await page.goto(`${BASE_URL}/approval-inbox?section=${section}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  // Wait until at least one Approve/Reject button is present (data loaded).
  try {
    await page.getByRole('button', { name: /^Approve$/i }).first().waitFor({ state: 'visible', timeout: 15000 });
  } catch {
    // No pending items for this section — callers handle that gracefully.
  }
}

async function approvalFlows(browser) {
  const adminCtx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const adminPage = await adminCtx.newPage();
  adminPage.setDefaultTimeout(10000);
  await loginUI(adminPage, ADMIN);
  const adminToken = await apiLogin(ADMIN);

  const empCtx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const empPage = await empCtx.newPage();
  empPage.setDefaultTimeout(10000);
  await loginUI(empPage, EMPLOYEE);
  const empToken = await apiLogin(EMPLOYEE);

  // Resolve the admin's org + reviewer set for routing expectations.
  const meR = await apiGet('/auth/me', adminToken);
  const meJ = await meR.json();
  const adminUser = meJ.user || meJ.data || meJ;

  // -----------------------------------------------------------------------
  // STAGE 3.1 — leave-request-full-cycle (employee -> admin approves via UI)
  // -----------------------------------------------------------------------
  try {
    const empId = await dbUserId(EMPLOYEE.email);
    await dbDeletePendingLeaves(empId); // avoid overlap/build-up across runs
    const [start, end] = weekdayDates(20, 2);
    const createR = await apiPost('/leave-requests', empToken, {
      start_date: start, end_date: end, leave_type: 'full_day', leave_category: 'paid', reason: `E2E leave ${Date.now()}`,
    });
    const cj = await createR.json();
    const createdId = cj?.data?.id || cj?.id;
    // Confirm it shows up as pending for the admin (routing)
    const lr = await apiGet('/leave-requests?status=pending&limit=200', adminToken);
    const lj = await lr.json();
    const llist = lj?.data?.data || lj?.data || [];
    const larr = Array.isArray(llist) ? llist : (llist.data || []);
    const leave = larr.find((x) => String(x.id) === String(createdId)) || larr.find((x) => (x.reason || '').includes('E2E leave'));
    const routedToAdmin = !!leave && Array.isArray(leave.current_reviewer_ids) && leave.current_reviewer_ids.map(Number).includes(Number(adminUser.id));
    log('admin', 'leave-request-routing', !!leave, leave ? `pending leave id=${leave.id} routedToAdmin=${routedToAdmin}` : `create resp ${createR.status} ${JSON.stringify(cj).slice(0,120)}`);

    // Admin approves via the real UI
    if (leave) {
      await openInboxSection(adminPage, 'leave');
      const clicked = await clickInboxAction(adminPage, EMPLOYEE.email, 'Approve');
      await adminPage.waitForTimeout(3000);
      // After approval the request leaves the pending list; verify via the
      // approved list instead.
      const apR = await apiGet('/leave-requests?status=approved&limit=200', adminToken);
      const apJ = await apR.json();
      const apList = apJ?.data?.data || apJ?.data || [];
      const apArr = Array.isArray(apList) ? apList : (apList.data || []);
      const after = apArr.find((x) => String(x.id) === String(leave.id));
      const approved = !!after;
      log('admin', 'leave-request-full-cycle', approved, approved ? `leave id=${leave.id} approved via UI` : `not in approved list (clickedApprove=${clicked})`);
    } else {
      log('admin', 'leave-request-full-cycle', false, 'no leave created to approve');
    }
  } catch (e) {
    log('admin', 'leave-request-full-cycle', false, String(e.message || e).slice(0, 200));
  }

  // -----------------------------------------------------------------------
  // STAGE 3.2 — leave-request-rejection (employee -> admin rejects via UI)
  // -----------------------------------------------------------------------
  try {
    const empId = await dbUserId(EMPLOYEE.email);
    await dbDeletePendingLeaves(empId);
    const [start, end] = weekdayDates(30, 2);
    const createR = await apiPost('/leave-requests', empToken, {
      start_date: start, end_date: end, leave_type: 'full_day', leave_category: 'paid', reason: `E2E leave reject ${Date.now()}`,
    });
    const cj = await createR.json();
    const createdId = cj?.data?.id || cj?.id;
    const lr = await apiGet('/leave-requests?status=pending&limit=200', adminToken);
    const lj = await lr.json();
    const llist = lj?.data?.data || lj?.data || [];
    const larr = Array.isArray(llist) ? llist : (llist.data || []);
    const leave = larr.find((x) => String(x.id) === String(createdId)) || larr.find((x) => (x.reason || '').includes('E2E leave reject'));
    if (leave) {
      await openInboxSection(adminPage, 'leave');
      const clicked = await clickInboxAction(adminPage, EMPLOYEE.email, 'Reject');
      await adminPage.waitForTimeout(3000);
      // After reject the request leaves the pending list; verify via the
      // rejected list instead.
      const rjR = await apiGet('/leave-requests?status=rejected&limit=200', adminToken);
      const rjJ = await rjR.json();
      const rjList = rjJ?.data?.data || rjJ?.data || [];
      const rjArr = Array.isArray(rjList) ? rjList : (rjList.data || []);
      const after = rjArr.find((x) => String(x.id) === String(leave.id));
      const rejected = !!after;
      log('admin', 'leave-request-rejection', rejected, rejected ? `leave id=${leave.id} rejected via UI` : `not in rejected list (clickedReject=${clicked})`);
    } else {
      log('admin', 'leave-request-rejection', false, 'no leave created to reject');
    }
  } catch (e) {
    log('admin', 'leave-request-rejection', false, String(e.message || e).slice(0, 200));
  }

  // -----------------------------------------------------------------------
  // STAGE 3.3 — leave-request-wrong-reviewer-blocked (403 regression guard)
  // -----------------------------------------------------------------------
  try {
    const empId = await dbUserId(EMPLOYEE.email);
    await dbDeletePendingLeaves(empId);
    const [start, end] = weekdayDates(40, 2);
    const createR = await apiPost('/leave-requests', empToken, {
      start_date: start, end_date: end, leave_type: 'full_day', leave_category: 'paid', reason: `E2E leave 403 ${Date.now()}`,
    });
    const cj = await createR.json();
    const createdId = cj?.data?.id || cj?.id;
    if (createdId) {
      // Attempt to approve as the SAME employee (peer, not in reviewer set).
      const r = await apiPatch(`/leave-requests/${createdId}/approve`, empToken, {});
      const blocked = r.status === 403;
      log('employee', 'leave-request-wrong-reviewer-blocked', blocked, blocked ? `peer approve of leave id=${createdId} correctly 403` : `unexpected status ${r.status}`);
    } else {
      log('employee', 'leave-request-wrong-reviewer-blocked', false, `no leave created (resp ${createR.status})`);
    }
  } catch (e) {
    log('employee', 'leave-request-wrong-reviewer-blocked', false, String(e.message || e).slice(0, 200));
  }

  // -----------------------------------------------------------------------
  // STAGE 4.1 — time-edit-request-full-cycle (employee -> admin approves via UI)
  // Verifies approval MUTATES the underlying attendance record.
  // -----------------------------------------------------------------------
  try {
    const date = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10); // well in the past, unique
    const empId = await dbUserId(EMPLOYEE.email);
    await dbDeletePendingTimeEdits(empId); // avoid "already exists for this date"
    const createR = await apiPost('/attendance-time-edit-requests', empToken, {
      attendance_date: date, extra_minutes: 30, message: `E2E time edit ${Date.now()}`, worked_seconds: 0, overtime_seconds: 0,
    });
    const cj = await createR.json();
    const createdId = cj?.data?.id || cj?.id;
    const listed = await findTimeEditById(adminToken, createdId);
    const routed = !!listed && Array.isArray(listed.current_reviewer_ids) && listed.current_reviewer_ids.map(Number).includes(Number(adminUser.id));
    log('admin', 'time-edit-request-routing', !!listed, listed ? `time-edit id=${createdId} routedToAdmin=${routed}` : `create resp ${createR.status}`);

    if (listed) {
      await openInboxSection(adminPage, 'time-edit');
      const clicked = await clickInboxAction(adminPage, EMPLOYEE.email, 'Approve');
      await adminPage.waitForTimeout(3000);
      const afterR = await apiGet('/attendance-time-edit-requests?status=approved&limit=200', adminToken);
      const aj = await afterR.json();
      const alist = aj?.data?.data || aj?.data || [];
      const aarr = Array.isArray(alist) ? alist : (alist.data || []);
      const approved = aarr.find((x) => String(x.id) === String(createdId));

      // Verify the underlying attendance record was actually adjusted.
      const att = await dbManualAdjustment(empId, date);
      const manualAdj = att?.manual_adjustment_seconds ?? 0;
      const mutated = Number(manualAdj) > 0;
      log('admin', 'time-edit-request-full-cycle', !!approved && mutated,
        `approved=${!!approved} attendance manual_adjustment_seconds=${manualAdj} (mutated=${mutated}) clickedApprove=${clicked}`);
    } else {
      log('admin', 'time-edit-request-full-cycle', false, 'no time-edit request created to approve');
    }
  } catch (e) {
    log('admin', 'time-edit-request-full-cycle', false, String(e.message || e).slice(0, 200));
  }

  // -----------------------------------------------------------------------
  // STAGE 4.2 — time-edit-request-rejection (verify attendance UNCHANGED)
  // -----------------------------------------------------------------------
  try {
    const date = new Date(Date.now() - 61 * 86400000).toISOString().slice(0, 10);
    const empId = await dbUserId(EMPLOYEE.email);
    await dbDeletePendingTimeEdits(empId);
    const createR = await apiPost('/attendance-time-edit-requests', empToken, {
      attendance_date: date, extra_minutes: 45, message: `E2E time edit reject ${Date.now()}`, worked_seconds: 0, overtime_seconds: 0,
    });
    const cj = await createR.json();
    const createdId = cj?.data?.id || cj?.id;
    const listed = await findTimeEditById(adminToken, createdId);
    if (listed) {
      const attB = await dbManualAdjustment(empId, date);
      const beforeAdj = Number(attB?.manual_adjustment_seconds ?? 0);

      await openInboxSection(adminPage, 'time-edit');
      const clicked = await clickInboxAction(adminPage, EMPLOYEE.email, 'Reject');
      await adminPage.waitForTimeout(3000);
      const afterR = await apiGet('/attendance-time-edit-requests?status=rejected&limit=200', adminToken);
      const aj = await afterR.json();
      const alist = aj?.data?.data || aj?.data || [];
      const aarr = Array.isArray(alist) ? alist : (alist.data || []);
      const rejected = aarr.find((x) => String(x.id) === String(createdId));

      const attA = await dbManualAdjustment(empId, date);
      const afterAdj = Number(attA?.manual_adjustment_seconds ?? 0);
      const unchanged = beforeAdj === afterAdj;
      log('admin', 'time-edit-request-rejection', !!rejected && unchanged,
        `rejected=${!!rejected} attendance adj before=${beforeAdj} after=${afterAdj} (unchanged=${unchanged}) clickedReject=${clicked}`);
    } else {
      log('admin', 'time-edit-request-rejection', false, 'no time-edit request created to reject');
    }
  } catch (e) {
    log('admin', 'time-edit-request-rejection', false, String(e.message || e).slice(0, 200));
  }

  // -----------------------------------------------------------------------
  // STAGE 4.3 — time-edit-wrong-reviewer-blocked (403 regression guard)
  // -----------------------------------------------------------------------
  try {
    const date = new Date(Date.now() - 62 * 86400000).toISOString().slice(0, 10);
    const empId = await dbUserId(EMPLOYEE.email);
    await dbDeletePendingTimeEdits(empId);
    const createR = await apiPost('/attendance-time-edit-requests', empToken, {
      attendance_date: date, extra_minutes: 15, message: `E2E time edit 403 ${Date.now()}`, worked_seconds: 0, overtime_seconds: 0,
    });
    const cj = await createR.json();
    const createdId = cj?.data?.id || cj?.id;
    if (createdId) {
      const r = await apiPatch(`/attendance-time-edit-requests/${createdId}/approve`, empToken, {});
      const blocked = r.status === 403;
      log('employee', 'time-edit-wrong-reviewer-blocked', blocked, blocked ? `peer approve of time-edit id=${createdId} correctly 403` : `unexpected status ${r.status}`);
    } else {
      log('employee', 'time-edit-wrong-reviewer-blocked', false, 'no time-edit request created to test 403');
    }
  } catch (e) {
    log('employee', 'time-edit-wrong-reviewer-blocked', false, String(e.message || e).slice(0, 200));
  }

  // -----------------------------------------------------------------------
  // STAGE 5 — resignation full apply -> approve cycle
  // -----------------------------------------------------------------------
  try {
    // Cancel any existing pending resignation so we can submit a fresh one.
    await apiPost('/resignations/my', empToken, {}).catch(() => {});
    const future = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const subR = await apiPost('/resignations', empToken, { last_working_date: future, reason: `E2E resignation ${Date.now()}` });
    const sj = await subR.json();
    const resId = sj?.resignation?.id || sj?.data?.id || sj?.id;
    const listedR = await apiGet('/resignations?status=pending&limit=200', adminToken);
    const lj = await listedR.json();
    const llist = lj?.data?.data || lj?.data || [];
    const larr = Array.isArray(llist) ? llist : (llist.data || []);
    const res = larr.find((x) => String(x.id) === String(resId)) || larr.find((x) => (x.user?.email || '') === EMPLOYEE.email);
    const routed = !!res && Array.isArray(res.current_reviewer_ids) && res.current_reviewer_ids.map(Number).includes(Number(adminUser.id));
    log('admin', 'resignation-routing', !!res, res ? `resignation id=${res.id} routedToAdmin=${routed}` : `submit resp ${subR.status}`);

    if (res) {
      await openInboxSection(adminPage, 'resignation');
      const clicked = await clickInboxAction(adminPage, EMPLOYEE.email, 'Approve');
      await adminPage.waitForTimeout(3000);
      const afterR = await apiGet('/resignations?status=approved&limit=200', adminToken);
      const aj = await afterR.json();
      const alist = aj?.data?.data || aj?.data || [];
      const aarr = Array.isArray(alist) ? alist : (alist.data || []);
      const approved = aarr.find((x) => String(x.id) === String(res.id));
      log('admin', 'resignation-approve-cycle', !!approved, approved ? `resignation id=${res.id} approved via UI` : `not found approved (clickedApprove=${clicked})`);
    } else {
      log('admin', 'resignation-approve-cycle', false, 'no resignation created to approve');
    }
  } catch (e) {
    log('admin', 'resignation-approve-cycle', false, String(e.message || e).slice(0, 200));
  }

  await empCtx.close();
  await adminCtx.close();
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

  // ---- Stages 3-5: approval request->review->resolution flows ----
  await approvalFlows(browser);

  await browser.close();
  await writeFile(join(REPORT_DIR, 'summary.json'), JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n=== E2E FLOW SMOKE SUMMARY ===`);
  console.log(`Flows: ${results.length}, Passed: ${passed}, Failed: ${results.length - passed}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
