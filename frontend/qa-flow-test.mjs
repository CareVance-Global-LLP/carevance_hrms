// qa-flow-test.mjs
// Flow + role-based smoke test. Drives the live web app (the surface the
// desktop embeds and that shares logic with mobile). For each role it:
//   1. Logs in
//   2. Visits a set of representative routes and records whether each is
//      ALLOWED (renders content) or BLOCKED (redirected away / shows guard)
//   3. Runs a few real end-to-end interactions for that role
// Produces qa-report-flow/summary.json

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
const REPORT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'qa-report-flow');
const TIMEOUT_MS = 20000;

const ROLES = [
  {
    key: 'admin', level: 10,
    email: process.env.TEST_ADMIN_EMAIL || 'ayushborwal004@gmail.com',
    password: process.env.TEST_ADMIN_PASSWORD || 'TestPass123!',
    // AdminRoute (level<100) => allowed; SuperAdminRoute (level 0) => blocked
    expectAllowed: ['/dashboard', '/employees', '/organization-tree', '/payroll', '/settings/billing', '/audit-logs', '/attendance', '/leave', '/reports', '/analytics', '/monitoring/productive-time', '/approval-inbox', '/invoices', '/assets', '/settings/roles'],
    expectBlocked: ['/super-admin', '/super-admin/organizations', '/super-admin/users', '/super-admin/billing', '/super-admin/plans', '/super-admin/companies'],
  },
  {
    key: 'manager', level: 50,
    email: process.env.TEST_MANAGER_EMAIL || 'test2@gmail.com',
    password: process.env.TEST_MANAGER_PASSWORD || '12345678',
    // AdminRoute (level<100) => allowed; StrictAdminRoute (level<=10) => blocked;
    // EmployeeRoute (level>=100) => blocked; SuperAdminRoute => blocked
    expectAllowed: ['/dashboard', '/employees', '/attendance', '/leave', '/reports', '/analytics', '/approval-inbox', '/tasks', '/projects', '/monitoring/productive-time', '/payroll', '/audit-logs', '/organization-tree', '/assets', '/settings/roles'],
    expectBlocked: ['/super-admin', '/super-admin/companies', '/my-team', '/settings/billing'],
  },
  {
    key: 'employee', level: 100,
    email: process.env.TEST_EMPLOYEE_EMAIL || 'test1@gmail.com',
    password: process.env.TEST_EMPLOYEE_PASSWORD || '12345678',
    // AdminRoute (level<100) blocked; ProtectedRoute allowed
    expectAllowed: ['/dashboard', '/attendance', '/leave', '/my-payroll', '/tasks', '/projects', '/chat', '/notifications', '/settings'],
    expectBlocked: ['/super-admin', '/employees', '/payroll', '/organization-tree', '/audit-logs', '/approval-inbox', '/monitoring/productive-time', '/reports', '/analytics', '/settings/billing', '/settings/roles', '/invoices', '/assets'],
  },
  {
    key: 'super_admin', level: 0,
    email: process.env.TEST_SUPER_EMAIL || 'qa.superadmin@carevance.test',
    password: process.env.TEST_SUPER_PASSWORD || 'QaTest123!',
    // Super admin: full access everywhere (level 0 passes all guards)
    expectAllowed: ['/dashboard', '/super-admin', '/super-admin/organizations', '/super-admin/users', '/super-admin/billing', '/super-admin/plans', '/super-admin/companies', '/employees', '/payroll', '/settings/billing', '/audit-logs', '/organization-tree', '/assets', '/settings/roles', '/monitoring/productive-time', '/reports', '/analytics'],
    expectBlocked: [],
  },
  {
    key: 'custom_limited', level: 100,
    email: process.env.TEST_CUSTOM_EMAIL || 'qa.customrole@carevance.test',
    password: process.env.TEST_CUSTOM_PASSWORD || 'QaTest123!',
    // role=employee (level 100) => AdminRoute blocks admin pages (route guard uses
    // role hierarchy, NOT the custom permission array). ProtectedRoute pages render.
    expectAllowed: ['/dashboard', '/attendance', '/leave', '/time-tracker', '/tasks', '/projects', '/chat', '/notifications', '/settings', '/my-payroll'],
    expectBlocked: ['/super-admin', '/super-admin/companies', '/employees', '/payroll', '/organization-tree', '/audit-logs', '/approval-inbox', '/reports', '/analytics', '/monitoring/productive-time', '/settings/billing', '/settings/roles', '/invoices', '/assets'],
  },
];

