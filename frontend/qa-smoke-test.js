// qa-smoke-test.js
// Live-app QA smoke test. Tests against a running dev server (frontend + backend).
// Produces qa-report/<route>/ with screenshot.png, console-errors.json,
// buttons-inventory.json, safe-clicks-log.json, plus qa-report/SUMMARY.json.

import { chromium } from 'playwright';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TRACE_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'qa-trace.log');
function trace(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
  appendFileSync(TRACE_FILE, line);
}

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5173';
const EMAIL = process.env.TEST_EMAIL || 'ayushborwal004@gmail.com';
const PASSWORD = process.env.TEST_PASSWORD || 'TestPass123!';
const REPORT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'qa-report');

// Optional: restrict to a subset via TEST_ROUTES=label1,label2,...
const ROUTE_FILTER = process.env.TEST_ROUTES ? String(process.env.TEST_ROUTES).split(',').map((s) => s.trim()) : null;

// Routes to test. Each gets a folder; public routes can be tested without auth.
const ROUTES = [
  { path: '/', public: true, label: 'landing' },
  { path: '/login', public: true, label: 'login' },
  { path: '/pricing', public: true, label: 'pricing' },
  { path: '/contact-sales', public: true, label: 'contact-sales' },
  { path: '/support', public: true, label: 'support' },
  { path: '/privacy', public: true, label: 'privacy' },
  { path: '/terms', public: true, label: 'terms' },
  { path: '/dashboard', label: 'dashboard' },
  { path: '/my-team', label: 'my-team' },
  { path: '/organization-tree', label: 'organization-tree' },
  { path: '/time-tracker', label: 'time-tracker' },
  { path: '/projects', label: 'projects' },
  { path: '/tasks', label: 'tasks' },
  { path: '/tasks/time-reports', label: 'tasks-time-reports' },
  { path: '/chat', label: 'chat' },
  { path: '/attendance', label: 'attendance' },
  { path: '/attendance/selfies-map', label: 'attendance-selfies-map' },
  { path: '/leave', label: 'leave' },
  { path: '/edit-time', label: 'edit-time' },
  { path: '/breaks', label: 'breaks' },
  { path: '/monitoring/productive-time', label: 'monitoring-productive-time' },
  { path: '/monitoring/unproductive-time', label: 'monitoring-unproductive-time' },
  { path: '/monitoring/screenshots', label: 'monitoring-screenshots' },
  { path: '/monitoring/app-usage', label: 'monitoring-app-usage' },
  { path: '/monitoring/website-usage', label: 'monitoring-website-usage' },
  { path: '/approval-inbox', label: 'approval-inbox' },
  { path: '/reports', label: 'reports-hub' },
  { path: '/analytics', label: 'analytics-hub' },
  { path: '/reports/attendance', label: 'reports-attendance' },
  { path: '/reports/hours-tracked', label: 'reports-hours-tracked' },
  { path: '/reports/projects-tasks', label: 'reports-projects-tasks' },
  { path: '/reports/timeline', label: 'reports-timeline' },
  { path: '/reports/web-app-usage', label: 'reports-web-app-usage' },
  { path: '/reports/productivity', label: 'reports-productivity' },
  { path: '/reports/custom-export', label: 'reports-custom-export' },
  { path: '/invoices', label: 'invoices' },
  { path: '/employees', label: 'employees' },
  { path: '/employees/teams', label: 'employees-teams' },
  { path: '/employees/invitations', label: 'employees-invitations' },
  { path: '/employees/roles', label: 'employees-roles' },
  { path: '/assets', label: 'assets' },
  { path: '/new-hires', label: 'new-hires' },
  { path: '/resignations', label: 'resignations' },
  { path: '/resignation/status', label: 'resignation-status' },
  { path: '/audit-logs', label: 'audit-logs' },
  { path: '/add-user', label: 'add-user' },
  { path: '/notifications', label: 'notifications' },
  { path: '/settings', label: 'settings' },
  { path: '/settings/billing', label: 'settings-billing' },
  { path: '/settings/geofence', label: 'settings-geofence' },
  { path: '/settings/roles', label: 'settings-roles' },
  { path: '/payroll', label: 'payroll' },
  { path: '/payroll/run', label: 'payroll-run' },
  { path: '/payroll/employee-pay', label: 'payroll-employee-pay' },
  { path: '/payroll/tax-compliance', label: 'payroll-tax-compliance' },
  { path: '/payroll/reports', label: 'payroll-reports' },
  { path: '/payroll/unassigned-employees', label: 'payroll-unassigned-employees' },
  { path: '/my-payroll', label: 'my-payroll' },
  { path: '/payroll/setup', label: 'payroll-setup' },
  { path: '/payroll/setup/defaults', label: 'payroll-setup-defaults' },
  { path: '/payroll/setup/employees', label: 'payroll-setup-employees' },
  { path: '/payroll/setup/compliance', label: 'payroll-setup-compliance' },
  { path: '/payroll/setup/statutory', label: 'payroll-setup-statutory' },
  { path: '/payroll/setup/pay-schedule', label: 'payroll-setup-pay-schedule' },
  { path: '/payroll/setup/bank', label: 'payroll-setup-bank' },
  { path: '/payroll/setup/departments', label: 'payroll-setup-departments' },
  { path: '/payroll/setup/test-run', label: 'payroll-setup-test-run' },
  { path: '/performance', label: 'performance' },
  { path: '/performance-goals', label: 'performance-goals' },
  { path: '/super-admin', label: 'super-admin' },
  { path: '/super-admin/organizations', label: 'super-admin-organizations' },
  { path: '/super-admin/users', label: 'super-admin-users' },
  { path: '/super-admin/billing', label: 'super-admin-billing' },
  { path: '/super-admin/plans', label: 'super-admin-plans' },
  { path: '/super-admin/companies', label: 'super-admin-companies' },
  { path: '/legacy/reports', label: 'legacy-reports' },
];

