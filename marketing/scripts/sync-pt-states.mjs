/**
 * Regenerates lib/pt-states.ts from the product's PTStateService.
 *
 * The professional-tax calculator at /tools/professional-tax-by-state is the
 * differentiated one in the free-tool cluster — nobody in this market does it
 * well, and being RIGHT when the competition's calculators are wrong is the
 * whole asset. That only holds if the slabs come from the engine rather than
 * from someone retyping 37 states out of a blog post.
 *
 *   node scripts/sync-pt-states.mjs
 *   node scripts/sync-pt-states.mjs --check
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(here, '../../backend/app/Services/PTStateService.php');
const TARGET = resolve(here, '../lib/pt-states.ts');

if (!existsSync(SOURCE)) {
  console.error(`sync-pt-states: cannot find ${SOURCE}`);
  process.exit(1);
}

const php = readFileSync(SOURCE, 'utf8');

/* ── Display names and state/UT typing, from getStates() ──────────────── */

const names = new Map();
const nameRe =
  /\['code'\s*=>\s*'([a-z_]+)',\s*'name'\s*=>\s*'([^']+)',\s*'type'\s*=>\s*'(state|ut)'\]/g;
let m;
while ((m = nameRe.exec(php)) !== null) {
  names.set(m[1], { name: m[2].replace(/&/g, '&'), type: m[3] });
}

/* ── Slab table, from STATE_CONFIGS ───────────────────────────────────── */

const configStart = php.indexOf('STATE_CONFIGS = [');
const configEnd = php.indexOf('public static function getStates');
if (configStart === -1 || configEnd === -1) {
  console.error('sync-pt-states: STATE_CONFIGS shape changed — parser needs updating.');
  process.exit(1);
}
const configBody = php.slice(configStart, configEnd);

// Each top-level entry sits at exactly 8 spaces of indentation.
const entryRe = /^ {8}'([a-z_]+)' => \[$/gm;
const starts = [];
while ((m = entryRe.exec(configBody)) !== null) {
  starts.push({ code: m[1], at: m.index });
}

const states = [];

for (let i = 0; i < starts.length; i++) {
  const { code, at } = starts[i];
  const end = i + 1 < starts.length ? starts[i + 1].at : configBody.length;
  const block = configBody.slice(at, end);

  const slabs = [];
  const slabRe =
    /\['min'\s*=>\s*(\d+),\s*'max'\s*=>\s*(null|\d+),\s*'amount'\s*=>\s*([\d.]+)\]/g;
  let s;
  while ((s = slabRe.exec(block)) !== null) {
    slabs.push({
      min: Number(s[1]),
      max: s[2] === 'null' ? null : Number(s[2]),
      amount: Number(s[3]),
    });
  }

  // Maharashtra's higher February instalment, and anything shaped like it.
  const feb = block.match(/'february'\s*=>\s*(\d+)/);

  const meta = names.get(code) ?? { name: code, type: 'state' };

  states.push({
    code,
    name: meta.name,
    type: meta.type,
    slabs,
    februaryAmount: feb ? Number(feb[1]) : null,
    levies: slabs.some((sl) => sl.amount > 0),
  });
}

if (states.length < 30) {
  console.error(`sync-pt-states: parsed only ${states.length} states — parser is wrong.`);
  process.exit(1);
}

states.sort((a, b) => a.name.localeCompare(b.name));

const levying = states.filter((s) => s.levies).length;

const out = `/*
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source of truth: backend/app/Services/PTStateService.php
 * Regenerate with:  node scripts/sync-pt-states.mjs
 *
 * ${states.length} states and union territories, of which ${levying} actually levy
 * professional tax. The ${states.length - levying} that do not are included deliberately:
 * a calculator that silently omits them leaves the reader guessing, and the
 * product's own behaviour is to return ₹0 rather than default to a neighbour.
 */

export interface PtSlab {
  min: number;
  /** null = no upper bound. */
  max: number | null;
  amount: number;
}

export interface PtState {
  code: string;
  name: string;
  type: 'state' | 'ut';
  slabs: PtSlab[];
  /** Some states levy a higher instalment in February. */
  februaryAmount: number | null;
  levies: boolean;
}

export const PT_STATES: readonly PtState[] = ${JSON.stringify(states, null, 2)} as const;

export const PT_STATE_COUNT = ${states.length};
export const PT_LEVYING_COUNT = ${levying};
export const PT_NIL_COUNT = ${states.length - levying};

/**
 * Monthly professional tax, mirroring PTStateService::calculate().
 *
 * The February rule applies only to the TOP band — a state's higher instalment
 * exists so the annual total reaches the statutory ceiling, and applying it to
 * a lower slab would overcharge someone the ceiling was never about.
 */
export function professionalTax(
  stateCode: string,
  monthlyGross: number,
  month?: number
): number {
  const state = PT_STATES.find((s) => s.code === stateCode.toLowerCase());
  if (!state) return 0;

  const slab = state.slabs.find(
    (sl) => monthlyGross >= sl.min && (sl.max === null || monthlyGross <= sl.max)
  );
  if (!slab) return 0;

  const isTopBand = state.slabs[state.slabs.length - 1] === slab;
  if (month === 2 && state.februaryAmount !== null && isTopBand) {
    return state.februaryAmount;
  }

  return slab.amount;
}

/** Annual professional tax, accounting for any February special rate. */
export function annualProfessionalTax(stateCode: string, monthlyGross: number): number {
  let total = 0;
  for (let month = 1; month <= 12; month++) {
    total += professionalTax(stateCode, monthlyGross, month);
  }
  return total;
}

export function getPtState(code: string): PtState | undefined {
  return PT_STATES.find((s) => s.code === code.toLowerCase());
}
`;

const check = process.argv.includes('--check');
const current = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : null;

if (check) {
  if (current !== out) {
    console.error('sync-pt-states: lib/pt-states.ts is stale. Run `npm run sync:pt`.');
    process.exit(1);
  }
  console.log(`sync-pt-states: up to date (${states.length} states, ${levying} levying).`);
} else {
  writeFileSync(TARGET, out, 'utf8');
  console.log(
    `sync-pt-states: wrote lib/pt-states.ts — ${states.length} states/UTs, ${levying} levy PT, ${
      states.length - levying
    } do not.`
  );
}
