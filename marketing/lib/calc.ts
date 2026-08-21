/**
 * The payroll arithmetic, ported from PayrollCalculatorService.
 *
 * These functions power the free calculators. They are a faithful port, not an
 * approximation, because the entire value of the tool cluster rests on being
 * RIGHT when the competition's calculators are wrong — and because a visitor
 * who checks our take-home figure against their actual payslip is running an
 * unsupervised trial of the payroll engine.
 *
 * Constants and behaviour verified against
 * backend/app/Services/PayrollCalculatorService.php on 20 Aug 2026.
 * FY 2025-26 figures. Re-check after each Finance Act.
 */

import { professionalTax, annualProfessionalTax } from './pt-states';

/* ── Constants, exactly as the engine holds them ──────────────────────── */

export const C = Object.freeze({
  PF_WAGE_CAP: 15000,
  EMPLOYEE_PF_RATE: 0.12,
  EMPLOYER_PF_RATE: 0.12,
  EPS_RATE: 0.0833,
  EPF_RATE: 0.0367,

  ESI_GROSS_THRESHOLD: 21000,
  ESI_EMPLOYEE_RATE: 0.0075,
  ESI_EMPLOYER_RATE: 0.0325,

  GRATUITY_RATE: 0.0481,
  GRATUITY_MIN_YEARS: 5,
  GRATUITY_MAX_PAYOUT: 2000000,

  STANDARD_DEDUCTION_NEW: 75000,
  STANDARD_DEDUCTION_OLD: 50000,
  REBATE_LIMIT_NEW: 1200000,
  REBATE_LIMIT_OLD: 500000,
  REBATE_MAX_OLD: 12500,
  SECTION_80C_CAP: 150000,
  SECTION_80CCD1B_CAP: 50000,
  SECTION_80D_CAP: 25000,
  SECTION_24B_CAP: 200000,
  HEALTH_EDUCATION_CESS: 0.04,

  DEFAULT_BASIC_PCT: 0.4,
  DEFAULT_HRA_PCT_METRO: 0.5,
  DEFAULT_HRA_PCT_NON_METRO: 0.4,
  DEFAULT_CONVEYANCE: 1600,
});

type Slab = { min: number; max: number; rate: number };

/** FY 2025-26. Sec 115BAC — the ₹4L exemption and 25% band are 2025-26. */
export const NEW_REGIME_SLABS: readonly Slab[] = Object.freeze([
  { min: 0, max: 400000, rate: 0 },
  { min: 400000, max: 800000, rate: 0.05 },
  { min: 800000, max: 1200000, rate: 0.1 },
  { min: 1200000, max: 1600000, rate: 0.15 },
  { min: 1600000, max: 2000000, rate: 0.2 },
  { min: 2000000, max: 2400000, rate: 0.25 },
  { min: 2400000, max: Infinity, rate: 0.3 },
]);

export const OLD_REGIME_SLABS: readonly Slab[] = Object.freeze([
  { min: 0, max: 250000, rate: 0 },
  { min: 250000, max: 500000, rate: 0.05 },
  { min: 500000, max: 1000000, rate: 0.2 },
  { min: 1000000, max: Infinity, rate: 0.3 },
]);

/** Boundaries are contiguous and half-open, so no income falls between bands. */
const SURCHARGE_SLABS = Object.freeze([
  { min: 5000000, max: 10000000, old: 0.1, new: 0.1 },
  { min: 10000000, max: 20000000, old: 0.15, new: 0.15 },
  { min: 20000000, max: 50000000, old: 0.25, new: 0.25 },
  { min: 50000000, max: Infinity, old: 0.37, new: 0.25 },
]);

function applySlabs(income: number, slabs: readonly Slab[]): number {
  let tax = 0;
  for (const slab of slabs) {
    if (income > slab.min) {
      tax += (Math.min(income, slab.max) - slab.min) * slab.rate;
    }
  }
  return tax;
}

function surcharge(taxBefore: number, totalIncome: number, regime: 'old' | 'new'): number {
  const band = SURCHARGE_SLABS.find((s) => totalIncome > s.min && totalIncome <= s.max);
  if (!band) return 0;
  return taxBefore * (regime === 'new' ? band.new : band.old);
}

/* ── Statutory heads ──────────────────────────────────────────────────── */

/** PF wages are capped at ₹15,000 unless the employer contributes above it. */
export function pfWages(basic: number, da = 0, aboveCap = false): number {
  const wages = basic + da;
  return aboveCap ? wages : Math.min(wages, C.PF_WAGE_CAP);
}

export function employeePF(basic: number, da = 0, aboveCap = false): number {
  return pfWages(basic, da, aboveCap) * C.EMPLOYEE_PF_RATE;
}

/**
 * The employer's 12% is not one number — it splits into the pension scheme and
 * the provident fund, and the split is what appears on an ECR return.
 */
export function employerPF(basic: number, da = 0, aboveCap = false) {
  const wages = pfWages(basic, da, aboveCap);
  const eps = wages * C.EPS_RATE;
  const epf = wages * C.EPF_RATE;
  return { total: wages * C.EMPLOYER_PF_RATE, eps, epf };
}

