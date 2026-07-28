import { chromium, type FullConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function globalSetup(config: FullConfig) {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto('http://localhost:5173/login');
  await page.waitForLoadState('domcontentloaded');

  await page.fill('#email', 'ayushborwal004@gmail.com');
  await page.fill('#password', '12345678');
  await page.click('form button[type="submit"]');

  await page.waitForURL((url) =>
    url.pathname === '/dashboard' ||
    url.pathname === '/super-admin' ||
    url.pathname === '/onboarding/profile',
    { timeout: 30000 }
  );

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