// Safe-action allowlist: only these lowercased button texts/aria-labels will be clicked.
const SAFE_ACTION_KEYWORDS = [
  'tab', 'filter', 'sort', 'view', 'show', 'hide', 'toggle', 'expand', 'collapse',
  'open', 'close', 'next', 'previous', 'prev', 'details', 'more', 'less', 'info',
  'settings', 'search', 'refresh', 'reload', 'export', 'download', 'print', 'copy',
  'share', 'help', 'menu', 'back', 'home', 'dashboard', 'calendar', 'profile',
  'notifications', 'bell', 'theme', 'language', 'logout', 'sign out', 'week', 'month',
  'day', 'today', 'weekly', 'monthly', 'all', 'page', 'first', 'last', 'clear',
  'select', 'deselect', 'check', 'uncheck', 'switch', 'change', 'update view',
];

// Destructive-action keywords: never auto-click these.
const DESTRUCTIVE_KEYWORDS = [
  'delete', 'remove', 'approve', 'reject', 'disburse', 'submit', 'create', 'add',
  'save', 'send', 'invite', 'send invite', 'confirm', 'revoke', 'cancel request',
  'terminate', 'ban', 'reset', 'archive', 'publish', 'upgrade', 'downgrade',
  'mark paid', 'mark as', 'activate', 'deactivate', 'lock', 'unlock', 'generate',
  'run payroll', 'process', 'pay', 'transfer', 'withdraw', 'logout-now', 'sign out now',
];

function isSafeAction(text) {
  const t = (text || '').trim().toLowerCase();
  if (!t) return false;
  if (DESTRUCTIVE_KEYWORDS.some((k) => t.includes(k))) return false;
  return SAFE_ACTION_KEYWORDS.some((k) => t.includes(k));
}

function isDestructive(text) {
  const t = (text || '').trim().toLowerCase();
  return DESTRUCTIVE_KEYWORDS.some((k) => t.includes(k));
}

const summary = [];

async function safeLogin(page) {
  // Navigate to login, fill, submit.
  await page.goto(`${BASE_URL}/login`, GOTO_OPTS).catch(() => {});
  // Sometimes already authenticated; check if redirected away from login.
  const url = page.url();
  if (url.endsWith('/login') || url.endsWith('/login/')) {
    await page.waitForTimeout(1000);
    await page.fill('input[type="email"], input[name="email"]', EMAIL).catch(() => {});
    await page.fill('input[type="password"], input[name="password"]', PASSWORD).catch(() => {});
    await page.click('button[type="submit"]').catch(() => {});
    await page.waitForTimeout(3000);
  }
}

async function inventoryButtons(page) {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]'));
    const out = [];
    for (const el of els) {
      const text = (el.innerText || el.getAttribute('aria-label') || el.value || el.title || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      out.push({
        tag: el.tagName.toLowerCase(),
        text: text.slice(0, 120),
        href: el.getAttribute('href') || null,
        disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
        type: el.getAttribute('type') || null,
      });
    }
    return out;
  });
}

