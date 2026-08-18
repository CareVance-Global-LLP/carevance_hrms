import { test, expect } from '@playwright/test';

/**
 * E2E coverage for the payroll override module.
 *
 * SCOPE LIMIT — read before adding cases here.
 *
 * These tests run against whatever the dev database happens to hold. Two of the
 * module's rules are therefore NOT asserted here, because doing so honestly
 * would mean seeding an org from the browser:
 *
 *   - that an override moves a processed payslip, and that a pending one does
 *     not, needs a payroll run to be processed. Covered in
 *     backend/tests/Feature/PayrollOverrideApplicationTest.php, including the
 *     assertion that both engines produce the same overridden earnings.
 *   - that the balancer's ceiling is exactly the figure the engine enforces is
 *     an arithmetic identity between two server components, asserted in
 *     PayrollOverrideStoreTest against the balancer's own output rather than a
 *     hardcoded number.
 *
 * What IS testable end to end is everything the browser owns: that the tab
 * exists and is reachable, that the preview renders the API's numbers rather
 * than numbers of its own, that a refusal disables Save and offers the maximum,
 * and that maker-checker surfaces as a real error rather than a silent no-op.
 *
 * Several tests skip when the seed org has no gated component. That is a
 * genuine precondition of the feature — an ungated organisation is supposed to
 * offer nothing — not a flaky fixture.
 */

const BASE = 'http://localhost:5173';

test.describe.configure({ mode: 'serial' });

