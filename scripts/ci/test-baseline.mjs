#!/usr/bin/env node
/**
 * Gate a test suite on *new* failures rather than on the total.
 *
 * Both suites carry a tail of pre-existing failures. Gating on the count means
 * CI is permanently red and stops being read; ignoring the suites entirely —
 * which is what happens today — means a regression reaches production unnoticed.
 * This compares the set of failing test names against a committed baseline and
 * fails only when a name appears that was not already failing.
 *
 * Usage:
 *   node scripts/ci/test-baseline.mjs --junit <file> --baseline <file> --check
 *   node scripts/ci/test-baseline.mjs --junit <file> --baseline <file> --update
 *
 * A fixed test is reported too, so the baseline can be trimmed deliberately
 * rather than drifting.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
};

const junitPath = valueOf('--junit');
const baselinePath = valueOf('--baseline');
const update = args.includes('--update');
const label = valueOf('--label') ?? 'suite';

if (!junitPath || !baselinePath) {
  console.error('usage: test-baseline.mjs --junit <file> --baseline <file> [--check|--update] [--label name]');
  process.exit(2);
}

if (!existsSync(junitPath)) {
  console.error(`[${label}] JUnit report not found at ${junitPath}.`);
  console.error('The suite likely failed to start — that is a real failure, not a baseline miss.');
  process.exit(1);
}

const xml = readFileSync(junitPath, 'utf8');

/*
 * Attribute order is not guaranteed across reporters — PHPUnit writes
 * name before class, vitest the other way — so each testcase tag is read as a
 * bag of attributes rather than matched positionally.
 */
// Reporters XML-escape test names; decode so the baseline stays readable and
// greppable against the source.
const decode = (s) =>
  s.replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const failing = new Set();

/*
 * The attribute group is non-greedy on purpose.
 *
 * With a greedy `[^>]*` it consumed the `/` of a self-closing `<testcase … />`,
 * so the `/>` branch never matched and the tag was treated as having a body —
 * which then ran on to the NEXT `</testcase>`. A passing test therefore
 * inherited the following failing test's <failure> node and was reported as a
 * new regression, while the test that actually failed was swallowed by the same
 * match and never seen. Every gate run was quietly reporting the wrong names.
 */
for (const match of xml.matchAll(/<testcase\b([^>]*?)\s*(\/>|>([\s\S]*?)<\/testcase>)/g)) {
  const [, attrs, selfClosing, body] = match;

  // Self-closing testcases passed; only a body can carry failure or error.
  if (selfClosing === '/>' || !body) continue;
  if (!/<(failure|error)\b/.test(body)) continue;

  const attr = (key) => {
    const m = attrs.match(new RegExp(`\\b${key}="([^"]*)"`));
    return m ? m[1] : '';
  };

  const suite = decode(attr('class') || attr('classname') || attr('file'));
  const name = decode(attr('name'));
  if (name) failing.add(`${suite}::${name}`);
}

const current = [...failing].sort();

if (update) {
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(baselinePath, current.join('\n') + (current.length ? '\n' : ''), 'utf8');
  console.log(`[${label}] baseline written: ${current.length} known failures`);
  process.exit(0);
}

const baseline = existsSync(baselinePath)
  ? readFileSync(baselinePath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
  : [];

const known = new Set(baseline);
const regressions = current.filter((t) => !known.has(t));
const fixed = baseline.filter((t) => !failing.has(t));

console.log(`[${label}] failing now: ${current.length}   baseline: ${baseline.length}`);

if (fixed.length) {
  console.log(`\n[${label}] ${fixed.length} test(s) no longer failing — trim these from the baseline:`);
  fixed.forEach((t) => console.log(`  - ${t}`));
}

if (regressions.length) {
  console.error(`\n[${label}] ${regressions.length} NEW failure(s):`);
  regressions.forEach((t) => console.error(`  + ${t}`));
  console.error(
    `\nEither fix them, or if the change is intended run:\n` +
    `  node scripts/ci/test-baseline.mjs --junit ${junitPath} --baseline ${baselinePath} --update`
  );
  process.exit(1);
}

console.log(`\n[${label}] no new failures.`);
process.exit(0);
