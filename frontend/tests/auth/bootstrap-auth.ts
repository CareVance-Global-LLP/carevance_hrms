import { chromium } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';

async function saveAuthState(
  email: string,
  password: string,
  outPath: string
) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/login`);
  await page.fill('[name="email"]', email);
  await page.fill('[name="password"]', password);
  await page.click('[type="submit"]');

  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 60_000 });

  await context.storageState({ path: outPath });
  await browser.close();
  console.log(`Saved auth state -> ${outPath}`);
}

(async () => {
  await saveAuthState(
    process.env.ADMIN_EMAIL ?? 'irbaz@test.com',
    process.env.ADMIN_PASSWORD ?? '12345678',
    'tests/.auth/admin.json'
  );
  await saveAuthState(
    process.env.VIEWER_EMAIL ?? 'viewer@example.com',
    process.env.VIEWER_PASSWORD ?? 'secret',
    'tests/.auth/viewer.json'
  );
})();
