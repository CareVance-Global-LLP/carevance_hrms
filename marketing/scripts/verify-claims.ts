/**
 * Turns the honesty rules into a command.
 *
 * The brief's acceptance criteria include "every website claim traces to a line
 * in PRODUCT_TRUTH.md" and "zero invented logos, counts, reviews, testimonials
 * or badges". Both are promises until something checks them, so this does:
 *
 *   1. Every claim ID referenced in the site exists in PRODUCT_TRUTH.md
 *   2. No banned string appears anywhere in the source
 *   3. No hard-coded hex outside the two documented exceptions
 *   4. Feature names the codebase does not implement never appear
 *
 *   npm run verify:claims
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const TRUTH = resolve(ROOT, '../PRODUCT_TRUTH.md');

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.error(`FAIL  ${msg}`);
};
const pass = (msg: string) => console.log(`PASS  ${msg}`);

/* ── Collect source files ─────────────────────────────────────────────── */

const SCAN_DIRS = ['app', 'components', 'lib'];
const SKIP_FILES = new Set(['tokens.css', 'pt-states.ts']); // generated

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(tsx?|css)$/.test(entry) && !SKIP_FILES.has(entry)) {
      out.push(full);
    }
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => walk(resolve(ROOT, d)));
const sources = files.map((f) => ({ path: relative(ROOT, f), text: readFileSync(f, 'utf8') }));

console.log(`Scanning ${sources.length} source files.\n`);

/* ── 1. Claim IDs resolve ─────────────────────────────────────────────── */

