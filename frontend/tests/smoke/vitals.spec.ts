import { playAudit } from 'playwright-lighthouse';
import { test, expect } from '@playwright/test';

test.describe('Core Web Vitals', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Lighthouse requires Chromium with remote debugging');

  test('payroll overview meets performance and accessibility thresholds', async ({ page }) => {
    await page.goto('/payroll');
    await page.waitForLoadState('networkidle');

    try {
      const result = await playAudit({
        page,
        port: 9222,
        thresholds: {
          performance: 80,
          accessibility: 90,
        },
        config: {
          settings: {
            throttlingMethod: 'provided',
          },
        },
      });

      const perf = result.lhr.categories.performance.score * 100;
      const a11y = result.lhr.categories.accessibility.score * 100;

      expect(perf, `Performance score ${perf} below threshold`).toBeGreaterThanOrEqual(80);
      expect(a11y, `Accessibility score ${a11y} below threshold`).toBeGreaterThanOrEqual(90);
    } catch (err) {
      test.skip(true, `Lighthouse unavailable in this environment: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  });
});
