import { test, expect, type Page, type Request } from '@playwright/test';

/**
 * E2E coverage for all four Add User routes.
 *
 * SCOPE LIMIT — read before adding cases here.
 *
 * These tests INTERCEPT the write call rather than letting it reach the API.
 * That is deliberate, for three reasons:
 *
 *   - "Invite by Email" queues real invitation mail. A suite that runs on every
 *     change must not send mail to whatever address the fixture happens to use.
 *   - The others create real users and invitations in the dev database. Run the
 *     suite twice and the second run fails on "already invited", which makes
 *     the test a liability rather than a signal.
 *   - What the browser actually owns is the request: that each tab is
 *     reachable, that the form assembles the right body, and that the response
 *     is rendered. Whether the SERVER then does the right thing with that body
 *     is asserted directly, and far more cheaply, in
 *     backend/tests/Feature/InvitationEmployeeCodeTest.php — including employee
 *     code uniqueness, the derivation of a base role from a custom role's
 *     hierarchy level, and cross-tenant role rejection.
 *
 * So: this file proves the four paths are wired. It does not prove the backend
 * honours them, and it should not be extended to try.
 *
 * The one thing worth stating about the payload assertions: they exist because
 * the employee code and the custom role are BOTH easy to drop silently. A form
 * that renders the field but never sends it looks completely correct in a
 * screenshot, and the failure only surfaces weeks later as "why does nobody
 * have an employee code".
 */

const BASE = 'http://localhost:5173';

const INVITE_ENDPOINT = '**/api/invitations';
const IMPORT_ENDPOINT = '**/api/invitations/import';
const USERS_ENDPOINT = '**/api/users';

/** Unique per run, so a fixture can never collide with real data. */
const stamp = () => Date.now().toString().slice(-8);

/**
 * Fulfil the next call to `pattern` with `body`, and hand back the request that
 * was captured.
 *
 * Returned as a promise rather than asserted inline so a test reads in the
 * order things happen: arm the interceptor, drive the UI, then assert.
 */
