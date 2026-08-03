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
  await page.waitForTimeout(3000);

  // Dismiss cookie consent
  try {
    const rejectBtn = page.locator('button:has-text("Reject non-essential")');
    if (await rejectBtn.isVisible({ timeout: 2000 })) {
      await rejectBtn.click();
      await page.waitForTimeout(500);
    }
  } catch {}

  // 1. Hero section
  await page.screenshot({
    path: `${__dirname}/final-hero.png`,
    clip: { x: 0, y: 0, width: 1440, height: 900 },
  });
  console.log('Hero captured');

  // 2. Scroll to product section
  await page.evaluate(() => {
    document.getElementById('product')?.scrollIntoView({ behavior: 'instant' });
  });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${__dirname}/final-product.png` });
  console.log('Product section captured');

  // 3. Features
  await page.evaluate(() => {
    document.getElementById('features')?.scrollIntoView({ behavior: 'instant' });
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${__dirname}/final-features.png` });
  console.log('Features captured');

  // 4. Workflow (timeline)
  await page.evaluate(() => {
    document.getElementById('workflow')?.scrollIntoView({ behavior: 'instant' });
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${__dirname}/final-workflow.png` });
  console.log('Workflow captured');

  // 5. Screenshots section
  await page.evaluate(() => {
    document.getElementById('screenshots')?.scrollIntoView({ behavior: 'instant' });
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${__dirname}/final-screenshots.png` });
  console.log('Screenshots section captured');

  // 6. Security
  await page.evaluate(() => {
    document.getElementById('security')?.scrollIntoView({ behavior: 'instant' });
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${__dirname}/final-security.png` });
  console.log('Security captured');

  // 7. CTA
  await page.evaluate(() => {
    const cta = document.querySelector('section:last-of-type');
    cta?.scrollIntoView({ behavior: 'instant' });
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${__dirname}/final-cta.png` });
  console.log('CTA captured');

  // 8. Full page
  await page.screenshot({
    path: `${__dirname}/final-fullpage.png`,
    fullPage: true,
  });
  console.log('Full page captured');

  await browser.close();
  console.log('All final screenshots done!');
})();
