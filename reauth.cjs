const path = require('path');
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/login');
  await page.waitForLoadState('domcontentloaded');
  await page.fill('#email', 'ayushborwal004@gmail.com');
  await page.fill('#password', '12345678');
  await page.click('form button[type="submit"]');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  const authDir = path.join(__dirname, 'playwright', '.auth');
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }
  await page.context().storageState({ path: path.join(authDir, 'user.json') });
  await browser.close();
  console.log('Auth state saved successfully');
})();
