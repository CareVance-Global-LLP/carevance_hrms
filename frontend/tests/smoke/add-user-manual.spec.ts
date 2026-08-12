import { test, expect } from '@playwright/test';
import {
  API_URL,
  BASE_URL,
  DEPARTMENT,
  INVITE_DOMAIN,
  VALID_AADHAAR,
  VALID_PAN,
  apiGet,
  apiToken,
  authenticate,
  pickOption,
  stamp,
  todayLocal,
} from './helpers/add-user';

/**
 * Manual "Create User" wizard, end to end.
 *
 * Covers the path an admin actually takes: /add-user → Create User tab →
 * basic info (with an employee code typed at creation time) → account created
 * → profile step, where the government IDs and bank account are entered →
 * Complete, which is also what fires the invitation email.
 *
 * Everything is then re-read from the API rather than from the screen the
 * wizard just rendered, because the wizard holds its own form state — asserting
 * against it would pass even if nothing reached the database.
 *
 * This is the only one of the four add paths that creates a `users` row on the
 * spot; the three invite paths are in add-user-paths.spec.ts.
 */

test.describe('Add user manually', () => {
  let token: string;

  test.beforeAll(async () => {
    token = await apiToken();
  });

  test('creates a BDE Team Lead with employee code, IDs and bank, then invites them', async ({ page }) => {
    const suffix = stamp();
    const employeeCode = `E2E-${suffix.toUpperCase()}`;
    const firstName = 'Aarav';
    const lastName = `Testerson${suffix}`;
    const email = `e2e.${suffix}@${INVITE_DOMAIN}`;
    const accountNumber = `9${suffix.replace(/\D/g, '').padEnd(10, '0').slice(0, 10)}`;
    const ifsc = 'SBIN0001234';

    await authenticate(page, token);
    await page.goto(`${BASE_URL}/add-user?tab=custom`);

    // ── Step 1: basic info ────────────────────────────────────
    await page.locator('input[placeholder="John"]').fill(firstName);
    await page.locator('input[placeholder="Doe"]').fill(lastName);
    await page.locator('input[placeholder="john@company.com"]').fill(email);
    await page.locator('input[placeholder="+91 98765 43210"]').fill('+91 98765 43210');

    // "Team Lead" is a designation, not one of the three account roles the
    // wizard offers (employee/manager/admin) — role is left at its default.
    await page.locator('input[placeholder="e.g., Software Engineer"]').fill('Team Lead');

    // The code is optional in the form. Typing it here is the point of the
    // test: it has to survive creation and land on the work-info record.
    await page.locator('input[placeholder="e.g., EMP-001"]').fill(employeeCode);

    const deptChip = page.getByRole('button', { name: new RegExp(`^(✓\\s*)?${DEPARTMENT}$`) });
    await expect(
      deptChip,
      `Department "${DEPARTMENT}" is not offered on step 1 — create it under Settings → Groups first.`
    ).toBeVisible();
    await deptChip.click();
    await expect(deptChip).toHaveText(new RegExp(`^✓\\s*${DEPARTMENT}$`));

    await page.locator('input[type="date"]').fill(todayLocal());

    // ── Step 1 → 2 → 3. The user record is created on entering step 3. ──
    await page.getByRole('button', { name: 'Create Account' }).click();
    const continueButton = page.getByRole('button', { name: 'Continue' });
    await expect(continueButton).toBeVisible();

    const createResponse = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/api\/users(\?|$)/.test(r.url())
    );
    await continueButton.click();
    const created = await createResponse;
    expect(created.ok(), `POST /users failed: ${await created.text()}`).toBeTruthy();

    const createdBody: any = await created.json();
    const userId: number = createdBody?.id ?? createdBody?.data?.id;
    expect(userId, 'POST /users returned no user id').toBeTruthy();

    // ── Step 3: government IDs ────────────────────────────────
    const govSection = page.locator('section').filter({ hasText: 'Add New Government ID' }).last();
    await expect(govSection).toBeVisible({ timeout: 30_000 });

    const idTypeTrigger = govSection.locator('button[aria-haspopup="listbox"]').first();
    const idNumberInput = govSection.locator('input[placeholder="Enter ID number"]');
    const addIdButton = govSection.getByRole('button', { name: 'Add Government ID' });

    // Aadhaar is the default selection, so only the number is typed.
    await expect(idTypeTrigger).toContainText('Aadhaar');
    await idNumberInput.fill(VALID_AADHAAR);
    const aadhaarSaved = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/government-ids')
    );
    await addIdButton.click();
    expect((await aadhaarSaved).ok(), 'Saving the Aadhaar record failed').toBeTruthy();
    await expect(govSection).toContainText(VALID_AADHAAR);

    // Both proofs have to survive — a PAN must not displace the Aadhaar.
    await pickOption(page, idTypeTrigger, 'PAN');
    await idNumberInput.fill(VALID_PAN);
    const panSaved = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/government-ids')
    );
    await addIdButton.click();
    expect((await panSaved).ok(), 'Saving the PAN record failed').toBeTruthy();
    await expect(govSection).toContainText(VALID_PAN);
    await expect(govSection).toContainText(VALID_AADHAAR);

    // ── Step 3: bank account ──────────────────────────────────
    // Rendered only when the org is on a payroll plan and VITE_PAYROLL_ENABLED
    // is on; a missing section here means entitlement, not a broken form.
    const bankSection = page.locator('section').filter({ hasText: 'Add New Bank Account' }).last();
    await expect(
      bankSection,
      'Bank Account Details section is absent — org needs a payroll plan and VITE_PAYROLL_ENABLED=true.'
    ).toBeVisible();

    await bankSection.locator('input[placeholder="e.g., State Bank of India"]').fill('State Bank of India');
    await bankSection.locator('input[placeholder="Enter account number"]').fill(accountNumber);
    await bankSection.locator('input[placeholder="e.g., SBIN0001234"]').fill(ifsc);
    await bankSection.locator('input[placeholder="Branch name"]').fill('Hinjewadi');
    await pickOption(page, bankSection.locator('button[aria-haspopup="listbox"]').first(), 'Savings');

    const bankSaved = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/bank-accounts')
    );
    await bankSection.getByRole('button', { name: 'Add Bank Account' }).click();
    expect((await bankSaved).ok(), 'Saving the bank account failed').toBeTruthy();
    await expect(bankSection).toContainText(accountNumber);

    // ── Complete: this is what sends the invitation email ─────
    const inviteResponse = page.waitForResponse((r) => r.url().includes('/invites/send'));
    await page.getByRole('button', { name: 'Complete' }).click();
    const invite = await inviteResponse;

    const invitePayload = JSON.parse(invite.request().postData() || '{}');
    expect(invitePayload.email, 'Invite was sent to the wrong address').toBe(email);
    expect(invitePayload.employee_code).toBe(employeeCode);

    await expect(page.getByText('User Created Successfully!')).toBeVisible();
    // Shown twice on the completion screen: in the summary line and in the
    // employee details block underneath it.
    await expect(page.getByText(employeeCode, { exact: false }).first()).toBeVisible();

    if (invite.ok()) {
      await expect(page.getByText(`Invitation email sent to ${email}`)).toBeVisible();
    } else {
      // Transport failed (no SMTP creds, unroutable domain). The invite row is
      // still written; the UI has to offer a retry rather than swallow it.
      test.info().annotations.push({
        type: 'warning',
        description: `POST /invites/send returned ${invite.status()} — mail transport unavailable.`,
      });
      await expect(page.getByRole('button', { name: 'Resend Invitation' })).toBeVisible();
    }

    // ── Verify against the API, not the wizard's own state ────
    const workspace: any = await apiGet(`/employees/${userId}/workspace`, token);

    expect(workspace.work_info?.employee_code).toBe(employeeCode);
    expect(workspace.work_info?.designation).toBe('Team Lead');
    expect(workspace.employee?.email).toBe(email);
    expect(workspace.employee?.name).toBe(`${firstName} ${lastName}`);

    const departmentNames = (workspace.employee?.groups ?? []).map((g: any) => g.name);
    expect(departmentNames, `Departments on the saved user: ${departmentNames.join(', ')}`)
      .toContain(DEPARTMENT);

    const govNumbers = (workspace.government_ids ?? []).map((g: any) => String(g.id_number));
    expect(govNumbers).toContain(VALID_AADHAAR);
    expect(govNumbers).toContain(VALID_PAN);

    const savedBank = (workspace.bank_accounts ?? []).find(
      (b: any) => String(b.account_number) === accountNumber
    );
    expect(savedBank, 'Bank account is missing from the employee record').toBeTruthy();
    expect(String(savedBank.ifsc_swift).toUpperCase()).toBe(ifsc);

    // ── And that the employee details screen renders it ───────
    await page.goto(`${BASE_URL}/employees/${encodeURIComponent(employeeCode)}`);
    await expect(page.getByText(employeeCode, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Team Lead', { exact: false }).first()).toBeVisible();
  });
});
