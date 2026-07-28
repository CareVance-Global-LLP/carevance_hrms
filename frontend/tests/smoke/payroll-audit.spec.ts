import { test, expect } from '@playwright/test';
import { Client } from 'pg';

const PROFILE_ID = 'a2-profile-001';

test.describe('PayrollProfile write-activity audit', () => {
  let db: Client;

  test.beforeAll(async () => {
    db = new Client({
      connectionString: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/payroll_test',
    });
    await db.connect();
  });

  test.afterAll(async () => {
    await db.end();
  });

  test('records an audit row when a profile field is updated via UI', async ({ page }) => {
    const before = await db.query(
      `SELECT COUNT(*) FROM payroll_profile_audit WHERE profile_id = $1`,
      [PROFILE_ID]
    );
    const countBefore = parseInt(before.rows[0].count, 10);

    await page.goto(`/payroll/profiles/${PROFILE_ID}/edit`);
    await page.fill('[data-testid="disbursement-method"]', 'bank_transfer');
    await page.click('[data-testid="save-profile"]');
    await expect(page.locator('[data-testid="save-success"]')).toBeVisible({ timeout: 8000 });

    await page.waitForTimeout(500);

    const after = await db.query(
      `SELECT action, changed_by FROM payroll_profile_audit
       WHERE profile_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [PROFILE_ID]
    );
    expect(after.rows).toHaveLength(1);
    const latest = after.rows[0];
    expect(latest.action).toBe('updated');
    expect(latest.changed_by).not.toBeNull();

    const countAfter = parseInt(
      (await db.query(`SELECT COUNT(*) FROM payroll_profile_audit WHERE profile_id = $1`, [PROFILE_ID])).rows[0]
        .count,
      10
    );
    expect(countAfter).toBe(countBefore + 1);
  });

  test('A3: released disbursement shows correct stuck-state UI warning', async ({ page }) => {
    await page.goto('/payroll/disbursements/a3-disb-001');
    await expect(page.locator('[data-testid="stuck-state-warning"]')).toBeVisible();
    await expect(page.locator('[data-testid="status-badge"]')).toHaveText('released');
  });
});