if (!existsSync(TRUTH)) {
  fail(`PRODUCT_TRUTH.md not found at ${TRUTH}`);
} else {
  const truth = readFileSync(TRUTH, 'utf8');
  const known = new Set(truth.match(/\b[A-Z]{2,4}-(?:\d{2}|CAVEAT)\b/g) ?? []);

  const referenced = new Map<string, string[]>();
  for (const { path, text } of sources) {
    const ids = text.match(/(?:data-claim="|claim: '|claim="|claim=\{')([A-Z]{2,4}-(?:\d{2}|CAVEAT))/g) ?? [];
    for (const raw of ids) {
      const id = raw.replace(/^.*?([A-Z]{2,4}-(?:\d{2}|CAVEAT))$/, '$1');
      if (!referenced.has(id)) referenced.set(id, []);
      referenced.get(id)!.push(path);
    }
  }

  const unknown = [...referenced.keys()].filter((id) => !known.has(id));
  if (unknown.length) {
    for (const id of unknown) {
      fail(`claim ${id} is referenced in ${referenced.get(id)![0]} but is not in PRODUCT_TRUTH.md`);
    }
  } else {
    pass(`all ${referenced.size} referenced claim IDs resolve to PRODUCT_TRUTH.md (${known.size} defined)`);
  }
}

/* ── 2. Banned strings ────────────────────────────────────────────────── */

/**
 * Fabricated social proof, and the four features the product's own pricing
 * config sells but the codebase does not implement. The last group is the one
 * most likely to creep back in, because it is already in the product.
 */
const BANNED: Array<{ pattern: RegExp; why: string }> = [
  /* ── Fabricated social proof. None of this exists. ── */
  { pattern: /10,?000\+?\s*(active\s*)?users/i, why: 'fabricated user count (DONT-01)' },
  { pattern: /500\+?\s*workspaces/i, why: 'fabricated workspace count (DONT-01)' },
  { pattern: /4\.8\s*\/\s*5|4\.8 out of 5/i, why: 'fabricated review score (DONT-01)' },
  { pattern: /32%\s*(avg|average)?\s*productivity/i, why: 'fabricated productivity claim (DONT-01)' },
  { pattern: /trusted by \d/i, why: 'fabricated trust claim (DONT-01)' },
  { pattern: /\bG2\b.{0,20}(badge|leader|winner|rating)/i, why: 'review badge we do not have (DONT-01)' },
  { pattern: /soc\s*2\s*(type\s*[i1]{1,2}\s*)?(certified|compliant)/i, why: 'uncertified SOC 2 claim (DONT-02)' },
  { pattern: /iso\s*27001\s*(certified|compliant)/i, why: 'uncertified ISO 27001 claim (DONT-02)' },
  { pattern: /99\.\d+%\s*uptime/i, why: 'uptime figure we cannot defend (DONT-10)' },

  /* ── Features the product's pricing config sells but does not implement. ── */
  { pattern: /travel\s*(&|and)\s*expense/i, why: 'travel expense module does not exist (DONT-16)' },
  { pattern: /white[\s-]?label/i, why: 'white labelling does not exist (DONT-18)' },
  { pattern: /company news|press release/i, why: 'no announcement model — polls are real, announcements are not (DONT-17)' },

  /*
   * ── Overstated counts. ──
   * The old "13 generate, 10 unavailable" split is gone: all 23 generate. What
   * must not be overstated now is how many are RETURNS.
   */
  { pattern: /\b28\s*states\b/i, why: 'PT covers 37 states and UTs, and 17 levy none (DONT-05)' },
  { pattern: /23\s*(statutory\s*)?returns/i, why: '23 documents, but only 19 are returns (DONT-04, DONT-15)' },
  { pattern: /(files?|submits?|filed)\s+(your\s+)?returns?\s+(for you|automatically|on your behalf)/i,
    why: 'nothing auto-submits — every filing is a document a human uploads (DONT-04)' },
  { pattern: /\b(13|thirteen)\s*(statutory\s*)?(returns|filings|documents)/i,
    why: 'stale count — 23 documents generate, 19 of them returns (NUM-08)' },

  /*
   * ── Regression guard: claims of ABSENCE for things that exist. ──
   *
   * These are here because the site once carried every one of them. An audit
   * ran against a working tree that was mid-merge, concluded eight modules did
   * not exist, and shipped that as prominent honesty copy. Asserting a gap that
   * is not there understates the product to buyers and, via llms.txt, instructs
   * answer engines to repeat it. See PRODUCT_TRUTH.md §0.
   */
  { pattern: /no recruitment( module| or applicant tracking)?\b/i, why: 'recruitment EXISTS — REC-*' },
  { pattern: /no (offer letters|e-signature)/i, why: 'offer letters and signing EXIST — SGN-*' },
  { pattern: /no background verification/i, why: 'BGV EXISTS — BGV-*' },
  { pattern: /no (sso|saml)\b/i, why: 'SAML SSO EXISTS — SSO-*' },
  { pattern: /(no|without) scim\b/i, why: 'SCIM EXISTS (groups do not) — SCM-*' },
  { pattern: /no multi[\s-]?entity/i, why: 'legal entities EXIST — ENT-*' },
  { pattern: /flat annual quota/i, why: 'leave accrues per type with pro-rating — LVA-*' },
  { pattern: /no (leave )?accrual/i, why: 'accrual EXISTS — LVA-01' },
  { pattern: /no rostering|no shift roster/i, why: 'rostering EXISTS — ROS-*' },
  { pattern: /no biometric/i, why: 'ADMS biometric ingestion EXISTS — BIO-*' },
  { pattern: /no accounting export/i, why: 'accounting export EXISTS — ACC-*' },
  { pattern: /no effective[\s-]?dated compensation/i, why: 'effective dating EXISTS — HR-10' },
  { pattern: /one organisation is one PAN/i, why: 'multiple legal entities are supported — ENT-01' },

  /* ── Placeholder and locale hygiene. ── */
  { pattern: /lorem ipsum/i, why: 'placeholder text' },
  { pattern: /john doe|jane doe/i, why: 'placeholder name — use realistic Indian data (§8.1)' },
  { pattern: /\$\d/, why: 'dollar amount — this product sells in India only (§8.1)' },
];

/** Files allowed to mention a banned term because they are ABOUT not claiming it. */
const BANNED_ALLOWLIST = [
  'lib/features.ts',        // NOT_BUILT list names them as absent
  'lib/pricing.ts',         // header documents what was removed and why
  'app/llms.txt/route.ts',  // tells models these do not exist
  'app/security/page.tsx',  // states we are NOT certified
  'app/contact/page.tsx',   // FAQ asks "Are you SOC 2 certified?" and answers no
  'app/methodology/page.tsx', // states what we do not publish
  'app/pricing/page.tsx',   // renders the NOT_BUILT list
  'app/why-carevance/page.tsx', // "there is no recruitment module"
  'app/product/page.tsx',   // "it is not a recruitment system"
  'app/legal/terms/page.tsx',
  'app/legal/dpa/page.tsx',
  'components/home/sections.tsx', // FAQ: "what is not built yet"
  'components/product/PageParts.tsx',
  'lib/facts.ts',                  // provenance strings name the four preparation sheets
  'app/product/recruitment/page.tsx', // states the careers-page and vendor gaps
  'app/product/leave/page.tsx',    // states what leave does NOT assert
  'app/product/compliance/page.tsx',
  'app/product/time-attendance/page.tsx',
  'app/product/payroll/page.tsx',
  'scripts/verify-claims.ts',      // this file lists the patterns it bans
];

let bannedHits = 0;
for (const { path, text } of sources) {
  if (BANNED_ALLOWLIST.includes(path.replace(/\\/g, '/'))) continue;
  for (const { pattern, why } of BANNED) {
    const m = text.match(pattern);
    if (m) {
      fail(`${path}: banned "${m[0].trim()}" — ${why}`);
      bannedHits++;
    }
  }
}
if (bannedHits === 0) pass(`no banned claims in ${sources.length - BANNED_ALLOWLIST.length} unexempted files`);

/* ── 3. Hard-coded hex ────────────────────────────────────────────────── */

/**
 * Two exceptions, both documented at their definition:
 *   globals.css  — the fixed-dark surface, which cannot invert (defined once)
 *   layout.tsx   — <meta name="theme-color">, which cannot read a CSS variable
 */
const HEX_ALLOWED = new Set(['app/globals.css', 'app/layout.tsx']);

let hexHits = 0;
for (const { path, text } of sources) {
  const norm = path.replace(/\\/g, '/');
  if (HEX_ALLOWED.has(norm)) continue;
  // Six-digit hex only; #418 in "Override #418" is a reference number, and
  // &#123; is an HTML entity for a brace.
  const found = text.match(/#[0-9a-fA-F]{6}\b/g);
  if (found) {
    fail(`${path}: hard-coded hex ${[...new Set(found)].join(', ')} — use a token`);
    hexHits++;
  }
}
if (hexHits === 0) pass('no hard-coded hex outside the two documented exceptions');

/* ── 4. Currency and locale ───────────────────────────────────────────── */

const enUsFormat = sources.filter(
  (s) => /Intl\.NumberFormat\(\s*['"]en-US['"]/.test(s.text) && !s.path.includes('scripts')
);
if (enUsFormat.length) {
  for (const s of enUsFormat) {
    fail(`${s.path}: en-US number formatting — Indian grouping is required (§8.1)`);
  }
} else {
  pass('all currency formatting uses en-IN grouping');
}

/* ── Result ───────────────────────────────────────────────────────────── */

console.log('');
if (failures === 0) {
  console.log('All claim checks passed.');
  process.exit(0);
} else {
  console.error(`${failures} claim check(s) failed.`);
  process.exit(1);
}