export function esi(gross: number) {
  const covered = gross <= C.ESI_GROSS_THRESHOLD;
  return {
    covered,
    employee: covered ? gross * C.ESI_EMPLOYEE_RATE : 0,
    employer: covered ? gross * C.ESI_EMPLOYER_RATE : 0,
  };
}

export { professionalTax, annualProfessionalTax };

/**
 * Gratuity on settlement — the guarded path.
 *
 * Two rules that the raw provision figure does not apply, and both matter:
 * service under five years pays nothing, and the payout is capped at the
 * statutory ceiling. A calculator that omits either overstates what someone is
 * owed, which is a cruel way to be wrong.
 */
export function gratuity(lastDrawnBasicPlusDA: number, yearsOfService: number) {
  const eligible = yearsOfService >= C.GRATUITY_MIN_YEARS;
  const raw = (lastDrawnBasicPlusDA * 15 * yearsOfService) / 26;
  const capped = Math.min(raw, C.GRATUITY_MAX_PAYOUT);

  return {
    eligible,
    raw,
    amount: eligible ? capped : 0,
    cappedByCeiling: eligible && raw > C.GRATUITY_MAX_PAYOUT,
    shortfallYears: eligible ? 0 : C.GRATUITY_MIN_YEARS - yearsOfService,
  };
}

/** The least-of-three rule. All figures annual. */
export function hraExemption(
  hraReceived: number,
  basicAnnual: number,
  rentPaid: number,
  isMetro: boolean
) {
  const percent = isMetro ? 0.5 : 0.4;
  const a = hraReceived;
  const b = basicAnnual * percent;
  const c = Math.max(0, rentPaid - 0.1 * basicAnnual);
  const exempt = Math.min(a, b, c);

  return {
    exempt,
    taxable: Math.max(0, hraReceived - exempt),
    limbs: [
      { label: 'HRA actually received', value: a, binding: exempt === a },
      { label: `${isMetro ? '50' : '40'}% of basic salary`, value: b, binding: exempt === b },
      { label: 'Rent paid over 10% of basic', value: c, binding: exempt === c },
    ],
  };
}

/* ── Income tax ───────────────────────────────────────────────────────── */

export interface TaxResult {
  regime: 'old' | 'new';
  grossIncome: number;
  deductions: number;
  taxableIncome: number;
  taxBeforeRebate: number;
  rebate: number;
  surcharge: number;
  cess: number;
  totalTax: number;
  effectiveRate: number;
  monthly: number;
}

/**
 * New regime. Only the standard deduction is allowed — no HRA, no 80C.
 *
 * The 87A rebate is assessed on income AFTER the standard deduction, not on
 * gross, and marginal relief applies just above the threshold so that tax can
 * never exceed the amount by which taxable income overshoots ₹12L. Both details
 * were bugs in the engine once; getting them wrong here would mis-state tax for
 * everyone earning between ₹12L and roughly ₹12.8L.
 */
export function taxNewRegime(annualIncome: number): TaxResult {
  const taxableIncome = Math.max(0, annualIncome - C.STANDARD_DEDUCTION_NEW);
  const taxBeforeRebate = applySlabs(taxableIncome, NEW_REGIME_SLABS);

  let rebate: number;
  if (taxableIncome <= C.REBATE_LIMIT_NEW) {
    rebate = taxBeforeRebate;
  } else {
    const excess = taxableIncome - C.REBATE_LIMIT_NEW;
    rebate = taxBeforeRebate > excess ? taxBeforeRebate - excess : 0;
  }

  const afterRebate = Math.max(0, taxBeforeRebate - rebate);
  const sur = surcharge(afterRebate, taxableIncome, 'new');
  const cess = (afterRebate + sur) * C.HEALTH_EDUCATION_CESS;
  const totalTax = afterRebate + sur + cess;

  return {
    regime: 'new',
    grossIncome: annualIncome,
    deductions: C.STANDARD_DEDUCTION_NEW,
    taxableIncome,
    taxBeforeRebate,
    rebate,
    surcharge: sur,
    cess,
    totalTax,
    effectiveRate: annualIncome > 0 ? (totalTax / annualIncome) * 100 : 0,
    monthly: totalTax / 12,
  };
}

export interface OldRegimeDeductions {
  section80c?: number;
  section80d?: number;
  section80ccd1b?: number;
  section24b?: number;
  hraExemption?: number;
}