async function runSafeClicks(page, routePath) {
  const log = [];
  // Snapshot candidate metadata in one evaluate to avoid stale-element waits.
  const candidates = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('button, a[href], [role="button"], input[type="submit"], input[type="button"]'));
    return els.slice(0, 250).map((el, i) => {
      const text = (el.innerText || el.getAttribute('aria-label') || el.value || el.title || '').replace(/\s+/g, ' ').trim();
      return {
        i,
        text: text.slice(0, 120),
        href: el.getAttribute('href') || null,
        disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
        tag: el.tagName.toLowerCase(),
      };
    });
  });

  let clicksPerformed = 0;
  for (const c of candidates) {
    if (clicksPerformed >= 8) break; // cap to keep runtime bounded
    const label = (c.text || '').slice(0, 120);
    if (!label) { log.push({ index: c.i, text: '', action: 'SKIPPED', reason: 'no-text' }); continue; }
    if (c.href && c.href.startsWith('/')) { log.push({ index: c.i, text: label, action: 'SKIPPED', reason: 'navigation-link' }); continue; }
    if (isDestructive(label)) { log.push({ index: c.i, text: label, action: 'SKIPPED', reason: 'destructive-keyword' }); continue; }
    if (!isSafeAction(label)) { log.push({ index: c.i, text: label, action: 'SKIPPED', reason: 'not-in-safe-allowlist' }); continue; }
    if (c.disabled) { log.push({ index: c.i, text: label, action: 'SKIPPED', reason: 'disabled' }); continue; }

    const beforeUrl = page.url();
    try {
      // Re-query a fresh locator by index to avoid stale handles.
      const sel = 'button, a[href], [role="button"], input[type="submit"], input[type="button"]';
      const loc = page.locator(sel).nth(c.i);
      if (!(await loc.isVisible().catch(() => false))) {
        log.push({ index: c.i, text: label, action: 'SKIPPED', reason: 'not-visible' });
        continue;
      }
      await loc.click({ timeout: 4000 });
      await page.waitForTimeout(700);
      const afterUrl = page.url();
      log.push({
        index: c.i, text: label, action: 'CLICKED',
        redirected: beforeUrl !== afterUrl,
        navigatedTo: beforeUrl !== afterUrl ? afterUrl : null,
      });
      clicksPerformed++;
      // If clicking navigated away from the route, go back so remaining safe
      // buttons on this page can still be tested.
      if (beforeUrl !== afterUrl) {
        await page.goto(`${BASE_URL}${routePath}`, GOTO_OPTS).catch(() => {});
        await page.waitForTimeout(1200);
      }
    } catch (e) {
      log.push({ index: c.i, text: label, action: 'CLICK_FAILED', reason: String(e.message || e).slice(0, 200) });
      // Recover: navigate back to the route so the page is in a known state.
      await page.goto(`${BASE_URL}${routePath}`, GOTO_OPTS).catch(() => {});
      await page.waitForTimeout(800);
    }
  }
  return log;
}

async function hasVisibleContent(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main, #root > div, [data-testid="app-content"], .app-content');
    const bodyText = document.body ? document.body.innerText.replace(/\s+/g, ' ').trim() : '';
    const meaningful = bodyText.length > 40;
    const hasEmptyState = /no data|empty|nothing here|not found|404/i.test(bodyText);
    const hasError = /something went wrong|uncaught|error boundary|react error/i.test(bodyText);
    return { bodyTextLength: bodyText.length, meaningful, hasEmptyState, hasError };
  });
}

