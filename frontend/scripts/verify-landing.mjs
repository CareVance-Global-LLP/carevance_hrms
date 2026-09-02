/**
 * Landing page verification, in a real browser.
 *
 * Three things are checked, and they are the three that have actually gone
 * wrong on this page:
 *
 *   1. NO FABRICATED CLAIMS render. Phase 1 removed eight invented logos, a
 *      4.8-star aggregateRating, "10,000+ users", "500+ workspaces", a "32%
 *      productivity lift", two SOC 2 badges and a "99.9% uptime" figure. They
 *      shipped to production and sat there. A grep over source would miss a
 *      claim reintroduced through a constant, so this reads the rendered DOM.
 *
 *   2. THE SECTION ORDER is the trust ladder, not the old capability-first one.
 *
 *   3. REDUCED MOTION genuinely degrades — the custom cursor is absent, the
 *      ECR bytes are complete rather than mid-type, and the privacy capture is
 *      already blurred. The global CSS net in index.css cannot cover any of
 *      those, because framer-motion writes inline transforms.
 *
 * Run against a dev server:  node scripts/verify-landing.mjs [url]
 */

import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:5199/';
const TRUTH = '../PRODUCT_TRUTH.md';

/**
 * Strings that must never appear in the rendered page again.
 *
 * NOTE ON THE CERTIFICATION PATTERNS. They match an AFFIRMATIVE claim only —
 * "SOC 2 compliant", "SOC 2 certified" — not the words themselves. Saying "we
 * are not SOC 2 certified" is the honest disclosure the FAQ and /security are
 * built around, and a checker that forbids naming the thing you lack would
 * force the page to be vague about exactly the point it should be plain about.
 * The first version of this file made that mistake and failed the build for a
 * true sentence.
 */
const BANNED = [
  [/Acme Corp|TechFlow|GlobalSync|DataPrime|CloudNine|InnoVate|BrightPath|NextLevel/, 'invented customer logo'],
  [/SOC ?2\s*(type\s*[i1]{1,2}\s*)?(compliant|certified|accredited)/i, 'affirmative SOC 2 claim — we hold no report'],
  [/ISO ?27001\s*(compliant|certified|accredited)/i, 'affirmative ISO 27001 claim — we hold no certificate'],
  [/99\.9\s*%/, 'uptime figure we cannot defend'],
  [/10,?000\+/, 'fabricated user count'],
  [/500\+\s*workspaces/i, 'fabricated workspace count'],
  [/32\s*%\s*(productivity|avg|average)/i, 'fabricated productivity lift'],
  [/trusted by \d/i, 'fabricated trust claim'],
  [/free for up to \d/i, 'there is no free tier — five seats is the TRIAL'],
  [/\$\d/, 'dollar amount — this product sells in India only'],
];

const EXPECTED_ORDER = [
  'stop being your problem',        // §2  DayOne
  'doesn’t talk to your',           // §3  ProblemCost
  'tracked minute',                 // §4  ProductTour
  'Every hour, captured',           // §5  SplitFlow
  'The actual bytes',               // §6  ComplianceBytes
  'asks first',                     // §8  PrivacyDemo
  'committee purchase',             // §9  RoleTabs
  'logo wall',                      // §11 HonestProof
  'most of this market hides it',   // §12 PricingBanner
  'Eight questions worth asking',   // §13 FAQ
];

let failures = 0;
const fail = (m) => { failures++; console.log(`FAIL  ${m}`); };
const pass = (m) => console.log(`PASS  ${m}`);

const browser = await chromium.launch();

async function loadFully(page) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  // Walk the page so every lazy chunk mounts and every scrub runs.
  await page.evaluate(async () => {
    const h = document.body.scrollHeight;
    for (let y = 0; y < h; y += 600) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 400));
  });
  await page.waitForTimeout(1200);
}

