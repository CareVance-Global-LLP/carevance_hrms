import { test, expect } from '@playwright/test';

/**
 * E2E coverage for the tracker remediation work.
 *
 * SCOPE LIMIT — read before adding idle/screenshot-capture tests here.
 *
 * Playwright drives a browser. The desktop tracker's idle detection and
 * screenshot capture both run through `window.desktopTracker`, the Electron
 * preload bridge, which does not exist in a browser context. OS idle time comes
 * from Electron's powerMonitor and capture from desktopCapturer. Neither can be
 * exercised here at all, so the idle accounting rule is covered where it is
 * actually reachable:
 *
 *   - backend/tests/Feature/IdleAutoStopDurationRuleTest.php   (the 55/5 rule, all 3 stop paths)
 *   - backend/tests/Feature/IdleAccountingScenarioTest.php     (the reported 2-min-work / 5-min-idle case)
 *   - frontend/src/hooks/useDesktopTracker.test.tsx            (client cadence + idle rows, bridge mocked)
 *
 * What IS testable end to end is everything the web app itself owns: the
 * screenshot gallery now fetching image bytes with an Authorization header, the
 * break flow, and the organization-level capture interval.
 */

const BASE = 'http://localhost:5173';

test.describe.configure({ mode: 'serial' });

test.describe('Tracker remediation', () => {
  test.use({ storageState: 'playwright/.auth/user.json' });

  test('screenshot images are fetched with an Authorization header, not as bare signed URLs', async ({ page }) => {
    // The regression this guards: /api/screenshots/{id}/file used to sit in the
    // public route file behind nothing but a signature, so an <img src> pointed
    // straight at it and anyone holding the link could read the bytes. It is
    // authenticated now, which means the gallery has to fetch through the api
    // client — an unauthenticated <img> request would 401.
    const fileRequests: Array<{ url: string; hasAuth: boolean }> = [];

    page.on('request', (request) => {
      if (/\/api\/screenshots\/\d+\/file/.test(request.url())) {
        fileRequests.push({
          url: request.url(),
          hasAuth: Boolean(request.headers()['authorization']),
        });
      }
    });

    await page.goto(`${BASE}/monitoring/screenshots`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /screenshots/i }).first()).toBeVisible({ timeout: 30000 });

    test.skip(fileRequests.length === 0, 'No screenshots in range for this account; nothing to assert.');

    for (const request of fileRequests) {
      expect(request.hasAuth, `expected an Authorization header on ${request.url}`).toBe(true);
    }

    // And the rendered <img> should be a blob object URL rather than the API path.
    const firstImageSrc = await page.locator('img[alt^="capture"], img[alt^="Screenshot"]').first().getAttribute('src');
    if (firstImageSrc) {
      expect(firstImageSrc.startsWith('blob:')).toBe(true);
    }
  });

  test('an unauthenticated request for screenshot bytes is rejected', async ({ page, request }) => {
    // Grab a real signed URL from an authenticated session, then replay it with
    // no credentials. Before the fix this returned 200 and the image bytes.
    await page.goto(`${BASE}/monitoring/screenshots`);
    await page.waitForLoadState('networkidle');

    const signedUrl = await page.evaluate(async () => {
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      const response = await fetch('/api/screenshots?per_page=1', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (!response.ok) return null;
      const body = await response.json();
      return body?.data?.[0]?.path ?? null;
    });

    test.skip(!signedUrl, 'No screenshots available for this account.');

    const anonymous = await request.get(signedUrl as string, {
      headers: { Authorization: '' },
      failOnStatusCode: false,
    });

    expect([401, 403]).toContain(anonymous.status());
  });

  test('starting and ending a break keeps both ledgers in step', async ({ page }) => {
    // The break page and the reports used to disagree, because a break wrote two
    // unlinked rows. Ending a break must close both and must not leave the user
    // locked out of starting the next one.
    await page.goto(`${BASE}/breaks`);
    await page.waitForLoadState('networkidle');

    const startButton = page.getByRole('button', { name: /start break/i }).first();
    const endButton = page.getByRole('button', { name: /end break/i }).first();

    // Clear any break already running so the run is repeatable.
    if (await endButton.isVisible().catch(() => false)) {
      await endButton.click();
      await expect(startButton).toBeVisible({ timeout: 15000 });
    }

    await expect(startButton).toBeVisible({ timeout: 20000 });
    await startButton.click();

    await expect(endButton).toBeVisible({ timeout: 20000 });
    await endButton.click();

    // Back to a startable state: the 409 lockout would leave us stuck here.
    await expect(startButton).toBeVisible({ timeout: 20000 });

    const secondStart = await page.evaluate(async () => {
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      const response = await fetch('/api/breaks/start', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({}),
      });
      const body = await response.json().catch(() => ({}));
      return { status: response.status, breakEntryId: body?.break_entry_id ?? null };
    });

    expect(secondStart.status, 'a fresh break must not 409').toBe(201);
    expect(secondStart.breakEntryId, 'break_entry_id links the two ledgers').not.toBeNull();

    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /end break/i }).first().click();
    await expect(page.getByRole('button', { name: /start break/i }).first()).toBeVisible({ timeout: 20000 });
  });

  test('the organization capture interval is admin-only and round-trips', async ({ page }) => {
    await page.goto(`${BASE}/settings`);
    await page.waitForLoadState('networkidle');

    const organizationTab = page.getByRole('button', { name: /^organization$/i }).first();
    test.skip(!(await organizationTab.isVisible().catch(() => false)), 'Signed-in account is not a strict admin.');

    await organizationTab.click();

    const intervalSelect = page.locator('select').filter({ hasText: /No organization default/i }).first();
    await expect(intervalSelect).toBeVisible({ timeout: 20000 });

    await intervalSelect.selectOption('15');
    await page.getByRole('button', { name: /save|update/i }).first().click();

    await page.reload();
    await page.waitForLoadState('networkidle');
    await organizationTab.click();
    await expect(intervalSelect).toHaveValue('15', { timeout: 20000 });

    // The resolved value must reach the user payload the desktop client reads.
    const effective = await page.evaluate(async () => {
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      const response = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      const body = await response.json();
      return body?.effective_monitoring_interval_minutes ?? null;
    });

    expect(effective).not.toBeNull();

    // Restore "no organization default" so the run is repeatable.
    await intervalSelect.selectOption('');
    await page.getByRole('button', { name: /save|update/i }).first().click();
  });

  test('a manager cannot set the organization capture interval', async ({ page }) => {
    await page.goto(`${BASE}/dashboard`);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      const organization = JSON.parse(
        localStorage.getItem('organization') || sessionStorage.getItem('organization') || 'null'
      );
      if (!organization) return null;

      const response = await fetch(`/api/organizations/${organization.id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ settings: { monitoring: { interval_minutes: 1 } } }),
      });

      const meResponse = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      const me = await meResponse.json();

      return { status: response.status, effective: me?.effective_monitoring_interval_minutes ?? null };
    });

    test.skip(result === null, 'No organization in local storage.');

    // The organizations endpoint is open to managers, so it must not be usable
    // as a back door onto the admin-only monitoring key regardless of status.
    expect(result!.effective).not.toBe(1);
  });
});