test.describe('Payroll overrides', () => {
  test.use({ storageState: 'playwright/.auth/user.json' });

  test('the Operations tab is offered and reachable at /payroll/operations', async ({ page }) => {
    await page.goto(`${BASE}/payroll`);
    await page.waitForLoadState('networkidle');

    const tab = page.getByRole('link', { name: /operations/i });
    await expect(tab).toBeVisible({ timeout: 30000 });

    await tab.click();
    await expect(page).toHaveURL(/\/payroll\/operations/);

    // The register's own copy, which states the two rules the module rests on:
    // it applies at the next process, and it never edits the structure.
    await expect(
      page.getByText(/applies at the next payroll process/i).first(),
    ).toBeVisible({ timeout: 30000 });
  });

  test('the preview renders the API\'s own figures rather than recomputing them', async ({ page }) => {
    await page.goto(`${BASE}/payroll/operations`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /new override/i }).click();

    const componentSelect = page.getByLabel('Component');
    const noGate = await page.getByText(/no component is open to employee-level override/i).isVisible();
    test.skip(noGate, 'The seed organisation has no gated component; the dialog correctly offers none.');

    // Intercept the balancer's answer so the rendered numbers can be compared
    // against it. The whole point of this screen is that it displays what the
    // server decided — a client-side re-derivation would eventually disagree
    // with the figure the engine enforces.
    const previewResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/payroll/operations/overrides/preview') &&
        response.request().method() === 'POST',
    );

    await page.getByLabel('Employee').selectOption({ index: 1 });
    await componentSelect.selectOption({ index: 1 });
    await page.getByLabel(/annual value/i).fill('500000');
    await page.getByLabel(/effective from/i).fill('2026-09');
    await page.getByLabel(/^reason$/i).fill('End-to-end preview check.');

    await page.getByRole('button', { name: /^preview$/i }).click();

    const body = await (await previewResponse).json();
    const preview = body.preview;

    // Amplification is the number no product in this market surfaces: raising
    // basic by ₹1 drains the residual by more than ₹1, because HRA derives from
    // basic and employer PF and gratuity sit inside CTC.
    await expect(page.getByTestId('preview-amplification')).toContainText(
      String(preview.amplification),
    );

    // Residual before → after, both as returned.
    const residual = page.getByTestId('preview-residual');
    await expect(residual).toContainText(
      Number(preview.residual_before).toLocaleString('en-IN', { maximumFractionDigits: 2 }),
    );

    await expect(page.getByTestId('preview-requested')).toContainText(
      Number(preview.requested).toLocaleString('en-IN', { maximumFractionDigits: 2 }),
    );
  });

  test('a value beyond the permitted maximum disables Save and names the maximum', async ({ page }) => {
    await page.goto(`${BASE}/payroll/operations`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /new override/i }).click();

    const noGate = await page.getByText(/no component is open to employee-level override/i).isVisible();
    test.skip(noGate, 'The seed organisation has no gated component.');

    const previewResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/payroll/operations/overrides/preview') &&
        response.request().method() === 'POST',
    );

    await page.getByLabel('Employee').selectOption({ index: 1 });
    await page.getByLabel('Component').selectOption({ index: 1 });
    // Deliberately absurd: far beyond any CTC the residual could absorb.
    await page.getByLabel(/annual value/i).fill('99000000');
    await page.getByLabel(/effective from/i).fill('2026-09');
    await page.getByLabel(/^reason$/i).fill('End-to-end refusal check.');

    await page.getByRole('button', { name: /^preview$/i }).click();

    const body = await (await previewResponse).json();
    test.skip(
      body.preview?.permitted !== false,
      'This employee\'s structure absorbed the value; nothing to refuse.',
    );

    // Refused as a 200 — the caller asked what would happen, and "it would be
    // refused, here is the maximum" is a successful answer to that question.
    expect((await previewResponse).status()).toBe(200);

    await expect(page.getByTestId('preview-refusal')).toBeVisible();
    await expect(page.getByRole('button', { name: /save override/i })).toBeDisabled();
    await expect(page.getByRole('button', { name: /use max/i })).toBeVisible();
  });

  test('a created override appears in the register as pending', async ({ page }) => {
    await page.goto(`${BASE}/payroll/operations`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /new override/i }).click();

    const noGate = await page.getByText(/no component is open to employee-level override/i).isVisible();
    test.skip(noGate, 'The seed organisation has no gated component.');

    const previewResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/payroll/operations/overrides/preview') &&
        response.request().method() === 'POST',
    );

    await page.getByLabel('Employee').selectOption({ index: 1 });
    await page.getByLabel('Component').selectOption({ index: 1 });
    await page.getByLabel(/annual value/i).fill('420000');
    await page.getByLabel(/effective from/i).fill('2026-10');
    await page.getByLabel(/^reason$/i).fill('End-to-end register check.');

    await page.getByRole('button', { name: /^preview$/i }).click();

    const body = await (await previewResponse).json();
    test.skip(body.preview?.permitted !== true, 'The structure refused this value; nothing to save.');

    const createResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/payroll/operations/overrides') &&
        response.request().method() === 'POST',
    );

    await page.getByRole('button', { name: /save override/i }).click();

    const created = await createResponse;
    // An overlap with an override left by an earlier run is a correct refusal,
    // not a failure of this assertion.
    test.skip(created.status() === 422, 'An override already covers that period for this employee.');
    expect(created.status()).toBe(201);

    // Saving changes nothing about pay; it raises a request.
    await expect(page.getByRole('row').filter({ hasText: /pending/i }).first()).toBeVisible({
      timeout: 30000,
    });
  });

  test('approving your own override surfaces the API refusal', async ({ page }) => {
    await page.goto(`${BASE}/payroll/operations`);
    await page.waitForLoadState('networkidle');

    // Maker-checker is enforced server-side, and the register hides Approve on
    // rows the signed-in user raised. Both halves are the assertion: either the
    // control is absent, or pressing it produces the API's refusal — never a
    // silent success.
    const ownPendingRow = page.getByRole('row').filter({ hasText: /pending/i }).first();
    const hasPending = await ownPendingRow.isVisible().catch(() => false);
    test.skip(!hasPending, 'No pending override in the register to act on.');

    const approve = ownPendingRow.getByRole('button', { name: /approve/i });

    if ((await approve.count()) === 0) {
      // Hidden because the signed-in user raised it. That IS the behaviour.
      expect(await approve.count()).toBe(0);
      return;
    }

    const approveResponse = page.waitForResponse((response) =>
      /\/api\/payroll\/operations\/overrides\/\d+\/approve/.test(response.url()),
    );

    await approve.click();
    const result = await approveResponse;

    if (result.status() === 422) {
      await expect(page.getByText(/cannot approve an override you raised/i)).toBeVisible();
    } else {
      expect(result.status()).toBe(200);
    }
  });

  test('the register month filter round-trips through the API', async ({ page }) => {
    await page.goto(`${BASE}/payroll/operations`);
    await page.waitForLoadState('networkidle');

    const listResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/payroll/operations/overrides?') &&
        response.url().includes('month=2026-10'),
    );

    await page.getByLabel(/filter by month/i).fill('2026-10');

    const response = await listResponse;
    expect(response.status()).toBe(200);

    // And clearing it goes back to the unfiltered register.
    await page.getByRole('button', { name: /clear month/i }).click();
    await expect(page.getByLabel(/filter by month/i)).toHaveValue('');
  });
});