export function taxOldRegime(
  annualIncome: number,
  d: OldRegimeDeductions = {}
): TaxResult {
  const c80 = Math.min(d.section80c ?? 0, C.SECTION_80C_CAP);
  const d80 = Math.min(d.section80d ?? 0, C.SECTION_80D_CAP);
  const nps = Math.min(d.section80ccd1b ?? 0, C.SECTION_80CCD1B_CAP);
  const b24 = Math.min(d.section24b ?? 0, C.SECTION_24B_CAP);
  const hra = Math.min(d.hraExemption ?? 0, annualIncome);

  const deductions = C.STANDARD_DEDUCTION_OLD + c80 + d80 + nps + b24 + hra;
  const taxableIncome = Math.max(0, annualIncome - deductions);
  const taxBeforeRebate = applySlabs(taxableIncome, OLD_REGIME_SLABS);

  const rebate =
    taxableIncome <= C.REBATE_LIMIT_OLD ? Math.min(taxBeforeRebate, C.REBATE_MAX_OLD) : 0;

  const afterRebate = Math.max(0, taxBeforeRebate - rebate);
  const sur = surcharge(afterRebate, taxableIncome, 'old');
  const cess = (afterRebate + sur) * C.HEALTH_EDUCATION_CESS;
  const totalTax = afterRebate + sur + cess;

  return {
    regime: 'old',
    grossIncome: annualIncome,
    deductions,
    taxableIncome,
    taxBeforeRebate,
    rebate,
    surcharge: sur,
    cess,
    totalTax,
    effectiveRate: annualIncome > 0 ? (totalTax / annualIncome) * 100 : 0,
    monthly: totalTax / 12,
  };
}

/* ── The structure ────────────────────────────────────────────────────── */

export interface BreakupInput {
  annualCtc: number;
  isMetro: boolean;
  stateCode: string;
  basicPct?: number;
  hraPct?: number;
  conveyance?: number;
}

export interface BreakupResult {
  monthlyCtc: number;
  basic: number;
  hra: number;
  conveyance: number;
  special: number;
  gross: number;
  employerPf: { total: number; eps: number; epf: number };
  gratuityProvision: number;
  employeePf: number;
  esiEmployee: number;
  pt: number;
  tdsNew: number;
  tdsOld: number;
  totalDeductions: number;
  netMonthly: number;
  /** True when the structure cannot fit inside the CTC — see below. */
  impossible: boolean;
  /** The largest basic percentage that would still leave a positive residual. */
  maxBasicPct: number;
}

/**
 * CTC to components, with the residual absorbing the remainder.
 *
 * The residual is what makes the total return to CTC exactly, and it is also
 * the thing that can go negative. When a requested basic percentage is too high
 * for the CTC to carry — because HRA, employer PF and the gratuity provision
 * all scale with basic — this REFUSES rather than quietly emitting a negative
 * special allowance, and reports the maximum that would work. That mirrors
 * OverrideBalancingService, and it is the single most distinctive behaviour in
 * the product.
 */
export function salaryBreakup(input: BreakupInput): BreakupResult {
  const monthlyCtc = input.annualCtc / 12;
  const basicPct = input.basicPct ?? C.DEFAULT_BASIC_PCT;
  const hraPct =
    input.hraPct ?? (input.isMetro ? C.DEFAULT_HRA_PCT_METRO : C.DEFAULT_HRA_PCT_NON_METRO);
  const conveyance = input.conveyance ?? C.DEFAULT_CONVEYANCE;

  const basic = monthlyCtc * basicPct;
  const hra = basic * hraPct;
  const erPf = employerPF(basic);
  const gratuityProvision = basic * C.GRATUITY_RATE;

  const special = monthlyCtc - (basic + hra + conveyance + erPf.total + gratuityProvision);
  const gross = basic + hra + conveyance + Math.max(0, special);

  /*
   * Each ₹1 of basic consumes ₹(1 + hraPct + pfRate + gratuityRate) of CTC —
   * the amplification factor the override balancer exposes. Below the PF
   * ceiling the PF term drops out, which is why it is computed from the actual
   * employer PF rather than assumed.
   */
  const pfSlope = basic > 0 ? erPf.total / basic : 0;
  const amplification = 1 + hraPct + pfSlope + C.GRATUITY_RATE;
  const maxBasicPct = (monthlyCtc - conveyance) / (monthlyCtc * amplification);

  const eePf = employeePF(basic);
  const esiResult = esi(gross);
  const pt = professionalTax(input.stateCode, gross);

  const annualGross = gross * 12;
  const tdsNew = taxNewRegime(annualGross).monthly;
  const tdsOld = taxOldRegime(annualGross).monthly;

  const totalDeductions = eePf + esiResult.employee + pt + tdsNew;

  return {
    monthlyCtc,
    basic,
    hra,
    conveyance,
    special,
    gross,
    employerPf: erPf,
    gratuityProvision,
    employeePf: eePf,
    esiEmployee: esiResult.employee,
    pt,
    tdsNew,
    tdsOld,
    totalDeductions,
    netMonthly: gross - totalDeductions,
    impossible: special < 0,
    maxBasicPct,
  };
}

/* ── Formatting ───────────────────────────────────────────────────────── */

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const INR2 = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function rupees(n: number, paise = false): string {
  if (!Number.isFinite(n)) return '—';
  return (paise ? INR2 : INR).format(n);
}

/** Indian short scale — what an Indian reader actually thinks in. */
export function lakhs(n: number): string {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return rupees(n);
}