/* ── 1 & 2: normal motion ────────────────────────────────────────────── */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  page.on('console', (m) => {
    // /api 401s are expected on a public page with no session.
    if (m.type() === 'error' && !/401|Unauthorized|favicon/.test(m.text())) {
      consoleErrors.push(m.text());
    }
  });

  await loadFully(page);

  const text = await page.evaluate(() => document.body.innerText);
  const ld = await page.evaluate(() =>
    [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent).join('\n')
  );

  /**
   * Is this match an assertion, or a disclosure/question about it?
   *
   * "Are you SOC 2 or ISO 27001 certified?" and "we are not ISO 27001
   * certified" both contain the banned phrase and are both exactly what this
   * page should say. Rather than weaken the patterns until they stop catching
   * the real thing, look at the surrounding sentence for a negation or a
   * question mark. It is a heuristic, and the failure direction is the safe
   * one: a genuine claim wrapped in the word "not" would slip through, but a
   * genuine claim is not usually phrased that way — whereas an honest denial
   * always is.
   */
  const isDisclosure = (haystack, index) => {
    const ctx = haystack.slice(Math.max(0, index - 140), index + 140);
    return /\bno\b|\bnot\b|\bneither\b|cannot|\?/i.test(ctx);
  };

  for (const [pattern, why] of BANNED) {
    for (const haystack of [text, ld]) {
      const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
      for (const m of haystack.matchAll(global)) {
        if (isDisclosure(haystack, m.index ?? 0)) continue;
        fail(`rendered page contains "${m[0]}" — ${why}`);
      }
    }
  }
  if (/aggregateRating/.test(ld)) fail('JSON-LD still declares aggregateRating');
  if (failures === 0) pass(`no fabricated claims in the rendered page or its structured data`);

  // Section order
  const positions = await page.evaluate((needles) => {
    const body = document.body.innerText;
    return needles.map((n) => body.indexOf(n));
  }, EXPECTED_ORDER);

  const missing = EXPECTED_ORDER.filter((_, i) => positions[i] === -1);
  if (missing.length) {
    fail(`sections missing from the page: ${missing.join(', ')}`);
  } else {
    const sorted = positions.every((p, i) => i === 0 || p > positions[i - 1]);
    if (sorted) pass(`all ${EXPECTED_ORDER.length} sections present and in trust-ladder order`);
    else fail(`sections are out of order: ${JSON.stringify(positions)}`);
  }

  // FAQPage structured data must match the accordion.
  const faqCount = (ld.match(/"@type":"Question"/g) ?? []).length;
  if (faqCount === 8) pass('FAQPage structured data carries all 8 questions');
  else fail(`FAQPage declares ${faqCount} questions, expected 8`);

  // The ECR line must be the real 11-field format.
  const ecrOk = /101234567890\|\|Priya Nair\|\|115891\.20(\|\|[\d.]+){8}/.test(text);
  if (ecrOk) pass('PF ECR line renders all 11 fields in EPFO column order');
  else fail('PF ECR line is missing or malformed');

  /*
   * THE PRODUCT SCREENS MUST SHOW A WORKING SYSTEM.
   *
   * This check exists because the tour previously used real PNG captures of an
   * EMPTY demo tenant: 0h 0m tracked, "No tool analytics found", Total Payroll
   * ₹0, and every statutory filing marked "Needs run" — each sitting beneath a
   * caption claiming the opposite. Nothing caught it, because a verifier that
   * reads the DOM cannot read a picture.
   *
   * The screens are markup now, so their figures ARE assertable. Both halves
   * matter: the real numbers must be present, and the empty-state strings must
   * not be.
   */
  /*
   * Checked at MOBILE width, because that is where all four screens exist at
   * once. On desktop the tour's sticky frame renders only the ACTIVE step —
   * one screen — while the inline copies are `lg:hidden`, so a desktop pass
   * can only ever see the figures for step one. The mobile fallback renders
   * every step inline, which makes it both the complete set and the harder
   * layout to get right.
   */
  await page.setViewportSize({ width: 390, height: 844 });
  await loadFully(page);
  const mobileText = await page.evaluate(() => document.body.innerText);

  const SHOULD_SHOW = [
    ['7h 42m', 'tracked hours on the Track step'],
    ['94% active', 'active share on the Track step'],
    ['22 / 22', 'present days on the Attend step'],
    ['169h 24m', 'total hours on the Attend step'],
    ['Override #418', 'the named override on the Approve step'],
    ['₹1,07,187.17', 'net pay on the Pay step'],
  ];
  let missingFigures = 0;
  for (const [needle, why] of SHOULD_SHOW) {
    if (mobileText.includes(needle)) continue;
    fail(`product screens are missing "${needle}" — ${why}`);
    missingFigures++;
  }
  if (!missingFigures) pass(`all ${SHOULD_SHOW.length} product-screen figures render`);

  const EMPTY_STATE = [
    [/\b0h 0m\b/, 'a zeroed duration'],
    [/No tool analytics found/i, 'an empty analytics panel'],
    [/\bNo Run\b/, 'a payroll that has never run'],
    [/Needs run/i, 'statutory filings marked as not generated'],
    [/0 employees processed/i, 'an unprocessed payroll'],
  ];
  let emptyHits = 0;
  for (const [pattern, why] of EMPTY_STATE) {
    const m = mobileText.match(pattern);
    if (m) {
      fail(`product screens show ${why} ("${m[0]}") — the picture contradicts the caption`);
      emptyHits++;
    }
  }
  if (!emptyHits) pass('product screens show a working system, not an empty one');

  // And they must be labelled as an example rather than customer data.
  const tagged = (mobileText.match(/Worked example/g) ?? []).length;
  if (tagged >= 4) pass(`all ${tagged} product screens are labelled as a worked example`);
  else fail(`only ${tagged} screens carry the "Worked example" label`);

  /*
   * EVERY `data-claim` MUST RESOLVE TO PRODUCT_TRUTH.md.
   *
   * The marketing site has enforced this since it was built (see
   * marketing/scripts/verify-claims.ts) and this page did not, even though its
   * sections carry the same attributes. That asymmetry is how two properties
   * describing one product drift apart: a claim ID can be copied across, the
   * underlying fact can change, and only one side notices.
   *
   * Read from the RENDERED page rather than the source, so it checks what
   * actually ships rather than what happens to be written down.
   */
  const claims = await page.evaluate(() =>
    [...new Set([...document.querySelectorAll('[data-claim]')].map((e) => e.getAttribute('data-claim')))]
  );

  if (!existsSync(TRUTH)) {
    fail(`PRODUCT_TRUTH.md not found at ${TRUTH} — claim IDs cannot be verified`);
  } else if (!claims.length) {
    fail('no data-claim attributes found on the page — claims are no longer traceable');
  } else {
    const truth = readFileSync(TRUTH, 'utf8');
    const known = new Set(truth.match(/[A-Z]{2,4}-(?:\d{2}|CAVEAT)/g) ?? []);
    const unknown = claims.filter((c) => !known.has(c));
    if (unknown.length) {
      for (const c of unknown) fail(`claim ${c} is on the page but not in PRODUCT_TRUTH.md`);
    } else {
      pass(`all ${claims.length} claim IDs on the page resolve to PRODUCT_TRUTH.md`);
    }
  }

  // No horizontal scroll at desktop or phone widths.
  for (const w of [1440, 390]) {
    await page.setViewportSize({ width: w, height: 900 });
    await loadFully(page);
    const { sw, cw } = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    if (sw > cw + 1) fail(`horizontal overflow at ${w}px (${sw} > ${cw})`);
    else pass(`no horizontal overflow at ${w}px`);
  }

  if (consoleErrors.length) fail(`console errors: ${consoleErrors.slice(0, 3).join(' | ')}`);
  else pass('no unexpected console errors');

  await page.close();
}