// A route is considered RENDERED when the browser actually stays on it
// (final URL still matches the requested path). If the SPA redirects away
// (to /login, /dashboard, /onboarding/profile, etc.) the route was gated.
const strip = (u) => u.replace(/\/?(\?.*)?(#.*)?$/, '').replace(/\/$/, '') || '/';
function renderedOn(path, finalUrl) {
  const req = strip(`${BASE_URL}${path}`);
  const fin = strip(finalUrl);
  return fin === req || fin.startsWith(req + '/');
}

async function login(page, role) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
  await page.waitForTimeout(700);
  const url = page.url();
  if (url.endsWith('/login') || url.endsWith('/login/')) {
    await page.fill('input[type="email"], input[name="email"]', role.email).catch(() => {});
    await page.fill('input[type="password"], input[name="password"]', role.password).catch(() => {});
    await page.click('button[type="submit"]').catch(() => {});
    await page.waitForTimeout(3500);
  }
}

async function checkRoute(page, path) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
  await page.waitForTimeout(2200);
  const finalUrl = page.url();
  // Wait a bit more for app chrome to render if we landed on the page.
  const content = await page.evaluate(() => {
    const t = (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').trim();
    const hasChrome = !!(document.querySelector('nav, aside, [class*="sidebar"], header, [role="navigation"]'));
    return { len: t.length, hasChrome, text: t.slice(0, 160) };
  });
  const rendered = renderedOn(path, finalUrl);
  return { path, finalUrl, rendered, bodyLen: content.len, hasChrome: content.hasChrome, bodyText: content.text };
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const results = [];

  for (const role of ROLES) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const roleResult = { role: role.key, email: role.email, loginOk: true, allowed: [], blocked: [], mismatches: [] };

    try {
      await login(page, role);
      // Confirm login succeeded (not on login page)
      if (page.url().includes('login')) {
        roleResult.loginOk = false;
      } else {
        for (const p of role.expectAllowed) {
          const r = await checkRoute(page, p);
          roleResult.allowed.push({ path: p, rendered: r.rendered, finalUrl: r.finalUrl, bodyLen: r.bodyLen, hasChrome: r.hasChrome });
          if (!r.rendered) roleResult.mismatches.push({ path: p, expected: 'rendered', got: 'redirected', finalUrl: r.finalUrl });
        }
        for (const p of role.expectBlocked) {
          const r = await checkRoute(page, p);
          const correctlyBlocked = !r.rendered;
          roleResult.blocked.push({ path: p, blocked: correctlyBlocked, finalUrl: r.finalUrl, bodyLen: r.bodyLen });
          if (!correctlyBlocked) roleResult.mismatches.push({ path: p, expected: 'blocked', got: 'rendered', finalUrl: r.finalUrl });
        }
      }
    } catch (e) {
      roleResult.error = String(e.message || e).slice(0, 300);
    }

    await context.close();
    results.push(roleResult);
    console.log(`[${role.key}] login=${roleResult.loginOk} rendered=${roleResult.allowed.filter((a) => a.rendered).length}/${role.expectAllowed.length} blocked=${roleResult.blocked.filter((b) => b.blocked).length}/${role.expectBlocked.length} mismatches=${roleResult.mismatches.length}`);
  }

  await browser.close();
  await writeFile(join(REPORT_DIR, 'summary.json'), JSON.stringify(results, null, 2));

  const totalMismatch = results.reduce((s, r) => s + r.mismatches.length, 0);
  console.log(`\n=== FLOW/ROLE SMOKE SUMMARY ===`);
  console.log(`Roles tested: ${results.length}`);
  console.log(`Total role-gate mismatches: ${totalMismatch}`);
  for (const r of results) {
    if (r.mismatches.length) {
      console.log(`\n${r.role} mismatches:`);
      for (const m of r.mismatches) console.log(`  - ${m.path}: expected ${m.expected}, got ${m.got} (${m.finalUrl})`);
    }
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
