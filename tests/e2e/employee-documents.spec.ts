import { test, expect, type Page, type Request } from '@playwright/test';

/**
 * E2E coverage for the identity, qualification and document uploads.
 *
 * WHY THIS IS ONE FILE AND NOT TWO
 *
 * These forms appear in two places — step 3 of the Add User wizard, and the
 * employee details page — but they are the SAME component,
 * frontend/src/components/EmployeeDetailsSection.tsx. It was consolidated from
 * two near-duplicates precisely because they had already drifted: one validated
 * government IDs and used lower-case id_type, the other did neither and used
 * upper-case. Testing the component once, plus asserting the wizard actually
 * mounts it, is therefore real coverage of both. Driving the wizard to step 3 a
 * second time would only re-test the same JSX behind a slower path.
 *
 * SCOPE LIMIT — same rule as add-user-paths.spec.ts.
 *
 * Every upload is INTERCEPTED. These endpoints write files to a private disk
 * and rows to the dev database, and a suite that runs on every change must not
 * accumulate junk PAN records against a real employee. What is asserted here is
 * what the browser owns: that the form is reachable, that a file actually gets
 * attached, and that the multipart body carries the fields the API needs.
 *
 * The multipart assertion is the point. Every one of these three calls has to
 * override the axios instance's default `Content-Type: application/json` — an
 * upload that forgets is silently sent as JSON and rejected with "The given
 * data was invalid", which reads like a validation problem and is not one. That
 * exact bug shipped once on the override importer.
 */

const BASE = 'http://localhost:5173';

const GOV_ID_ENDPOINT = '**/api/employees/*/government-ids';
const EDUCATION_ENDPOINT = '**/api/employees/*/educations';
const DOCUMENT_ENDPOINT = '**/api/employees/*/documents';

/** A real, tiny PDF — enough that a browser and a server both accept it. */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'utf-8');

const file = (name: string) => ({ name, mimeType: 'application/pdf', buffer: PDF });