/* ── 3: reduced motion ───────────────────────────────────────────────── */
{
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  await loadFully(page);

  const r = await page.evaluate(() => {
    const code = document.querySelector('pre code');
    const blurred = document.querySelector('.will-change-\\[filter\\]');
    return {
      // The custom cursor renders a fixed ring; under reduced motion: absent.
      cursorPresent: !!document.querySelector('.pointer-events-none.fixed.rounded-full'),
      ecrComplete: code ? code.textContent.trim().endsWith('||0.00||0.00') : false,
      captureFilter: blurred ? getComputedStyle(blurred).filter : 'missing',
      headlineText: document.querySelector('h1')?.innerText ?? '',
    };
  });

  if (r.cursorPresent) fail('custom cursor still renders under prefers-reduced-motion');
  else pass('custom cursor is absent under prefers-reduced-motion');

  if (r.ecrComplete) pass('ECR bytes render complete, never mid-type, under reduced motion');
  else fail('ECR line is incomplete under reduced motion');

  if (/blur\(/.test(r.captureFilter)) pass('privacy capture shows its blurred end state');
  else fail(`privacy capture is not blurred under reduced motion (${r.captureFilter})`);

  if (/team is working on/.test(r.headlineText)) pass('hero headline is complete text, not a typewriter');
  else fail(`hero headline unexpected: "${r.headlineText}"`);

  /*
   * Scroll-scrubbed effects need checking SEPARATELY from animations.
   *
   * `MotionConfig reducedMotion="user"` switches transform animations off, but
   * a `useScroll` → `useTransform` value bound through `style` is a live
   * binding, not an animation — it is untouched. Every one of these drives
   * VISIBILITY, so getting it wrong does not merely leave motion on: it leaves
   * the element permanently invisible, because nothing advances a bound value
   * once animations are disabled. That is the regression these three catch.
   */
  const scrubbed = await page.evaluate(() => {
    const numeral = document.querySelector('.text-7xl.font-bold.tracking-tighter')?.closest('div');
    const spine = document.querySelector('#workflow .origin-top');
    const shield = document.querySelector('#security svg path, section svg path[stroke-linecap="round"]');
    const magnetic = document.querySelector('a[href="/start-trial"]')?.parentElement;
    const t = (el) => (el ? getComputedStyle(el).transform : 'none');
    return {
      numeralOpacity: numeral ? getComputedStyle(numeral).opacity : 'missing',
      spineTransform: t(spine),
      shieldDash: shield ? getComputedStyle(shield).strokeDasharray : 'missing',
      magneticTransform: t(magnetic),
    };
  });

  if (scrubbed.numeralOpacity === '1') pass('section numerals are visible under reduced motion');
  else fail(`section numeral opacity is ${scrubbed.numeralOpacity} — the scrub left it invisible`);

  // scaleY(1) shows as matrix(1, 0, 0, 1, …); scaleY(0) as matrix(1, 0, 0, 0, …).
  if (!/matrix\(1,\s*0,\s*0,\s*0/.test(scrubbed.spineTransform)) {
    pass('workflow timeline spine is drawn under reduced motion');
  } else {
    fail(`workflow spine is collapsed (${scrubbed.spineTransform})`);
  }

  if (!/translate|matrix\((?!1,\s*0,\s*0,\s*1,\s*0,\s*0)/.test(scrubbed.magneticTransform)) {
    pass('magnetic buttons carry no transform under reduced motion');
  } else {
    fail(`magnetic button still transformed (${scrubbed.magneticTransform})`);
  }

  await page.close();
}

await browser.close();

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All landing checks passed.');