const ROUTE_TIMEOUT_MS = 45000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout after ${ms}ms (${label})`)), ms)),
  ]);
}

const GOTO_OPTS = { waitUntil: 'domcontentloaded', timeout: 20000 };

async function main() {
  await rm(REPORT_DIR, { recursive: true, force: true });
  await mkdir(REPORT_DIR, { recursive: true });

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.setDefaultNavigationTimeout(15000);

  const pageConsoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') pageConsoleErrors.push({ type: m.type(), text: m.text() }); });
  page.on('pageerror', (e) => pageConsoleErrors.push({ type: 'pageerror', text: e.message }));

  // Initial login so the session cookie is set for protected routes.
  await safeLogin(page);

  const activeRoutes = ROUTE_FILTER ? ROUTES.filter((r) => ROUTE_FILTER.includes(r.label)) : ROUTES;
  for (const route of activeRoutes) {
    const folder = join(REPORT_DIR, route.label);
    await mkdir(folder, { recursive: true });
    pageConsoleErrors.length = 0;

    let loaded = false;
    let contentInfo = { bodyTextLength: 0, meaningful: false, hasEmptyState: false, hasError: false };
    let buttons = [];
    let clickLog = [];
    let loadError = null;

    try {
      trace(`ROUTE_START ${route.label} ${route.path}`);
      const resp = await withTimeout(page.goto(`${BASE_URL}${route.path}`, GOTO_OPTS), ROUTE_TIMEOUT_MS, 'goto');
      loaded = resp ? (resp.ok() || resp.status() === 200) : false;
      trace(`ROUTE_GOTO_DONE ${route.label} url=${page.url()}`);
      // After navigation, ensure auth still present for protected routes.
      const finalUrl = page.url();
      if ((finalUrl.endsWith('/login') || finalUrl.endsWith('/login/')) && !route.public) {
        await safeLogin(page);
        const r2 = await withTimeout(page.goto(`${BASE_URL}${route.path}`, GOTO_OPTS), ROUTE_TIMEOUT_MS, 'goto2');
        loaded = r2 ? (r2.ok() || r2.status() === 200) : loaded;
      }
      await page.waitForTimeout(2000);
      contentInfo = await withTimeout(hasVisibleContent(page), ROUTE_TIMEOUT_MS, 'content');
      trace(`ROUTE_CONTENT ${route.label} len=${contentInfo.bodyTextLength} meaningful=${contentInfo.meaningful}`);
      buttons = await withTimeout(inventoryButtons(page), ROUTE_TIMEOUT_MS, 'inventory');
      trace(`ROUTE_INVENTORY ${route.label} count=${buttons.length}`);
      clickLog = await withTimeout(runSafeClicks(page, route.path), ROUTE_TIMEOUT_MS, 'clicks');
      trace(`ROUTE_CLICKS_DONE ${route.label} clicked=${clickLog.filter((c) => c.action === 'CLICKED').length} failed=${clickLog.filter((c) => c.action === 'CLICK_FAILED').length}`);
      await page.waitForTimeout(300);
      await withTimeout(page.screenshot({ path: join(folder, 'screenshot.png'), fullPage: false }), ROUTE_TIMEOUT_MS, 'screenshot');
      trace(`ROUTE_SCREENSHOT_DONE ${route.label}`);
    } catch (e) {
      loadError = String(e.message || e).slice(0, 300);
      loaded = false;
    }

    await writeFile(join(folder, 'console-errors.json'), JSON.stringify(pageConsoleErrors, null, 2));
    await writeFile(join(folder, 'buttons-inventory.json'), JSON.stringify(buttons, null, 2));
    await writeFile(join(folder, 'safe-clicks-log.json'), JSON.stringify(clickLog, null, 2));

    summary.push({
      route: route.path,
      label: route.label,
      loaded,
      statusOnLoad: loadError ? `ERROR: ${loadError}` : (page.url()),
      hasVisibleContent: contentInfo.meaningful,
      bodyTextLength: contentInfo.bodyTextLength,
      hasErrorBoundary: contentInfo.hasError,
      hasEmptyState: contentInfo.hasEmptyState,
      buttonCount: buttons.length,
      consoleErrorCount: pageConsoleErrors.length,
      clickFailedCount: clickLog.filter((c) => c.action === 'CLICK_FAILED').length,
      destructiveButtonsFound: buttons.filter((b) => isDestructive(b.text)).length,
    });

    console.log(`[${route.label}] loaded=${loaded} visible=${contentInfo.meaningful} consoleErrors=${pageConsoleErrors.length} buttons=${buttons.length}`);
    // Flush summary incrementally so partial progress is preserved.
    await writeFile(join(REPORT_DIR, 'SUMMARY.json'), JSON.stringify(summary, null, 2));
  }

  await browser.close();

  const sortedSummary = summary.sort((a, b) => {
    if (a.loaded !== b.loaded) return a.loaded ? 1 : -1;
    if (a.hasVisibleContent !== b.hasVisibleContent) return a.hasVisibleContent ? 1 : -1;
    return b.consoleErrorCount - a.consoleErrorCount;
  });
  await writeFile(join(REPORT_DIR, 'SUMMARY.json'), JSON.stringify(sortedSummary, null, 2));

  const failed = summary.filter((s) => !s.loaded || !s.hasVisibleContent);
  const withErrors = summary.filter((s) => s.consoleErrorCount > 0);
  const withClicks = summary.filter((s) => s.clickFailedCount > 0);
  console.log('\n=== QA SMOKE TEST SUMMARY ===');
  console.log(`Total routes: ${summary.length}`);
  console.log(`Failed/blank: ${failed.length}`);
  console.log(`With console errors: ${withErrors.length}`);
  console.log(`With CLICK_FAILED: ${withClicks.length}`);
  if (failed.length) {
    console.log('\nFailed/blank routes:');
    for (const f of failed) console.log(`  - ${f.route} (loaded=${f.loaded}, visible=${f.hasVisibleContent}) ${f.statusOnLoad}`);
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