function captureRequest(page: Page, pattern: string, body: unknown) {
  let resolve!: (request: Request) => void;
  const captured = new Promise<Request>((r) => { resolve = r; });

  page.route(pattern, async (route) => {
    resolve(route.request());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  return captured;
}

/**
 * Fulfil the next `count` calls to `pattern` and hand back every request.
 *
 * A batch whose recipients differ is deliberately more than one call —
 * StoreInvitationRequest carries a single role, department list, job title and
 * joining date — so a single-shot capture would assert half the send.
 */
function captureRequests(page: Page, pattern: string, count: number, body: unknown) {
  const requests: Request[] = [];
  let resolve!: (requests: Request[]) => void;
  const captured = new Promise<Request[]>((r) => { resolve = r; });

  page.route(pattern, async (route) => {
    requests.push(route.request());
    if (requests.length === count) {
      resolve(requests);
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  return captured;
}

const invitationSuccess = (email: string) => ({
  success: true,
  message: 'Invitation sent.',
  data: {
    created: [{ id: 9001, email, status: 'pending', invite_url: `${BASE}/invite/accept?token=e2e-token` }],
    failed: [],
    invite_url: `${BASE}/invite/accept?token=e2e-token`,
  },
});

/**
 * Open a tab directly. AddUserPage keeps the active tab in ?tab=, which is a
 * far steadier way in than clicking through the tab strip.
 */
async function openTab(page: Page, tab: 'custom' | 'email' | 'link' | 'csv') {
  await page.goto(`${BASE}/add-user?tab=${tab}`);
  await page.waitForLoadState('networkidle');
}

test.describe.configure({ mode: 'serial' });

test.describe('Add User — all four routes', () => {
  test.use({ storageState: 'playwright/.auth/user.json' });

  test('every route is offered and reachable by its own URL', async ({ page }) => {
    for (const [tab, heading] of [
      ['custom', /create user/i],
      ['email', /invite by email/i],
      ['link', /invite by link/i],
      ['csv', /add by csv/i],
    ] as const) {
      await openTab(page, tab);
      await expect(page.getByRole('button', { name: heading }).first()).toBeVisible();
    }
  });

  test('invite by email sends one employee code per recipient', async ({ page }) => {
    await openTab(page, 'email');

    const id = stamp();
    const first = `e2e.first.${id}@example.test`;
    const second = `e2e.second.${id}@example.test`;

    const input = page.getByPlaceholder(/type or paste email/i);
    await input.fill(first);
    await input.press('Enter');
    await input.fill(second);
    await input.press('Enter');

    // The code belongs to the person, so unlike every other field in this
    // drawer there is one input per recipient rather than one for the batch.
    await page.getByRole('textbox', { name: new RegExp(`employee code for ${first}`, 'i') }).fill('E2E-001');
    await page.getByRole('textbox', { name: new RegExp(`employee code for ${second}`, 'i') }).fill('E2E-002');

    const request = captureRequest(page, INVITE_ENDPOINT, invitationSuccess(first));
    await page.getByRole('button', { name: /send 2 invites/i }).click();

    const body = (await request).postDataJSON();

    expect(body.emails).toEqual(expect.arrayContaining([first, second]));
    expect(body.delivery).toBe('email');
    // Keyed by email, not positional — the association must survive the
    // chunking addUserService does when a batch is split by role.
    expect(body.employee_codes).toMatchObject({ [first]: 'E2E-001', [second]: 'E2E-002' });
  });

  test('invite by email gives each recipient their own job title in one send', async ({ page }) => {
    /*
     * The loop this closes: two joiners with different designations used to be
     * two separate trips through the form, because job title was one value for
     * the whole batch. Asserted through job title rather than department
     * because it needs no seeded data — the department select can only offer
     * what the dev database happens to hold.
     */
    await openTab(page, 'email');

    const id = stamp();
    const first = `e2e.mixed.a.${id}@example.test`;
    const second = `e2e.mixed.b.${id}@example.test`;

    const input = page.getByPlaceholder(/type or paste email/i);
    await input.fill(first);
    await input.press('Enter');
    await input.fill(second);
    await input.press('Enter');

    // The batch default, then one recipient overriding it.
    await page.getByRole('textbox', { name: /^job title$/i }).fill('Support Analyst');
    await page.getByRole('textbox', { name: new RegExp(`job title for ${second}`, 'i') }).fill('Team Lead');

    // Two distinct shapes means two requests, which is the transport detail the
    // table is there to keep out of the admin's way.
    const requests = captureRequests(page, INVITE_ENDPOINT, 2, invitationSuccess(first));
    await page.getByRole('button', { name: /send 2 invites/i }).click();

    const bodies = (await requests).map((request) => request.postDataJSON());

    expect(bodies).toHaveLength(2);
    expect(bodies).toEqual(expect.arrayContaining([
      expect.objectContaining({ emails: [first], job_title: 'Support Analyst' }),
      expect.objectContaining({ emails: [second], job_title: 'Team Lead' }),
    ]));
  });

  test('invite by link carries a single recipient and their code', async ({ page }) => {
    await openTab(page, 'link');

    const email = `e2e.link.${stamp()}@example.test`;

    await page.getByLabel(/recipient email/i).fill(email);
    await page.getByLabel(/employee code/i).fill('E2E-LINK-1');

    const request = captureRequest(page, INVITE_ENDPOINT, invitationSuccess(email));
    /*
     * Named exactly. The TAB button reads "Invite by Link Generate a single-use
     * secure onboarding link for one recipient", so a loose /generate/ matches
     * the tab first, clicks an already-active tab, and the test then waits out
     * its timeout on a request that was never going to be made.
     */
    await page.getByRole('button', { name: 'Generate Invite Link' }).first().click();

    const body = (await request).postDataJSON();

    expect(body.email).toBe(email);
    expect(body.delivery).toBe('link');
    // Scalar here, not the keyed map: a link is for exactly one person.
    expect(body.employee_code).toBe('E2E-LINK-1');
  });

  test('an admin-defined role is sent as role_id, not as a base role', async ({ page }) => {
    await openTab(page, 'link');

    /*
     * Skips rather than fails when the seed organisation has defined no custom
     * roles. An organisation with only the three built-ins is a supported
     * state, not a broken fixture — there is simply nothing to assert.
     */
    const customRole = page.locator('button', { hasText: /custom role|team lead|senior manager/i }).first();
    if (await customRole.count() === 0) {
      test.skip(true, 'Seed organisation has no admin-defined roles.');
    }

    const email = `e2e.role.${stamp()}@example.test`;
    await page.getByLabel(/recipient email/i).fill(email);
    await customRole.click();

    const request = captureRequest(page, INVITE_ENDPOINT, invitationSuccess(email));
    await page.getByRole('button', { name: 'Generate Invite Link' }).first().click();

    const body = (await request).postDataJSON();

    // The server derives the base role from the role's hierarchy level and
    // ignores whatever `role` says, so the only thing that must survive the
    // round trip from this control is the id.
    expect(body.role_id).toEqual(expect.any(Number));
  });

  test('CSV import parses in the browser and sends nothing until confirmed', async ({ page }) => {
    await openTab(page, 'csv');

    const id = stamp();
    const email = `e2e.csv.${id}@example.test`;
    const csv = [
      'email,name,access_role,employee_code,job_title,joining_date',
      `${email},CSV Person,employee,E2E-CSV-1,Support Analyst,2026-09-01`,
    ].join('\n');

    /*
     * Choosing a file used to parse AND invite in one action, so a wrong column
     * mapping in a 200-row sheet was discovered only after 200 people had been
     * emailed. Nothing may leave the browser before Send.
     */
    let sentEarly = false;
    await page.route(IMPORT_ENDPOINT, async (route) => {
      sentEarly = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.locator('input[type="file"]').setInputFiles({
      name: 'e2e-import.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf-8'),
    });

    // The preview proves the header mapping resolved: the code lands in its own
    // column rather than being swallowed into job title.
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByText('E2E-CSV-1')).toBeVisible();
    expect(sentEarly, 'choosing a file must not send the import').toBe(false);

    await page.unroute(IMPORT_ENDPOINT);
    const request = captureRequest(page, IMPORT_ENDPOINT, {
      success: true,
      data: { created: [{ id: 9002, email, status: 'pending' }], failed: [] },
    });

    // "Send 1 invite" -- the count is part of the label, so match the shape.
    await page.getByRole('button', { name: /^send \d+ invite/i }).click();

    const body = (await request).postDataJSON();

    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ email, employee_code: 'E2E-CSV-1' });
  });

  test('Create User posts to /users with the admin-set password', async ({ page }) => {
    await openTab(page, 'custom');

    const id = stamp();
    const email = `e2e.create.${id}@example.test`;

    await page.getByLabel(/first name/i).fill('E2E');
    await page.getByLabel(/last name/i).fill('Created');
    await page.getByLabel(/email address/i).fill(email);
    await page.getByLabel(/temporary password/i).fill('Password123!');
    await page.getByLabel(/phone number/i).fill('9876543210');
    await page.getByLabel(/designation/i).fill('Support Analyst');
    await page.getByLabel(/employee code/i).fill('E2E-NEW-1');
    await page.getByLabel(/date of joining/i).fill('2026-09-01');

    /*
     * Department is required and is a chip list, not a select — so it is
     * anchored off its own label rather than guessed by name, which varies per
     * organisation. Without it step 1 refuses to advance with "Select a
     * department" and the wizard never reaches the POST.
     */
    await page
      .locator('label')
      .filter({ hasText: /^Department/ })
      .locator('xpath=following-sibling::div[1]//button')
      .first()
      .click();

    const request = captureRequest(page, USERS_ENDPOINT, {
      id: 9003, name: 'E2E Created', email, role: 'employee', organization_id: 30,
    });

    /*
     * Two clicks, not one. Step 1 advances with "Continue"; the POST fires when
     * step 3 mounts, behind step 2's "Create Account". The labels deliberately
     * name what the click does, so the irreversible one says so -- and a test
     * that clicks /create/i on step 1 would match the "Create User" TAB button
     * instead and go nowhere.
     */
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Create Account' }).click();

    const body = (await request).postDataJSON();

    expect(body.email).toBe(email);
    /*
     * The password is the whole reason this route differs from the other three.
     * POST /users mints a random one when none is supplied AND sends no
     * verification mail, so a user created without it can never sign in —
     * UserController::store only sets email_verified_at when a password was
     * explicitly given.
     */
    expect(body.password).toBe('Password123!');
  });
});
