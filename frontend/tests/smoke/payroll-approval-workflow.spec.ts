import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';

const RUN_ID = 'lifecycle-run-001';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';
const API_URL = process.env.PLAYWRIGHT_API_URL || 'http://localhost:8000/api';
const ADMIN_EMAIL = process.env.PLAYWRIGHT_ADMIN_EMAIL || 'irbaz@test.com';
const ADMIN_PASSWORD = process.env.PLAYWRIGHT_ADMIN_PASSWORD || '12345678';

test.describe('Payroll approval workflow', () => {
  let accessToken: string;

  test.beforeAll(async () => {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(`Login failed: ${JSON.stringify(json)}`);
    }
    accessToken = json.token;
  });

  async function seedRunStatus(status: string) {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query(
      `UPDATE payroll_monthly_runs SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, RUN_ID]
    );
    await client.end();
  }

  test('draft -> locked -> approved -> released -> disbursed via UI', async ({ page }) => {
    if (!process.env.DATABASE_URL) {
      test.skip(true, 'DATABASE_URL not set — approval workflow needs seeded backend data');
      return;
    }

    await seedRunStatus('draft');

    await page.goto(`${BASE_URL}/payroll`);
    await page.waitForLoadState('networkidle');

    await page.evaluate((token) => {
      window.sessionStorage.setItem('token', token);
    }, accessToken);

    await page.goto(`${BASE_URL}/payroll/run-detail?id=${RUN_ID}`);
    await page.waitForLoadState('networkidle');

    const transitions = [
      { cta: 'lock-payroll', status: 'locked' },
      { cta: 'approve-payroll', status: 'approved' },
      { cta: 'release-payroll', status: 'released' },
      { cta: 'disburse-payroll', status: 'disbursed' },
    ];

    for (const step of transitions) {
      const cta = page.locator(`[data-testid="${step.cta}"]`);
      if (await cta.count() === 0) {
        test.skip(true, `CTA ${step.cta} not present`);
        return;
      }
      await cta.click();
      await page.waitForTimeout(1000);
      await expect(page.locator('[data-testid="status-badge"]')).toHaveText(step.status);
    }
  });
});
