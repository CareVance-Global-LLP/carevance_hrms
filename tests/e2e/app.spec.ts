import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test.describe('Public Pages', () => {
  test('landing page loads with navigation and CTAs', async ({ page }) => {
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('nav').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('link', { name: /login/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /pricing/i }).first()).toBeVisible();
  });

  test('login page has email, password, and submit button', async ({ page }) => {
    await page.goto('http://localhost:5173/login');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('form button[type="submit"]')).toBeVisible();
  });

  test('pricing page renders a heading', async ({ page }) => {
    await page.goto('http://localhost:5173/pricing');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Authenticated App', () => {
  test.use({ storageState: 'playwright/.auth/user.json' });

  test('dashboard loads with sidebar', async ({ page }) => {
    await page.goto('http://localhost:5173/dashboard');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /dashboard/i }).or(page.getByRole('heading', { name: /super admin/i })).first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator('nav').first()).toBeVisible({ timeout: 20000 });
  });

  test('settings page loads', async ({ page }) => {
    await page.goto('http://localhost:5173/settings');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /settings/i }).first()).toBeVisible({ timeout: 20000 });
  });

  test('/attendance renders', async ({ page }) => {
    await page.goto('http://localhost:5173/attendance');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /attendance/i }).or(page.getByRole('heading', { name: /attendance/i, level: 2 })).first()).toBeVisible({ timeout: 30000 });
  });

  test('/employees renders', async ({ page }) => {
    await page.goto('http://localhost:5173/employees');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /employee/i }).or(page.getByRole('heading', { name: /employee/i, level: 2 })).first()).toBeVisible({ timeout: 30000 });
  });

  test('/projects renders', async ({ page }) => {
    await page.goto('http://localhost:5173/projects');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /projects/i }).or(page.getByRole('heading', { name: /projects/i, level: 2 })).first()).toBeVisible({ timeout: 30000 });
  });

  test('/tasks renders', async ({ page }) => {
    await page.goto('http://localhost:5173/tasks');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /tasks/i }).first()).toBeVisible({ timeout: 30000 });
  });

  test('/reports renders', async ({ page }) => {
    await page.goto('http://localhost:5173/reports');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /reports/i }).or(page.getByRole('heading', { name: /reports/i, level: 2 })).first()).toBeVisible({ timeout: 30000 });
  });
});

test.describe('Payroll', () => {
  test.use({ storageState: 'playwright/.auth/user.json' });

  test('payroll run page loads with heading', async ({ page }) => {
    await page.goto('http://localhost:5173/payroll/run');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /run payroll/i }).first()).toBeVisible({ timeout: 30000 });
  });

  test('payroll dashboard loads with stats', async ({ page }) => {
    await page.goto('http://localhost:5173/payroll');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 30000 });
  });

  test('my payroll page loads with payslip table', async ({ page }) => {
    await page.goto('http://localhost:5173/my-payroll');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /my payroll/i }).first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator('table').first()).toBeVisible({ timeout: 15000 });
  });

  test('payroll calculate endpoint returns tax breakdown', async ({ page }) => {
    await page.goto('http://localhost:5173/my-payroll');
    await page.waitForLoadState('networkidle');
    const result = await page.evaluate(async () => {
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      const response = await fetch('http://localhost:8000/api/payroll/calculate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          user_id: 1,
          annual_ctc: 600000,
          state: 'maharashtra',
          tax_regime: 'new',
          is_metro_city: true,
        }),
      });
      return { ok: response.ok, status: response.status, body: await response.json() };
    });
    expect(result.ok).toBeTruthy();
    expect(result.body.success).toBe(true);
    expect(result.body.calculation).toBeDefined();
    expect(result.body.calculation.monthly).toBeDefined();
    expect(result.body.calculation.components).toBeDefined();
    expect(result.body.calculation.components.deductions).toBeDefined();
    expect(result.body.calculation.components.deductions.tds).toBeGreaterThanOrEqual(0);
    expect(result.body.calculation.components.deductions.pf_employee).toBeGreaterThanOrEqual(0);
    expect(result.body.calculation.components.deductions.esi_employee).toBeGreaterThanOrEqual(0);
    expect(result.body.calculation.components.deductions.pt).toBeGreaterThanOrEqual(0);
    expect(result.body.calculation.monthly.net).toBeGreaterThan(0);
  });

  test('payroll pt-states endpoint returns states', async ({ page }) => {
    await page.goto('http://localhost:5173/my-payroll');
    await page.waitForLoadState('networkidle');
    const result = await page.evaluate(async () => {
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      const response = await fetch('http://localhost:8000/api/payroll/pt-states', {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      return { ok: response.ok, status: response.status, body: await response.json() };
    });
    expect(result.ok).toBeTruthy();
    expect(result.body.all_states).toBeDefined();
    expect(Array.isArray(result.body.all_states)).toBe(true);
    expect(result.body.all_states.length).toBeGreaterThan(0);
  });

  test('payroll runs endpoint is accessible', async ({ page }) => {
    await page.goto('http://localhost:5173/my-payroll');
    await page.waitForLoadState('networkidle');
    const result = await page.evaluate(async () => {
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      const response = await fetch('http://localhost:8000/api/payroll/runs', {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      return { ok: response.ok, status: response.status, body: await response.json() };
    });
    expect(result.ok).toBeTruthy();
    expect(result.body.runs).toBeDefined();
    expect(Array.isArray(result.body.runs)).toBe(true);
  });

  test('payroll departments endpoint is accessible', async ({ page }) => {
    await page.goto('http://localhost:5173/my-payroll');
    await page.waitForLoadState('networkidle');
    const result = await page.evaluate(async () => {
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      const response = await fetch('http://localhost:8000/api/payroll/departments', {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      return { ok: response.ok, status: response.status, body: await response.json() };
    });
    expect(result.ok).toBeTruthy();
    expect(result.body.departments).toBeDefined();
    expect(Array.isArray(result.body.departments)).toBe(true);
  });
});
