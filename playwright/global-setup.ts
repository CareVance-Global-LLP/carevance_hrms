import { chromium, type FullConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function globalSetup(config: FullConfig) {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  /*
   * Credentials come from the environment.
   *
   * They used to be hardcoded to a single developer's account, which does not
   * exist in every database the suite is pointed at -- and when it is absent
   * the failure is a 30-second waitForURL timeout in global setup, so EVERY
   * spec fails at once with a message that says nothing about the cause.
   */
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'Playwright needs an account to sign in as. Set E2E_EMAIL and E2E_PASSWORD '
      + '(an admin in the organisation you are testing) before running the suite.',
    );
  }

  await page.goto('http://localhost:5173/login');
  await page.waitForLoadState('domcontentloaded');

  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('form button[type="submit"]');

  try {
    await page.waitForURL((url) =>
      url.pathname === '/dashboard' ||
      url.pathname === '/super-admin' ||
      url.pathname === '/onboarding/profile',
      { timeout: 30000 }
    );
  } catch {
    // Say what actually went wrong. A bad password, an account that is not in
    // this database, and an MFA challenge all present as "still on /login",
    // and a bare timeout sends people looking at the specs instead.
    const visible = await page.locator('body').innerText().catch(() => '');
    throw new Error(
      `Could not sign in as ${email}. Still on ${new URL(page.url()).pathname}. `
      + `Check the account exists in this database, the password is right, and that MFA `
      + `is not enforced for it.\n\nPage said: ${visible.slice(0, 300)}`,
    );
  }

  await page.waitForLoadState('networkidle');

  const storedToken = await page.evaluate(() => sessionStorage.getItem('token'));
  const storedUser = await page.evaluate(() => sessionStorage.getItem('user'));
  const storedOrg = await page.evaluate(() => sessionStorage.getItem('organization'));

  if (storedToken) {
    await page.evaluate((token) => localStorage.setItem('token', token), storedToken);
  }
  if (storedUser) {
    await page.evaluate((user) => localStorage.setItem('user', user), storedUser);
  }
  if (storedOrg) {
    await page.evaluate((org) => localStorage.setItem('organization', org), storedOrg);
  }

  const authDir = path.join(__dirname, '.auth');
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  await page.context().storageState({ path: path.join(authDir, 'user.json') });
  await browser.close();
}
