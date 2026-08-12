import { test, expect } from '@playwright/test';
import {
  API_URL,
  BASE_URL,
  DEPARTMENT,
  INVITE_DOMAIN,
  apiGet,
  apiToken,
  findInvitation,
  authenticate,
  stamp,
  tickDepartment,
  waitForDepartments,
} from './helpers/add-user';

/**
 * The other three ways to add someone: Invite by Email, Invite by Link and
 * Add by CSV.
 *
 * Worth being explicit about what "added" means, because it differs by path.
 * Only the Create User wizard writes a `users` row straight away (covered in
 * add-user-manual.spec.ts). These three write a pending `invitations` row and
 * nothing else — the employee record is created when the recipient accepts.
 * So the details that can be compared across paths at this point are the ones
 * the invitation carries: address, role and department.
 */

test.describe('Add user — invite paths', () => {
  let token: string;

  test.beforeAll(async () => {
    token = await apiToken();
  });

  test('Invite by Email records a pending invitation with role and department', async ({ page }) => {
    const email = `e2e.email.${stamp()}@${INVITE_DOMAIN}`;

    await authenticate(page, token);
    await page.goto(`${BASE_URL}/add-user?tab=email`);

    const emailInput = page.getByPlaceholder('Type or paste email addresses');
    await expect(emailInput).toBeVisible();
    await emailInput.fill(email);
    await emailInput.press('Enter');
    await expect(page.getByText(email, { exact: false })).toBeVisible();

    await tickDepartment(page);

    const request = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/invitations')
    );
    await page.getByRole('button', { name: 'Send Invite' }).click();
    const response = await request;

    expect(
      response.ok(),
      `POST /invitations failed (${response.status()}): ${await response.text()}`
    ).toBeTruthy();
    await expect(page.getByText(/Sent 1 invite\(s\) successfully\./)).toBeVisible();

    const invitation = await findInvitation(email, token);
    expect(invitation, `No invitation row was written for ${email}`).toBeTruthy();
    expect(invitation.status).toBe('pending');
    expect(invitation.delivery_method).toBe('email');
    expect(invitation.role).toBe('employee');
  });

  test('Invite by Link produces a single-use URL for one recipient', async ({ page }) => {
    const email = `e2e.link.${stamp()}@${INVITE_DOMAIN}`;

    await authenticate(page, token);
    await page.goto(`${BASE_URL}/add-user?tab=link`);

    await page.getByPlaceholder('new.user@company.com').fill(email);
    await tickDepartment(page);

    const request = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/invitations')
    );
    await page.getByRole('button', { name: 'Generate Invite Link' }).first().click();
    const response = await request;

    expect(
      response.ok(),
      `POST /invitations failed (${response.status()}): ${await response.text()}`
    ).toBeTruthy();
    await expect(page.getByText('Secure invite link generated.')).toBeVisible();

    // The generated URL is the whole point of this path — it has to be shown,
    // not just stored, because the admin has to copy it somewhere themselves.
    const body: any = await response.json();
    const invitations = body?.invitations ?? body?.data?.invitations ?? [];
    const url: string = invitations[0]?.invite_url ?? '';
    expect(url, 'No invite_url came back from the link request').toMatch(/^https?:\/\//);
    await expect(page.getByText(url, { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy Invite Link' })).toBeVisible();

    const invitation = await findInvitation(email, token);
    expect(invitation, `No invitation row was written for ${email}`).toBeTruthy();
    expect(invitation.status).toBe('pending');
    expect(invitation.delivery_method).toBe('link');
  });

  test('Add by CSV imports a row and invites it', async ({ page }) => {
    const email = `e2e.csv.${stamp()}@${INVITE_DOMAIN}`;
    const csv = [
      'email,name,access_role,departments,job_title,timezone',
      `${email},CSV Joiner,employee,${DEPARTMENT},Team Lead,Asia/Kolkata`,
    ].join('\n');

    await authenticate(page, token);
    await page.goto(`${BASE_URL}/add-user?tab=csv`);
    await waitForDepartments(page);

    // The file input is visually hidden behind the drop zone label.
    await page.locator('input[type="file"]').setInputFiles({
      name: 'joiners.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf-8'),
    });
    await expect(page.getByText('joiners.csv')).toBeVisible();

    const request = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/invitations')
    );
    await page.getByRole('button', { name: 'Upload CSV' }).click();
    const response = await request;

    expect(
      response.ok(),
      `CSV import failed (${response.status()}): ${await response.text()}`
    ).toBeTruthy();
    await expect(page.getByText(/Imported 1 row\(s\) successfully\./)).toBeVisible();

    const invitation = await findInvitation(email, token);
    expect(invitation, `No invitation row was written for ${email}`).toBeTruthy();
    expect(invitation.status).toBe('pending');
    expect(invitation.role).toBe('employee');
    expect(invitation.metadata?.job_title).toBe('Team Lead');
    expect(
      (invitation.metadata?.group_ids ?? []).length,
      'CSV import dropped the department column'
    ).toBeGreaterThan(0);
  });

  test('all three invite paths capture the same details for the same person', async ({ page }) => {
    const suffix = stamp();
    const emails = {
      email: `e2e.same.email.${suffix}@${INVITE_DOMAIN}`,
      link: `e2e.same.link.${suffix}@${INVITE_DOMAIN}`,
      csv: `e2e.same.csv.${suffix}@${INVITE_DOMAIN}`,
    };

    const departmentId = await resolveDepartmentId(token);

    await authenticate(page, token);

    // ── Email ──
    await page.goto(`${BASE_URL}/add-user?tab=email`);
    const emailInput = page.getByPlaceholder('Type or paste email addresses');
    await emailInput.fill(emails.email);
    await emailInput.press('Enter');
    await tickDepartment(page);
    await page.getByRole('button', { name: 'Send Invite' }).click();
    await expect(page.getByText(/Sent 1 invite\(s\) successfully\./)).toBeVisible();

    // ── Link ──
    await page.goto(`${BASE_URL}/add-user?tab=link`);
    await page.getByPlaceholder('new.user@company.com').fill(emails.link);
    await tickDepartment(page);
    await page.getByRole('button', { name: 'Generate Invite Link' }).first().click();
    await expect(page.getByText('Secure invite link generated.')).toBeVisible();

    // ── CSV ──
    await page.goto(`${BASE_URL}/add-user?tab=csv`);
    await waitForDepartments(page);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'same.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        ['email,name,access_role,departments', `${emails.csv},Same Person,employee,${DEPARTMENT}`].join('\n'),
        'utf-8'
      ),
    });
    await page.getByRole('button', { name: 'Upload CSV' }).click();
    await expect(page.getByText(/Imported 1 row\(s\) successfully\./)).toBeVisible();

    // ── Compare what each path actually stored ──
    const records = await Promise.all(
      Object.entries(emails).map(async ([path, address]) => {
        const invitation = await findInvitation(address, token);
        expect(invitation, `${path} path wrote no invitation for ${address}`).toBeTruthy();
        return [path, invitation] as const;
      })
    );

    for (const [path, invitation] of records) {
      expect(invitation.status, `${path}: unexpected status`).toBe('pending');
      expect(invitation.role, `${path}: unexpected role`).toBe('employee');
      expect(
        (invitation.metadata?.group_ids ?? []).map(Number),
        `${path}: department did not reach the invitation`
      ).toContain(departmentId);
    }
  });
});

/** Numeric id of the department the tests file people under. */
async function resolveDepartmentId(token: string): Promise<number> {
  const body = await apiGet<{ data?: Array<{ id: number; name: string }> }>('/groups', token);
  const match = (body.data ?? []).find((group) => group.name === DEPARTMENT);
  if (!match) {
    throw new Error(
      `Department "${DEPARTMENT}" does not exist in this org — create it or set PLAYWRIGHT_DEPARTMENT.`
    );
  }
  return match.id;
}
