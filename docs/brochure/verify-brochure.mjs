/**
 * Refuse to ship a brochure that claims something the product does not do.
 *
 *   node docs/brochure/verify-brochure.mjs
 *
 * WHY THIS EXISTS. The previous product guide described comp-off as a working
 * feature, overtime as a fixed 2× rate, cost centres and CTC planning as
 * shipped, and four of the twenty-three statutory documents as preparation
 * sheets. A backend verification audit found that none of those were true —
 * nothing anywhere writes a comp-off balance, the overtime rate is configured
 * per policy, three of those services reference model classes that do not
 * exist, and the real preparation-sheet count is seven.
 *
 * A document is the worst place for a claim like that to survive, because it
 * leaves the building. So the banned phrases are checked mechanically rather
 * than trusted to whoever edits the file next.
 *
 * The check reads the RENDERED page text, not the HTML source, so a claim
 * cannot hide inside an attribute or a comment — and the comments in
 * brochure.html are free to discuss the very phrases that are banned.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(here, 'brochure.html');

/**
 * Each entry: the pattern, why it is banned, and what to say instead.
 * Keeping the correction beside the ban means a failure is actionable rather
 * than just a red line.
 */
const BANNED = [
  [/comp[\s-]?off|compensatory off/i,
    'comp-off does not work — nothing writes a balance',
    'remove it; do not offer it as an alternative to being paid'],
  [/double the (normal )?hourly rate|twice the hourly rate|\b2×\s*(the )?(normal|hourly)/i,
    'overtime has no fixed multiplier',
    'say the company sets the rate, separately per kind of day'],
  [/cost cent(re|er)/i,
    'the cost-centre service references classes that do not exist',
    'remove; the Tally/Zoho journal export is real and can stay'],
  [/department budget/i, 'dead service', 'remove'],
  [/CTC plann|burn rate/i, 'dead service', 'remove'],
  [/garnishment/i, 'dead service', 'remove'],
  [/on[\s-]demand salary/i, 'dead service', 'remove'],
  [/four of the 23|4 of the 23/i,
    'the preparation-sheet count is seven, not four',
    'say 16 returns and 7 preparation sheets'],
  [/19 (of them )?(are )?returns|nineteen returns/i,
    'the return count is 16, not 19',
    'say 16 returns'],
  // Fabricated social proof — the same list the websites are held to.
  [/10,?000\+/i, 'fabricated user count', 'remove'],
  [/500\+\s*(workspaces|companies|teams)/i, 'fabricated workspace count', 'remove'],
  [/32\s*%\s*(avg|average)?\s*productivity/i, 'fabricated productivity lift', 'remove'],
  [/4\.8\s*\/\s*5|\bavg\.?\s*rating\b/i, 'review score we do not have', 'remove'],
  [/99\.\d+\s*%\s*uptime/i, 'uptime figure we cannot defend', 'remove'],
  [/trusted by \d/i, 'fabricated trust claim', 'remove'],
];

/**
 * A claim and a disclosure read the same to a regular expression.
 * "There is no ISO 27001 certificate" must be allowed; "ISO 27001 certified"
 * must not. Look at the surrounding sentence for a negation.
 */
const isDisclosure = (text, at) =>
  /\bno\b|\bnot\b|\bneither\b|cannot|\bwithout\b|\?/i.test(
    text.slice(Math.max(0, at - 160), at + 160)
  );

const SOFT = [
  [/\bSOC ?2\b/i, 'SOC 2 claim'],
  [/\bISO ?27001\b/i, 'ISO 27001 claim'],
];

let failures = 0;
const fail = (m) => { failures++; console.log(`FAIL  ${m}`); };
const pass = (m) => console.log(`PASS  ${m}`);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('file:///' + SOURCE.replace(/\\/g, '/'), { waitUntil: 'load' });
await page.emulateMedia({ media: 'print' });

const text = await page.evaluate(() => document.body.innerText);
const pages = await page.evaluate(() => document.querySelectorAll('.page').length);

/* ── 1 · Disproved and fabricated claims ─────────────────────────────── */
let banned = 0;
for (const [pattern, why, instead] of BANNED) {
  const m = text.match(pattern);
  if (m) {
    fail(`"${m[0].trim()}" — ${why}. Instead: ${instead}`);
    banned++;
  }
}
for (const [pattern, why] of SOFT) {
  const re = new RegExp(pattern.source, pattern.flags + 'g');
  for (const m of text.matchAll(re)) {
    if (isDisclosure(text, m.index ?? 0)) continue;
    fail(`"${m[0].trim()}" — ${why} stated as fact rather than disclosed`);
    banned++;
  }
}
if (!banned) pass(`no disproved or fabricated claims in ${text.length} characters of copy`);

/* ── 2 · Length, measured on the PDF rather than the DOM ─────────────── */
/*
 * Counting `.page` sections tells you what the HTML intends, not what the
 * printer produced. A section 6mm taller than the page box silently becomes
 * two sheets — which is exactly what happened here: 20 sections rendered as a
 * 21-page PDF, and a DOM count reported success.
 *
 * So the authoritative count comes from the artefact. The DOM count is still
 * checked, because a mismatch between the two is the signal that something is
 * overflowing.
 */
const pdfPath = join(here, 'CareVance-Product-Guide.pdf');
if (!existsSync(pdfPath)) {
  fail('no PDF found — run `node docs/brochure/build.mjs` first');
} else {
  const raw = readFileSync(pdfPath).toString('latin1');
  const pdfPages = (raw.match(/\/Type\s*\/Page[^s]/g) ?? []).length;

  if (pdfPages !== pages) {
    fail(`${pages} sections became ${pdfPages} PDF pages — something overflows its page box`);
  }
  if (pdfPages >= 18 && pdfPages <= 20) pass(`${pdfPages} PDF pages, within the 18-20 target`);
  else fail(`${pdfPages} PDF pages — the target is 18 to 20`);
}

/* ── 3 · The corrections are actually present ────────────────────────── */
const MUST_SAY = [
  ['16 are', 'the corrected return count'],
  ['7 are', 'the corrected preparation-sheet count'],
  ['no fixed multiplier', 'the corrected overtime wording'],
  ['ISO 27001', 'the honest certification disclosure'],
];
let missing = 0;
for (const [needle, why] of MUST_SAY) {
  if (text.includes(needle)) continue;
  fail(`missing "${needle}" — ${why} is not in the document`);
  missing++;
}
if (!missing) pass(`all ${MUST_SAY.length} required corrections are present`);

/* ── 4 · Jargon is defined before it is leaned on ────────────────────── */
const GLOSSARY = ['Provident Fund', 'Employees’ State Insurance', 'Professional Tax', 'Tax Deducted at Source'];
const undefinedTerms = GLOSSARY.filter((t) => !text.includes(t));
if (!undefinedTerms.length) pass('statutory abbreviations are expanded for a first-time reader');
else fail(`these abbreviations are never expanded: ${undefinedTerms.join(', ')}`);

await browser.close();

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('Brochure verified.');