function captureUpload(page: Page, pattern: string, body: unknown) {
  let resolve!: (request: Request) => void;
  const captured = new Promise<Request>((r) => { resolve = r; });

  page.route(pattern, async (route) => {
    resolve(route.request());
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  return captured;
}

/**
 * The multipart body as text.
 *
 * Read from the raw buffer rather than postData() because the payload contains
 * binary file content, and postData() will mangle it.
 */
const multipart = (request: Request) =>
  request.postDataBuffer()?.toString('latin1') ?? '';

/** Open the details page of whichever employee the roster lists first. */
async function openFirstEmployee(page: Page) {
  await page.goto(`${BASE}/employees`);
  await page.waitForLoadState('networkidle');

  /*
   * Picked by href, not by position. The sidebar owns three static children of
   * /employees — invitations, roles and teams — and they come first in the DOM,
   * so `.first()` navigates to the invitations list and every assertion below
   * then fails for a reason that has nothing to do with what is being tested.
   */
  const STATIC_CHILDREN = ['/employees/invitations', '/employees/roles', '/employees/teams'];

  /*
   * Waits for a QUALIFYING href, not merely for the selector. The sidebar
   * satisfies `a[href^="/employees/"]` on first paint, so a plain
   * waitForSelector returns long before the roster has fetched a single row.
   */
  const pick = (excluded: string[]) => {
    const links = Array.from(document.querySelectorAll('a[href^="/employees/"]'));
    return links
      .map((a) => a.getAttribute('href') || '')
      .find((h) => h !== '/employees' && !excluded.includes(h)) ?? null;
  };

  await page.waitForFunction(pick, STATIC_CHILDREN, { timeout: 30000 });
  const href = await page.evaluate(pick, STATIC_CHILDREN);

  expect(href, 'the roster must list at least one employee').toBeTruthy();

  await page.goto(`${BASE}${href}`);
  await page.waitForLoadState('networkidle');

  // The section is lazy behind the page shell; wait for a control it owns.
  await expect(page.getByRole('button', { name: 'Add Government ID' })).toBeVisible({ timeout: 20000 });
}

test.describe.configure({ mode: 'serial' });

test.describe('Employee identity, qualifications and documents', () => {
  test.use({ storageState: 'playwright/.auth/user.json' });

  test('a PAN is uploaded as multipart with its proof document', async ({ page }) => {
    await openFirstEmployee(page);

    await page.getByLabel(/^id number$/i).fill('ABCDE1234F');
    await page.locator('input[type="file"]').first().setInputFiles(file('pan-proof.pdf'));

    const request = captureUpload(page, GOV_ID_ENDPOINT, { id: 9101, id_type: 'pan' });
    await page.getByRole('button', { name: 'Add Government ID' }).click();

    const body = multipart(await request);

    expect((await request).headers()['content-type']).toContain('multipart/form-data');
    expect(body).toContain('name="id_number"');
    expect(body).toContain('ABCDE1234F');
    // The file has to actually be attached, not merely selected in the UI.
    expect(body).toContain('name="proof_file"');
    expect(body).toContain('pan-proof.pdf');
  });

  test('an Aadhaar is rejected client-side before it can be uploaded', async ({ page }) => {
    await openFirstEmployee(page);

    /*
     * Aadhaar carries a Verhoeff check digit and the form validates it. This
     * asserts the refusal, because the alternative — a typo'd Aadhaar reaching
     * the statutory tables — is the failure that matters, and it is invisible
     * until a filing is rejected months later.
     */
    let sent = false;
    await page.route(GOV_ID_ENDPOINT, async (route) => {
      sent = true;
      await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
    });

    await page.getByLabel(/id type/i).selectOption('aadhaar');
    await page.getByLabel(/^id number$/i).fill('123456789012');
    await page.getByRole('button', { name: 'Add Government ID' }).click();

    await expect(page.getByText(/aadhaar|invalid|check/i).first()).toBeVisible({ timeout: 5000 });
    expect(sent, 'an Aadhaar failing its checksum must not be uploaded').toBe(false);
  });

  test('a qualification is uploaded with its certificate', async ({ page }) => {
    await openFirstEmployee(page);

    // 10th / 12th / graduation and beyond — a dropdown, not free text, so the
    // same qualification is not spelled four ways across an organisation.
    await page.getByLabel(/^qualification$/i).selectOption({ index: 1 });

    const certificate = page.locator('input[type="file"]').nth(1);
    await certificate.setInputFiles(file('degree.pdf'));

    const request = captureUpload(page, EDUCATION_ENDPOINT, { id: 9102 });
    await page.getByRole('button', { name: 'Add Qualification' }).click();

    const body = multipart(await request);

    expect((await request).headers()['content-type']).toContain('multipart/form-data');
    expect(body).toContain('name="qualification"');
    expect(body).toContain('name="certificate_file"');
    expect(body).toContain('degree.pdf');
  });

  test('an experience document is uploaded under its own category', async ({ page }) => {
    await openFirstEmployee(page);

    await page.getByLabel(/document type/i).selectOption({ index: 1 });
    await page.locator('input[type="file"]').nth(2).setInputFiles(file('relieving-letter.pdf'));

    const request = captureUpload(page, DOCUMENT_ENDPOINT, { id: 9103 });
    await page.getByRole('button', { name: 'Add Experience Document' }).click();

    const body = multipart(await request);

    expect(body).toContain('name="file"');
    expect(body).toContain('relieving-letter.pdf');
    // Experience is a document CATEGORY, which is why it was removed from the
    // generic Documents dropdown — two routes to one category split the list.
    expect(body).toMatch(/name="category"[\s\S]{0,40}experience/i);
  });

  test('a generic document is uploaded with a title and category', async ({ page }) => {
    await openFirstEmployee(page);

    await page.getByLabel(/document title/i).fill('Signed Offer Letter');
    await page.locator('input[type="file"]').last().setInputFiles(file('offer.pdf'));

    const request = captureUpload(page, DOCUMENT_ENDPOINT, { id: 9104 });
    await page.getByRole('button', { name: 'Upload Document' }).click();

    const body = multipart(await request);

    expect(body).toContain('Signed Offer Letter');
    expect(body).toContain('name="category"');
    expect(body).toContain('offer.pdf');
  });

  test('the Add User wizard mounts the same section, so both routes share it', async ({ page }) => {
    /*
     * Not a duplicate of the tests above. It asserts the ONE thing the wizard
     * adds: that step 3 reuses this component rather than carrying a second
     * copy of these forms, which is exactly the drift that made consolidating
     * them necessary in the first place.
     */
    await page.goto(`${BASE}/add-user?tab=custom`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible({ timeout: 20000 });
    // Step 3 is where the section mounts, and reaching it creates a real user.
    // The import is what proves the wizard cannot drift from the page.
    const source = await page.request.get(`${BASE}/src/components/add-user/steps/Step3Profile.tsx`);
    expect(source.ok(), 'Step3Profile must be readable from the dev server').toBeTruthy();
    expect(await source.text()).toContain('EmployeeDetailsSection');
  });
});
