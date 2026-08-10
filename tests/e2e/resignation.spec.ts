import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const API_BASE = 'http://localhost:8000/api';
const EMPLOYEE_EMAIL = 'test1@gmail.com';
const EMPLOYEE_PASSWORD = '12345678';
const MANAGER_NAME = 'Ayush';

test.describe('Resignation Approval Routing', () => {
  test.use({ storageState: 'playwright/.auth/user.json' });

  test('employee resignation shows approval destination with reviewing manager name', async ({ page }) => {
    // Step 1: Log in as an employee via the API to get a token
    const loginResult = await page.evaluate(async () => {
      const resp = await fetch('http://localhost:8000/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          email: 'test1@gmail.com',
          password: '12345678',
        }),
      });
      return { ok: resp.ok, status: resp.status, body: await resp.json() };
    });

    expect(loginResult.ok).toBeTruthy();
    const employeeToken = loginResult.body.token;
    expect(employeeToken).toBeDefined();

    // Step 2: Cancel any existing pending resignation to start clean
    await page.evaluate(async (token) => {
      try {
        await fetch('http://localhost:8000/api/resignations/my', {
          method: 'DELETE',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
          },
        });
      } catch {
        // ignore - no pending resignation to cancel
      }
    }, employeeToken);

    // Step 3: Submit a resignation as the employee
    const lastWorkingDate = new Date();
    lastWorkingDate.setDate(lastWorkingDate.getDate() + 30);
    const formattedDate = lastWorkingDate.toISOString().split('T')[0];

    const submitResult = await page.evaluate(async (token, lwd) => {
      const resp = await fetch('http://localhost:8000/api/resignations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          last_working_date: lwd,
          reason: 'Better opportunity',
        }),
      });
      return { ok: resp.ok, status: resp.status, body: await resp.json() };
    }, employeeToken, formattedDate);

    expect(submitResult.ok).toBeTruthy();
    const submittedResignation = submitResult.body.resignation;
    expect(submittedResignation).toBeDefined();
    expect(submittedResignation.status).toBe('pending');

    // Step 4: Verify approval_destination shows the reviewing manager's name
    // (not the generic "Sent to reviewer" fallback, and not the super_admin)
    expect(submittedResignation.approval_destination).toBeDefined();
    expect(submittedResignation.approval_destination).not.toBe('Sent to reviewer');
    expect(submittedResignation.approval_destination).toMatch(/^Sent to .+$/);
    // The approval should go to the admin (manager), not the super_admin
    expect(submittedResignation.approval_destination).toContain(MANAGER_NAME);

    // Step 5: Verify current_reviewer_ids is populated with the manager's user ID
    expect(submittedResignation.current_reviewer_ids).toBeDefined();
    expect(Array.isArray(submittedResignation.current_reviewer_ids)).toBe(true);
    expect(submittedResignation.current_reviewer_ids.length).toBeGreaterThan(0);

    // Step 6: Verify getMyResignation returns the same approval_destination
    const myResignationResult = await page.evaluate(async (token) => {
      const resp = await fetch('http://localhost:8000/api/resignations/my', {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      return { ok: resp.ok, status: resp.status, body: await resp.json() };
    }, employeeToken);

    expect(myResignationResult.ok).toBeTruthy();
    const myResignation = myResignationResult.body.resignation;
    expect(myResignation).toBeDefined();
    expect(myResignation.status).toBe('pending');
    expect(myResignation.approval_destination).toBeDefined();
    expect(myResignation.approval_destination).not.toBe('Sent to reviewer');
    expect(myResignation.approval_destination).toContain(MANAGER_NAME);
    expect(myResignation.current_reviewer_ids).toBeDefined();
    expect(Array.isArray(myResignation.current_reviewer_ids)).toBe(true);
    expect(myResignation.current_reviewer_ids.length).toBeGreaterThan(0);

    // Step 7: Verify the admin (manager) can see the resignation with approval destination via list endpoint
    const adminToken = await page.evaluate(() => localStorage.getItem('token'));
    expect(adminToken).toBeTruthy();

    const listResult = await page.evaluate(async (token) => {
      const resp = await fetch('http://localhost:8000/api/resignations?status=pending', {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      return { ok: resp.ok, status: resp.status, body: await resp.json() };
    }, adminToken);

    expect(listResult.ok).toBeTruthy();
    const resignations = listResult.body.data || [];
    const ourResignation = resignations.find(
      (r: any) => r.approval_destination && r.approval_destination.includes(MANAGER_NAME)
    );
    expect(ourResignation).toBeDefined();
    expect(ourResignation.approval_destination).toContain(MANAGER_NAME);
    expect(ourResignation.current_reviewer_ids).toBeDefined();
    expect(Array.isArray(ourResignation.current_reviewer_ids)).toBe(true);
    expect(ourResignation.current_reviewer_ids.length).toBeGreaterThan(0);

    // Step 8: Verify the frontend ApprovalInbox page shows the approval destination
    await page.goto('http://localhost:5173/approval-inbox?section=resignation');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('text=Resignation', { timeout: 15000 });

    // Look for the approval destination text in the resignation cards
    const approvalDestinationVisible = await page.locator(`text=/Sent to.*${MANAGER_NAME}/`).first().isVisible().catch(() => false);
    expect(approvalDestinationVisible).toBeTruthy();

    // Cleanup: cancel the resignation we created
    await page.evaluate(async (token) => {
      try {
        await fetch('http://localhost:8000/api/resignations/my', {
          method: 'DELETE',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
          },
        });
      } catch {
        // ignore cleanup errors
      }
    }, employeeToken);
  });
});

