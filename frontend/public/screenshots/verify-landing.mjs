import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  console.log('Loading landing page...');
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Dismiss cookie consent
  try {
    const rejectBtn = page.locator('button:has-text("Reject non-essential")');
    if (await rejectBtn.isVisible({ timeout: 2000 })) {
      await rejectBtn.click();
      await page.waitForTimeout(500);
    }
  } catch {}

  // Screenshot hero section
  await page.screenshot({
    path: `${__dirname}/verify-hero.png`,
    clip: { x: 0, y: 0, width: 1440, height: 900 },
  });
  console.log('Hero section captured');

  // Scroll to features and screenshot
  await page.evaluate(() => {
    document.getElementById('features')?.scrollIntoView({ behavior: 'instant' });
  });
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: `${__dirname}/verify-features.png`,
  });
  console.log('Features section captured');

  // Scroll to screenshots section
  await page.evaluate(() => {
    document.getElementById('screenshots')?.scrollIntoView({ behavior: 'instant' });
  });
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: `${__dirname}/verify-screenshots.png`,
  });
  console.log('Screenshots section captured');

  // Scroll to CTA
  await page.evaluate(() => {
    document.querySelector('section:last-of-type')?.scrollIntoView({ behavior: 'instant' });
  });
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: `${__dirname}/verify-cta.png`,
  });
  console.log('CTA section captured');

  // Full page screenshot
  await page.screenshot({
    path: `${__dirname}/verify-fullpage.png`,
    fullPage: true,
  });
  console.log('Full page captured');

  await browser.close();
  console.log('All verification screenshots done!');
})();
