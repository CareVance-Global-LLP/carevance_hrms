import { test as base, expect, type Page } from '@playwright/test';

const ADMIN_EMAIL = process.env.PLAYWRIGHT_ADMIN_EMAIL || 'irbaz@test.com';
const ADMIN_PASSWORD = process.env.PLAYWRIGHT_ADMIN_PASSWORD || '12345678';
const API_URL = process.env.PLAYWRIGHT_API_URL || 'http://localhost:8000/api';

const IGNORED_CONSOLE_ERRORS = [
  'Failed to load resource: the server responded with a status of 401 (Unauthorized)',
  'Failed to load resource: the server responded with a status of 403 ()',
  '[GSI_LOGGER]: The given origin is not allowed for the given client ID.',
];

let cachedToken: string | null = null;
let cachedUser: any = null;

async function apiLogin(): Promise<{ token: string; user: any }> {
  if (cachedToken && cachedUser) {
    return { token: cachedToken, user: cachedUser };
  }

  const response = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });

  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(`Login failed: ${JSON.stringify(json)}`);
  }

  cachedToken = json.token;
  cachedUser = json.user;
  return { token: cachedToken, user: cachedUser };
}

async function ensureLoggedIn(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!IGNORED_CONSOLE_ERRORS.some((ignored) => text.includes(ignored))) {
        errors.push(text);
      }
    }
  });
  page.on('pageerror', (err) => errors.push(err.message));

  const { token, user } = await apiLogin();

  await page.addInitScript(([loginToken, loginUser]) => {
    try {
      window.sessionStorage.setItem('token', loginToken);
      window.sessionStorage.setItem('user', JSON.stringify(loginUser));
    } catch {
      // ignore storage errors in restricted contexts
    }
  }, [token, user]);

  await page.goto('/payroll');
  await page.waitForLoadState('networkidle');

  return errors;
}

export const test = base.extend<{ payrollPage: Page }>({
  payrollPage: async ({ page }, use) => {
    const errors = await ensureLoggedIn(page);
    await use(page);
    expect(errors, `Console errors found: ${JSON.stringify(errors, null, 2)}`).toEqual([]);
  },
});

export { expect };

test.describe('Payroll Smoke Test', () => {
  test('payroll overview loads without console errors', async ({ payrollPage }) => {
    await expect(payrollPage).toHaveURL(/\/payroll/);
    await expect(payrollPage.getByRole('heading', { name: 'Payroll' })).toBeVisible();
  });

  test('run payroll tab is reachable', async ({ payrollPage }) => {
    await payrollPage.goto('/payroll/run');
    await payrollPage.waitForLoadState('networkidle');

    await expect(payrollPage.getByRole('heading', { name: 'Run Payroll' })).toBeVisible();
  });

  test('no console errors on payroll overview', async ({ payrollPage }) => {
    await payrollPage.goto('/payroll');
    await payrollPage.waitForLoadState('networkidle');

    await payrollPage.waitForTimeout(2000);
  });

  test('payroll page loads with no obvious JS crash', async ({ payrollPage }) => {
    await payrollPage.goto('/payroll/run');
    await payrollPage.waitForLoadState('networkidle');

    await expect(payrollPage.getByRole('heading', { name: 'Run Payroll' })).toBeVisible();

    const pageErrors: string[] = [];
    payrollPage.on('pageerror', (err) => pageErrors.push(err.message));

    await payrollPage.waitForTimeout(1000);

    expect(pageErrors, `Page errors found: ${JSON.stringify(pageErrors, null, 2)}`).toEqual([]);
  });

  test('payroll overview renders expected sections', async ({ payrollPage }) => {
    await payrollPage.goto('/payroll');
    await payrollPage.waitForLoadState('networkidle');

    await expect(payrollPage.getByRole('heading', { name: 'Payroll' })).toBeVisible();
    await expect(payrollPage.getByText('Run payroll, manage compensation, tax & compliance from one place')).toBeVisible();

    const tabs = ['Overview', 'Run Payroll', 'Employee Pay', 'Tax & Compliance', 'Reports'];
    const payrollNav = payrollPage.getByLabel('Payroll sections');
    for (const tab of tabs) {
      await expect(payrollNav.getByRole('link', { name: tab })).toBeVisible();
    }
  });
});
