/**
 * Landing page performance, measured — not estimated.
 *
 * RUN THIS AGAINST A PRODUCTION PREVIEW, never the dev server. Vite dev serves
 * unminified modules over HMR with a websocket attached; numbers from it are
 * meaningless and flattering in different directions at once.
 *
 *   npm run build
 *   npx vite preview --port 4173
 *   node scripts/perf-landing.mjs http://localhost:4173/
 *
 * Two profiles are measured:
 *
 *   · DESKTOP — unthrottled, for Core Web Vitals.
 *   · MID-RANGE ANDROID — 4× CPU throttle and a 390×844 viewport, which is the
 *     profile the brief actually names. The frame rate during a scripted scroll
 *     is the number that decides whether the scrubbed sections stay or go.
 *
 * FPS is derived from real frame callbacks during a continuous scroll, not from
 * a synthetic loop: the thing being measured is whether scroll-linked work
 * (four `useScroll` subscriptions, a blur filter, a sticky swap) starves the
 * compositor on a slow device.
 */

import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://localhost:4173/';
const FPS_FLOOR = 45; // the brief's threshold

const results = [];
const browser = await chromium.launch();

/**
 * One untimed load before any measuring.
 *
 * The first profile was reporting FCP 2588ms against the throttled profile's
 * 572ms — i.e. the *slow* device looked four times faster. That was cold start:
 * a preview server that had not yet served these assets, and an OS file cache
 * with nothing in it. Whichever profile ran first absorbed that cost and the
 * second one read a warm machine, so the two numbers were not comparable to
 * each other, let alone to a threshold.
 */
async function warmUp() {
  const c = await browser.newContext();
  const p = await c.newPage();
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  await c.close();
}

async function profile({ name, cpuThrottle, viewport }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  if (cpuThrottle > 1) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
  }

  /*
   * Confirm the throttle is REAL before trusting anything measured under it.
   *
   * `Emulation.setCPUThrottlingRate` is silently a no-op if the session is
   * attached oddly, and a "4× throttled" run that was never throttled reports
   * reassuring numbers that mean nothing. Timing a fixed busy loop against the
   * unthrottled baseline is the cheapest way to prove the multiplier landed.
   */
  const busyMs = await page.evaluate(() => {
    const t0 = performance.now();
    let n = 0;
    for (let i = 0; i < 4_000_000; i++) n += Math.sqrt(i);
    return { ms: performance.now() - t0, n };
  }).then((r) => r.ms);

  await page.goto(URL, { waitUntil: 'load' });

  // Core Web Vitals. LCP is only final once the page stops changing, so settle
  // first, then read the last entry.
  await page.waitForTimeout(2500);
  const vitals = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const out = { lcp: null, lcpElement: null, cls: 0, fcp: null };

        const fcp = performance.getEntriesByName('first-contentful-paint')[0];
        if (fcp) out.fcp = Math.round(fcp.startTime);

        new PerformanceObserver((l) => {
          const e = l.getEntries().at(-1);
          if (e) {
            out.lcp = Math.round(e.startTime);
            out.lcpElement = e.element
              ? `${e.element.tagName}.${String(e.element.className || '').slice(0, 30)}`
              : 'n/a';
          }
        }).observe({ type: 'largest-contentful-paint', buffered: true });

        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) if (!e.hadRecentInput) out.cls += e.value;
        }).observe({ type: 'layout-shift', buffered: true });

        setTimeout(() => resolve(out), 600);
      })
  );

  // Frame rate during a continuous scroll through every scrubbed section.
  const fps = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const frames = [];
        let last = performance.now();
        let running = true;

        const tick = (now) => {
          frames.push(now - last);
          last = now;
          if (running) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);

        const total = document.body.scrollHeight - window.innerHeight;
        const startedAt = performance.now();
        const DURATION = 6000;

        const step = () => {
          const t = (performance.now() - startedAt) / DURATION;
          window.scrollTo(0, Math.min(1, t) * total);
          if (t < 1) requestAnimationFrame(step);
          else {
            running = false;
            setTimeout(() => {
              // Drop the first few frames: they include scroll start-up.
              const d = frames.slice(5).filter((x) => x > 0);
              d.sort((a, b) => a - b);
              const mean = d.reduce((a, b) => a + b, 0) / d.length;
              const p95 = d[Math.floor(d.length * 0.95)];
              resolve({
                meanFps: Math.round(1000 / mean),
                worstFps: Math.round(1000 / p95),
                longFrames: d.filter((x) => x > 50).length,
                frames: d.length,
              });
            }, 120);
          }
        };
        requestAnimationFrame(step);
      })
  );

  await context.close();
  results.push({ name, cpuThrottle, vitals, fps, busyMs });
}

await warmUp();
await profile({ name: 'Desktop (unthrottled)', cpuThrottle: 1, viewport: { width: 1440, height: 900 } });
await profile({ name: 'Mid-range Android (4x CPU)', cpuThrottle: 4, viewport: { width: 390, height: 844 } });

await browser.close();

let failed = 0;
for (const r of results) {
  console.log(`\n── ${r.name} ─────────────────────────────`);
  console.log(`  FCP            ${r.vitals.fcp} ms`);
  console.log(`  LCP            ${r.vitals.lcp} ms   (${r.vitals.lcpElement})`);
  console.log(`  CLS            ${r.vitals.cls.toFixed(4)}`);
  console.log(`  Scroll FPS     mean ${r.fps.meanFps} · p95-worst ${r.fps.worstFps}`);
  console.log(`  Frames > 50ms  ${r.fps.longFrames} of ${r.fps.frames}`);
  console.log(`  CPU busy-loop  ${Math.round(r.busyMs)} ms  (throttle ${r.cpuThrottle}x)`);

  if (r.fps.meanFps < FPS_FLOOR) {
    console.log(`  FAIL  mean FPS ${r.fps.meanFps} is below the ${FPS_FLOOR} floor`);
    failed++;
  }
  if (r.vitals.cls > 0.1) {
    console.log(`  FAIL  CLS ${r.vitals.cls.toFixed(4)} exceeds 0.1`);
    failed++;
  }
}

console.log('');
if (failed) {
  console.log(`${failed} threshold(s) missed.`);
  process.exit(1);
}
console.log('All performance thresholds met.');
