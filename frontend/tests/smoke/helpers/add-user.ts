import { expect, type Locator, type Page } from '@playwright/test';

export const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';
export const API_URL = process.env.PLAYWRIGHT_API_URL || 'http://localhost:8000/api';
export const ADMIN_EMAIL = process.env.PLAYWRIGHT_ADMIN_EMAIL || 'irbaz@test.com';
export const ADMIN_PASSWORD = process.env.PLAYWRIGHT_ADMIN_PASSWORD || 'Password@123';

/** Department to file the new joiner under. Must already exist in the org. */
export const DEPARTMENT = process.env.PLAYWRIGHT_DEPARTMENT || 'BDE';

/**
 * Recipient domain for the accounts these tests create.
 *
 * Invites go out over real SMTP (Brevo), synchronously, inside the request.
 * Run the backend with MAIL_MAILER=log unless you actually want mail leaving
 * the building — none of the assertions need a delivered message, only the
 * request the frontend made and the record the backend wrote.
 */
export const INVITE_DOMAIN = process.env.PLAYWRIGHT_INVITE_DOMAIN || 'carevance-e2e.test';

/** Valid under the Verhoeff checksum in IndianIdValidationService. */
export const VALID_AADHAAR = '234523452343';
export const VALID_PAN = 'ABCPE1234F';

export const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** `YYYY-MM-DD` from local parts — toISOString() lands a day early in IST. */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Put an already-issued token where the app looks for it, instead of driving
 * the login form once per test.
 *
 * `auth.login` is rate limited to 5 attempts per minute per email address, and
 * a suite of this size blows straight through that — the sixth test simply sits
 * on /login until it times out. The app keeps its token in sessionStorage,
 * which Playwright's storageState does not persist, so an init script is the
 * way to seed it. AuthContext's bootstrap calls /auth/me with whatever bearer
 * it finds and fills in the user and organization from the response.
 */
export async function authenticate(page: Page, token: string) {
  await page.addInitScript((value) => {
    window.sessionStorage.setItem('token', value);
    // The wizard restores half-finished runs for 24h, which would drop a fresh
    // test straight onto step 2 of a previous one.
    window.localStorage.removeItem('add-user-wizard-state');
  }, token);
}

/** Full login through the form. Kept for tests that exercise the login screen. */
export async function login(page: Page) {
  await page.goto(`${BASE_URL}/login`);
  await page.fill('[name="email"]', ADMIN_EMAIL);
  await page.fill('[name="password"]', ADMIN_PASSWORD);
  await page.click('[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 60_000 });
}

/** Bearer token for the out-of-band verification calls. */
export async function apiToken(): Promise<string> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const json: any = await res.json();
  if (!res.ok || !json.token) {
    throw new Error(`Admin API login failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json.token;
}

export async function apiGet<T = any>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`GET ${path} failed (${res.status}): ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Both CustomSelect and FormField's SelectInput render a button plus a
 * portalled `role="listbox"`, not a native <select> — selectOption() does
 * nothing on either. Click the trigger, then the option.
 */
export async function pickOption(page: Page, trigger: Locator, optionLabel: string) {
  await trigger.click();
  await page.getByRole('option', { name: optionLabel, exact: true }).click();
  await expect(trigger).toContainText(optionLabel);
}

/** The department picker shared by the Invite by Email and Invite by Link tabs. */
export async function tickDepartment(page: Page, name = DEPARTMENT) {
  const search = page.getByPlaceholder('Search departments');
  await expect(search).toBeVisible();
  await search.fill(name);
  const option = page.locator('label').filter({ hasText: name }).first();
  await option.locator('input[type="checkbox"]').check();
}

/** Latest pending invitation for an address, from the admin invitations list. */
export async function findInvitation(email: string, token: string) {
  const body = await apiGet<{ invitations?: any[]; data?: { invitations?: any[] } }>(
    '/invitations',
    token
  );
  const invitations = body.invitations ?? body.data?.invitations ?? [];
  return invitations.find(
    (invite: any) => String(invite.email).toLowerCase() === email.toLowerCase()
  );
}

/**
 * Wait for the department list the drawer loads on mount.
 *
 * The CSV path resolves department *names* to ids client-side against this
 * list, and the Upload button is enabled before it arrives — uploading too
 * early silently produces an invitation with no department.
 */
export async function waitForDepartments(page: Page) {
  await page.waitForResponse(
    (r) => r.url().includes('/report-groups') && r.status() === 200,
    { timeout: 30_000 }
  );
}
