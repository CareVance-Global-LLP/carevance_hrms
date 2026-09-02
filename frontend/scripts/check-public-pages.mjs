/**
 * Visit every public page and prove it actually works.
 *
 * WHY THIS IS NOT JUST A STATUS-CODE SWEEP. This is a SPA: the server returns
 * 200 for every path, including ones that do not exist, and App.tsx routes
 * unknown paths to `<Navigate to="/" replace />`. So a dead link does not 404 —
 * it silently lands the reader on the homepage. The only way to catch that is
 * to compare the path you asked for against the path you ended up on.
 *
 * Each page is checked for four separate failures:
 *
 *   · SILENT REDIRECT — asked for /x, ended up somewhere else (dead route).
 *   · EMPTY RENDER — the shell mounted but the page produced no content, which
 *     is what a lazy-chunk failure or a thrown component looks like.
 *   · ERROR BOUNDARY — the app caught a crash and rendered its fallback.
 *   · CONSOLE ERRORS — excluding the /auth/me 401s that every public page
 *     produces by design when nobody is signed in.
 *
 * Then it crawls every internal link on the landing page and checks those too,
 * because a link to a route nobody registered is exactly the failure the
 * catch-all hides.
 *
 *   node scripts/check-public-pages.mjs [baseUrl]
 */
import { chromium } from 'playwright';

const BASE = (process.argv[2] ?? 'http://localhost:4173').replace(/\/$/, '');

/** Routes registered in App.tsx that a signed-out visitor can reach. */
const ROUTES = [
  '/',
  '/pricing',
  '/checkout',
  '/contact-sales',
  '/support',
  '/privacy',
  '/terms',
  '/start-trial',
  '/login',
  '/forgot-password',
  '/book-demo', // redirects to /contact-sales by design
];

/** Where a route is MEANT to end up, when that differs from the request. */
const EXPECTED_REDIRECT = { '/book-demo': '/contact-sales' };

/*
 * GSI_LOGGER / 403 come from Google Sign-In refusing a localhost origin that is
 * not in the OAuth client's allowlist. It is a local-environment fact, not a
 * page defect, and it fires on every page carrying the sign-in button.
 */
const IGNORABLE = /401|Unauthorized|favicon|auth\/me|ERR_CONNECTION_REFUSED|GSI_LOGGER|status of 403/i;

/**
 * Fabricated claims, checked on EVERY public page rather than just the landing.
 *
 * All four of these were deleted from the landing hero and survived on
 * /pricing, which keeps its own copy of the same numbers — live in production
 * until this sweep found them. A claim removed from one component is not
 * removed from the product, and a guard that only looks at `/` will keep
 * missing the second copy.
 */
const BANNED = [
  [/10,?000\+/, 'fabricated user count'],
  [/500\+\s*(active\s*)?(workspaces|users|companies|teams)/i, 'fabricated workspace count'],
  [/32\s*%\s*(avg|average)?\s*productivity/i, 'fabricated productivity lift'],
  [/\bavg\.?\s*rating\b|\b4\.8\s*\/\s*5\b/i, 'review score we do not have'],
  [/\bSOC ?2\b/i, 'SOC 2 claim'],
  [/\bISO ?27001\b/i, 'ISO 27001 claim'],
  [/99\.\d+\s*%\s*uptime/i, 'uptime figure we cannot defend'],
  [/trusted by \d/i, 'fabricated trust claim'],
  [/free for up to \d/i, 'there is no free tier — that is the TRIAL'],
];

let failures = 0;
const fail = (m) => { failures++; console.log(`  FAIL  ${m}`); };

const browser = await chromium.launch();

