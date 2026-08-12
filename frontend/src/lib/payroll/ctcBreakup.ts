/**
 * Monthly CTC breakup, mirroring `PayrollCalculatorService`.
 *
 * This exists so an admin can see what an annual CTC actually means to the
 * person before the account is created — Add User previously took the number
 * and showed nothing.
 *
 * Every constant and every formula here is transcribed from
 * `backend/app/Services/PayrollCalculatorService.php`, with the line it mirrors
 * named beside it. That is the whole point: a preview that disagrees with the
 * engine is worse than no preview, because the admin trusts it and then payroll
 * pays something else. `ctcBreakup.test.ts` pins each constant so drift fails CI
 * rather than surfacing as a salary complaint.
 *
 * It is deliberately NOT a payroll implementation. Income tax is a rough
 * estimate and is labelled as such wherever it is shown; professional tax is
 * state-levied and resolved server-side by PTStateService, so it is not
 * guessed here at all.
 */

/** PayrollCalculatorService::PF_WAGE_CAP */
export const PF_WAGE_CAP = 15000;
/** PayrollCalculatorService::EMPLOYEE_PF_RATE */
export const EMPLOYEE_PF_RATE = 0.12;
/** PayrollCalculatorService::EMPLOYER_PF_RATE */
export const EMPLOYER_PF_RATE = 0.12;
/** PayrollCalculatorService::GRATUITY_RATE */
export const GRATUITY_RATE = 0.0481;

/** Defaults from PayrollCalculatorService::calculateSalaryBreakdown. */
export const DEFAULT_BASIC_PERCENTAGE = 0.4;
export const METRO_HRA_PERCENTAGE_OF_BASIC = 0.5;
export const NON_METRO_HRA_PERCENTAGE_OF_BASIC = 0.4;
export const DEFAULT_CONVEYANCE = 1600;

/**
 * The floor the labour codes put under basic + DA, as a share of total
 * remuneration. Not enforced by the engine — surfaced here as a warning,
 * because a basic below this shrinks PF and gratuity and is the usual reason
 * someone sets one.
 */
export const LABOUR_CODE_BASIC_FLOOR = 0.5;

export interface CtcBreakupInput {
  annualCtc: number;
  /** Fraction of monthly CTC, not a percentage. Defaults to the engine's 0.40. */
  basicPercentage?: number;
  /** Fraction of basic. Defaults by metro status, as the engine does. */
  hraPercentageOfBasic?: number;
  isMetroCity?: boolean;
  conveyance?: number;
}

export interface CtcBreakup {
  monthlyCtc: number;
  basic: number;
  hra: number;
  conveyance: number;
  specialAllowance: number;
  gross: number;
  employeePf: number;
  employerPf: number;
  gratuity: number;
  /** Gross less the employee's own deductions. Excludes tax — see the note above. */
  netBeforeTax: number;
  /** Share of annual CTC the person actually receives before tax. */
  takeHomeRatio: number;
  /** basic as a share of monthly CTC, for the labour-code check. */
  basicShareOfCtc: number;
  meetsLabourCodeFloor: boolean;
}

/** PayrollCalculatorService::pfWages — the cap applies to basic, not gross. */
export const pfWages = (basic: number): number => Math.min(basic, PF_WAGE_CAP);

export function calculateCtcBreakup({
  annualCtc,
  basicPercentage = DEFAULT_BASIC_PERCENTAGE,
  hraPercentageOfBasic,
  isMetroCity = false,
  conveyance = DEFAULT_CONVEYANCE,
}: CtcBreakupInput): CtcBreakup {
  const safeCtc = Number.isFinite(annualCtc) && annualCtc > 0 ? annualCtc : 0;
  const monthlyCtc = safeCtc / 12;

  const hraRate =
    hraPercentageOfBasic ??
    (isMetroCity ? METRO_HRA_PERCENTAGE_OF_BASIC : NON_METRO_HRA_PERCENTAGE_OF_BASIC);

  const basic = monthlyCtc * basicPercentage;
  const hra = basic * hraRate;

  /*
   * Employer PF and the gratuity provision come out of CTC before gross —
   * calculateSalaryComponents line 178. Getting this order wrong inflates
   * take-home by roughly 17% of basic, which is exactly the kind of number an
   * admin would repeat to a candidate.
   */
  const employerPf = pfWages(basic) * EMPLOYER_PF_RATE;
  const gratuity = basic * GRATUITY_RATE;
  const gross = monthlyCtc - employerPf - gratuity;

  const fixedComponents = basic + hra + conveyance;
  const specialAllowance = Math.max(0, gross - fixedComponents);

  const employeePf = pfWages(basic) * EMPLOYEE_PF_RATE;
  const netBeforeTax = gross - employeePf;

  const basicShareOfCtc = monthlyCtc > 0 ? basic / monthlyCtc : 0;

  return {
    monthlyCtc,
    basic,
    hra,
    conveyance,
    specialAllowance,
    gross,
    employeePf,
    employerPf,
    gratuity,
    netBeforeTax,
    takeHomeRatio: safeCtc > 0 ? (netBeforeTax * 12) / safeCtc : 0,
    basicShareOfCtc,
    meetsLabourCodeFloor: basicShareOfCtc >= LABOUR_CODE_BASIC_FLOOR,
  };
}

/** Indian digit grouping, whole rupees — paise are noise at this scale. */
export const formatRupees = (value: number): string =>
  `₹${Math.round(Number.isFinite(value) ? value : 0).toLocaleString('en-IN')}`;
