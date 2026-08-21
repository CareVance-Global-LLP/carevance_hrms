/**
 * Spot-checks the ported arithmetic against the product engine's own figures.
 * Run after any edit to lib/calc.ts. This is the guard on the claim that the
 * free calculators share the product's arithmetic.
 */
import { salaryBreakup, taxNewRegime, taxOldRegime, gratuity, hraExemption, employerPF, esi } from '../lib/calc';
import { professionalTax } from '../lib/pt-states';

let failed = 0;
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

function check(
  label: string,
  actual: number | string,
  expected: number | string,
  tol = 0.02
): void {
  const ok =
    typeof actual === 'number' && typeof expected === 'number'
      ? near(actual, expected, tol)
      : actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n      got ${actual}  want ${expected}`);
}

// The demo employee: ₹14,40,000 CTC, Mumbai (metro), Maharashtra.
const b = salaryBreakup({ annualCtc: 1440000, isMetro: true, stateCode: 'maharashtra' });
check('basic', b.basic, 48000);
check('hra', b.hra, 24000);
check('employer PF total', b.employerPf.total, 1800);
check('employer PF — EPS', b.employerPf.eps, 1249.5);
check('employer PF — EPF', b.employerPf.epf, 550.5);
check('gratuity provision', b.gratuityProvision, 2308.8);
check('special (residual)', b.special, 42291.2);
check('gross', b.gross, 115891.2);
check('CTC balances', b.gross + b.employerPf.total + b.gratuityProvision, 120000);
check('employee PF', b.employeePf, 1800);
check('ESI (above threshold)', b.esiEmployee, 0);
check('PT Maharashtra', b.pt, 200);
check('TDS monthly (new)', b.tdsNew, 6704.03, 0.05);
check('net monthly', b.netMonthly, 107187.17, 0.05);

// Sec 87A marginal relief — the band the engine had a bug in.
const justUnder = taxNewRegime(1275000);   // taxable 12,00,000 -> full rebate
check('87A full rebate at 12L taxable', justUnder.totalTax, 0);
const justOver = taxNewRegime(1285000);    // taxable 12,10,000 -> marginal relief
check('87A marginal relief at 12.1L taxable', justOver.totalTax, 10400, 1);

// ESI boundary.
check('ESI covered at 21,000', esi(21000).employee, 157.5);
check('ESI not covered at 21,001', esi(21001).employee, 0);

// Gratuity: five-year floor and the statutory ceiling.
check('gratuity under 5 years pays nil', gratuity(50000, 4.5).amount, 0);
check('gratuity at 6 years', gratuity(50000, 6).amount, 173076.92, 0.02);
check('gratuity ceiling applies', gratuity(500000, 30).amount, 2000000);

// HRA least-of-three.
const h = hraExemption(300000, 600000, 360000, true);
check('HRA exemption (metro)', h.exempt, 300000);
const h2 = hraExemption(300000, 600000, 180000, false);
check('HRA exemption (rent-limb binds)', h2.exempt, 120000);

// PT: a state that levies nothing must return zero, not a neighbour's slab.
check('PT Delhi (no PT)', professionalTax('delhi', 100000), 0);
check('PT Maharashtra February top band', professionalTax('maharashtra', 100000, 2), 300);
check('PT Karnataka under threshold', professionalTax('karnataka', 14000), 0);
check('PT Karnataka over threshold', professionalTax('karnataka', 30000), 200);

// Old regime, fully loaded.
const old = taxOldRegime(1390694.4, { section80c: 150000, section80d: 25000, section80ccd1b: 50000 });
check('old regime taxable', old.taxableIncome, 1115694.4);

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} CHECK(S) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