async function visit(path) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORABLE.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  let ok = true;
  try {
    await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    console.log(`\n${path}`);
    fail(`navigation failed: ${e.message.split('\n')[0]}`);
    await ctx.close();
    return false;
  }
  await page.waitForTimeout(1800);

  const info = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      path: location.pathname,
      textLen: t.trim().length,
      heading: (document.querySelector('h1, h2')?.innerText ?? '').replace(/\n/g, ' ').slice(0, 70),
      boundary: /something went wrong|unexpected error|try again later/i.test(t),
      text: t,
      ld: [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map((s) => s.textContent)
        .join('\n'),
      /*
       * Headings whose words have no spaces between them.
       *
       * A word-by-word reveal that separates words with `margin` instead of a
       * space character looks correct and is broken for copy-paste, screen
       * readers and search engines. Two components had this fault
       * independently; a long run of letters with no space in a heading is the
       * signature, and it is cheap to look for on every page.
       */
      runOnHeadings: [...document.querySelectorAll('h1, h2, h3')]
        .map((h) => h.innerText.trim())
        .filter((s) => /[a-z]{25,}/.test(s.replace(/\s+/g, ' ')) && !s.includes(' ')),
    };
  });

  console.log(`\n${path}  ->  ${info.path}   [${info.textLen} chars]  ${info.heading}`);

  const expected = EXPECTED_REDIRECT[path] ?? path;
  if (info.path !== expected) {
    fail(`landed on ${info.path}, expected ${expected} — route is probably not registered`);
    ok = false;
  }
  if (info.textLen < 200) {
    fail(`rendered only ${info.textLen} characters — page is effectively blank`);
    ok = false;
  }
  if (info.boundary) {
    fail('an error boundary is showing');
    ok = false;
  }
  if (errors.length) {
    fail(`console: ${errors.slice(0, 2).join(' | ').slice(0, 200)}`);
    ok = false;
  }

  /**
   * Is this an assertion, or a disclosure about not having the thing?
   *
   * "Are you SOC 2 certified?" answered "No, to both" is precisely what these
   * pages should say, and it contains the banned phrase. Weakening the pattern
   * until it stops matching would also stop it catching a real badge, so
   * instead look at the surrounding sentence for a negation or a question
   * mark. The failure direction is the safe one: an actual claim phrased with
   * the word "not" nearby would slip through, but real claims are not written
   * that way — honest denials always are.
   */
  const isDisclosure = (hay, at) =>
    /\bno\b|\bnot\b|\bneither\b|cannot|\bwithout\b|\?/i.test(
      hay.slice(Math.max(0, at - 150), at + 150)
    );

  for (const [pattern, why] of BANNED) {
    for (const hay of [info.text, info.ld]) {
      const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
      for (const m of hay.matchAll(re)) {
        if (isDisclosure(hay, m.index ?? 0)) continue;
        fail(`shows "${m[0].trim()}" — ${why}`);
        ok = false;
      }
    }
  }
  if (/aggregateRating/.test(info.ld)) {
    fail('JSON-LD declares aggregateRating — fabricated review markup');
    ok = false;
  }
  for (const h of info.runOnHeadings) {
    fail(`heading has no spaces between words: "${h.slice(0, 50)}"`);
    ok = false;
  }

  await ctx.close();
  return ok;
}

console.log(`Checking ${ROUTES.length} public routes against ${BASE}`);
console.log('='.repeat(64));
for (const r of ROUTES) await visit(r);

/* ── Crawl the landing page's own links ──────────────────────────────── */
console.log('\n' + '='.repeat(64));
console.log('Internal links on the landing page');
console.log('='.repeat(64));

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const links = await page.evaluate(() =>
  [...new Set(
    [...document.querySelectorAll('a[href]')]
      .map((a) => a.getAttribute('href'))
      .filter((h) => h && h.startsWith('/') && !h.startsWith('//'))
      .map((h) => h.split('#')[0])
      .filter(Boolean)
  )]
);
await ctx.close();

console.log(`found ${links.length} distinct internal links`);
const unchecked = links.filter((l) => !ROUTES.includes(l));
for (const l of unchecked) await visit(l);

await browser.close();

console.log('\n' + '='.repeat(64));
if (failures) {
  console.log(`${failures} failure(s) across ${ROUTES.length + unchecked.length} pages.`);
  process.exit(1);
}
console.log(`All ${ROUTES.length + unchecked.length} public pages render correctly.`);
