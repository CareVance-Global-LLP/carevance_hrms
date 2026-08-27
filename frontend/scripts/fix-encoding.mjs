/**
 * Find — and optionally repair — UTF-8 text that was read as Windows-1252 and
 * re-saved as UTF-8.
 *
 *   node scripts/fix-encoding.mjs          # report only
 *   node scripts/fix-encoding.mjs --write  # repair in place
 *
 * WHY THIS IS A COMMITTED SCRIPT AND NOT A ONE-OFF. Windows PowerShell 5.1's
 * `Get-Content` reads in the console's ANSI codepage, so any read-modify-write
 * through it silently mangles every non-ASCII character in the file: ’ becomes
 * â€™, ₹ becomes â‚¹, — becomes â€”. This codebase is full of ₹, en-dashes and
 * curly quotes, and the damage renders straight onto the page — a landing-page
 * heading shipped reading "doesnâ€™t talk to your HRMS" because of exactly this.
 * It is invisible in a diff unless you are looking for it and trivially
 * repeatable, so the check belongs in the repo.
 *
 * THE DAMAGED SEQUENCES ARE DERIVED, NOT TYPED. Writing them as literals puts
 * mojibake into the file meant to remove it, where the next accident mangles it
 * again. For each character we care about, the corrupted form is produced by
 * doing precisely what went wrong: encode UTF-8, decode as 1252.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const WRITE = process.argv.includes('--write');

/** Characters this codebase actually uses that survive the trip badly. */
const CHARS = [
  '’', // ’ right single quote
  '‘', // ‘ left single quote
  '“', // " left double quote
  '”', // " right double quote
  '—', // — em dash
  '–', // – en dash
  '…', // … ellipsis
  '₹', // ₹ rupee
  '→', // → right arrow
  '←', // ← left arrow
  '§', // § section
  '·', // · middle dot
  '±', // ± plus-minus
  '°', // ° degree
  '─', // ─ box drawing (used in comment rules)
  ' ', // non-breaking space
];

/**
 * cp1252, NOT latin1 — this distinction is the whole correctness of the script.
 *
 * The two encodings agree everywhere except 0x80–0x9F, which latin1 leaves as
 * control characters and cp1252 maps to €, ‚, ", ', –, — and friends. Every
 * character that actually gets mangled in practice has a UTF-8 byte in that
 * range, so deriving the damaged form with latin1 produces sequences that never
 * occur — a scanner that finds nothing and a repair that fixes nothing, while
 * reporting success. That is exactly what happened here: a "clean" scan while
 * the page was rendering "activity â€" recorded".
 */
const CP1252_HIGH = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…',
  0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š',
  0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’',
  0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ',
  0x9e: 'ž', 0x9f: 'Ÿ',
};

/** Reproduce the fault: UTF-8 bytes, read back through cp1252. */
const toMojibake = (good) =>
  [...Buffer.from(good, 'utf8')]
    .map((b) => (b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b] ?? String.fromCharCode(b) : String.fromCharCode(b)))
    .join('');

const PAIRS = CHARS.map((good) => [toMojibake(good), good])
  .filter(([bad, good]) => bad !== good)
  // Longest first, so a 3-byte sequence is consumed before a 2-byte prefix of it.
  .sort((a, b) => b[0].length - a[0].length);

/*
 * Roots default to this app, but any path can be passed — the same fault hits
 * the marketing site, which is edited from the same machine and the same shell.
 *
 *   node scripts/fix-encoding.mjs ../marketing/app ../marketing/components
 */
const roots = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const targets = roots.length ? roots : ['src', 'index.html'];

const files = [];
const walk = (p) => {
  let s;
  try {
    s = statSync(p);
  } catch {
    console.log(`skipped (not found): ${p}`);
    return;
  }
  if (s.isDirectory()) {
    if (/node_modules|dist|\.next|\.git/.test(p)) return;
    for (const e of readdirSync(p)) walk(join(p, e));
  } else if (/\.(tsx?|css|html|mjs|json|md)$/.test(p)) {
    files.push(p);
  }
};
for (const t of targets) walk(t);

let damaged = 0;
let repaired = 0;

for (const f of files) {
  let raw = readFileSync(f);
  const hadBom = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
  let text = (hadBom ? raw.subarray(3) : raw).toString('utf8');

  const before = text;
  for (const [bad, good] of PAIRS) {
    if (text.includes(bad)) text = text.split(bad).join(good);
  }

  if (text === before && !hadBom) continue;
  if (text === before && hadBom) continue; // a lone BOM is harmless; leave it.

  damaged++;
  const line = before.split('\n').findIndex((l) => PAIRS.some(([bad]) => l.includes(bad))) + 1;
  if (WRITE) {
    writeFileSync(f, Buffer.from(text, 'utf8'));
    repaired++;
    console.log(`repaired  ${f}:${line}`);
  } else {
    console.log(`DAMAGED   ${f}:${line}`);
  }
}

console.log('');
if (!damaged) {
  console.log(`Clean: ${files.length} files scanned, no mojibake.`);
  process.exit(0);
}
if (WRITE) {
  console.log(`${repaired} file(s) repaired.`);
  process.exit(0);
}
console.log(`${damaged} file(s) damaged. Re-run with --write to repair.`);
process.exit(1);
