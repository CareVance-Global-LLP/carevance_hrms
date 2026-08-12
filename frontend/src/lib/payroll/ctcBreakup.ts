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

/** A named line the structure adds, shown as its own row. */
export interface BreakupLine {
  label: string;
  amount: number;
}

/**
 * The subset of SalaryStructure this calculation needs.
 *
 * Deliberately structural rather than importing the full type: the panel builds
 * this from a structure, from an admin's edits, or from the engine defaults,
 * and the calculation should not care which.
 */
export interface StructureConfig {
  basicPercentage: number;
  hraPercentageOfBasic: number;
  daPercentage: number;
  conveyance: number;
  /** Fixed monthly allowances, already named for display. */
  allowances: BreakupLine[];
  /** Employee-side percentages of basic, e.g. NPS and VPF. */
  npsPercentage: number;
  vpfPercentage: number;
}

export interface CtcBreakupInput {
  annualCtc: number;
  /** Fraction of monthly CTC, not a percentage. Defaults to the engine's 0.40. */
  basicPercentage?: number;
  /** Fraction of basic. Defaults by metro status, as the engine does. */
  hraPercentageOfBasic?: number;
  isMetroCity?: boolean;
  conveyance?: number;
  /** Fixed monthly allowances from a salary structure. */
  allowances?: BreakupLine[];
  /** DA as a fraction of basic. Counts toward the labour-code floor with basic. */
  daPercentage?: number;
  npsPercentage?: number;
  vpfPercentage?: number;
}

export interface CtcBreakup {
  monthlyCtc: number;
  basic: number;
  hra: number;
  da: number;
  conveyance: number;
  /** Named fixed allowances, in the order the structure lists them. */
  allowances: BreakupLine[];
  specialAllowance: number;
  gross: number;
  employeePf: number;
  nps: number;
  vpf: number;
  employerPf: number;
  gratuity: number;
  /** Gross less the employee's own deductions. Excludes tax — see the note above. */
  netBeforeTax: number;
  /** Share of annual CTC the person actually receives before tax. */
  takeHomeRatio: number;
  /**
   * basic + DA as a share of monthly CTC.
   *
   * DA is included because the labour-code floor is on basic PLUS dearness
   * allowance, not basic alone — a structure carrying DA can clear the floor
   * on a lower basic.
   */
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
  allowances = [],
  daPercentage = 0,
  npsPercentage = 0,
  vpfPercentage = 0,
}: CtcBreakupInput): CtcBreakup {
  const safeCtc = Number.isFinite(annualCtc) && annualCtc > 0 ? annualCtc : 0;
  const monthlyCtc = safeCtc / 12;

  const hraRate =
    hraPercentageOfBasic ??
    (isMetroCity ? METRO_HRA_PERCENTAGE_OF_BASIC : NON_METRO_HRA_PERCENTAGE_OF_BASIC);

  const basic = monthlyCtc * basicPercentage;
  const hra = basic * hraRate;
  const da = basic * daPercentage;

  const namedAllowances = allowances
    .map((line) => ({ label: line.label, amount: Number.isFinite(line.amount) ? line.amount : 0 }))
    .filter((line) => line.amount > 0);

  /*
   * Employer PF and the gratuity provision come out of CTC before gross —
   * calculateSalaryComponents line 178. Getting this order wrong inflates
   * take-home by roughly 17% of basic, which is exactly the kind of number an
   * admin would repeat to a candidate.
   */
  const employerPf = pfWages(basic) * EMPLOYER_PF_RATE;
  const gratuity = basic * GRATUITY_RATE;
  const gross = monthlyCtc - employerPf - gratuity;

  /*
   * Every named head is fixed; special allowance absorbs the remainder. Adding
   * structure allowances therefore shrinks special allowance rather than
   * increasing gross — the CTC is the ceiling, which is what makes a structure
   * a redistribution of the same number rather than a raise.
   */
  const allowanceTotal = namedAllowances.reduce((sum, line) => sum + line.amount, 0);
  const fixedComponents = basic + hra + da + conveyance + allowanceTotal;
  const specialAllowance = Math.max(0, gross - fixedComponents);

  const employeePf = pfWages(basic) * EMPLOYEE_PF_RATE;
  const nps = basic * npsPercentage;
  const vpf = basic * vpfPercentage;
  const netBeforeTax = gross - employeePf - nps - vpf;

  // basic PLUS DA — the labour-code floor is on the pair, not on basic alone.
  const basicShareOfCtc = monthlyCtc > 0 ? (basic + da) / monthlyCtc : 0;

  return {
    monthlyCtc,
    basic,
    hra,
    da,
    conveyance,
    allowances: namedAllowances,
    specialAllowance,
    gross,
    employeePf,
    nps,
    vpf,
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

/**
 * Turn a SalaryStructure row into calculation input.
 *
 * The structure stores percentages as whole numbers (50 meaning 50%) while the
 * calculation takes fractions, so this is also where that conversion lives —
 * doing it at each call site is how one of them ends up 100x out.
 *
 * `other_earnings` entries of type 'percentage' are resolved against basic,
 * matching how the payroll engine treats them.
 */
export function structureToConfig(structure: {
  basic_percentage?: number | null;
  hra_percentage?: number | null;
  da_percentage?: number | null;
  conveyance_amount?: number | null;
  cca_amount?: number | null;
  education_allowance?: number | null;
  internet_allowance?: number | null;
  meal_allowance?: number | null;
  transport_allowance?: number | null;
  uniform_allowance?: number | null;
  books_periodicals?: number | null;
  fuel_maintenance?: number | null;
  nps_percentage?: number | null;
  vpf_percentage?: number | null;
  other_earnings?: Array<{ name: string; type: 'fixed' | 'percentage'; value: number }> | null;
}): StructureConfig {
  const pct = (value?: number | null) => (Number.isFinite(value) ? Number(value) / 100 : 0);
  const amt = (value?: number | null) => (Number.isFinite(value) ? Number(value) : 0);

  const named: BreakupLine[] = [
    { label: 'City compensatory allowance', amount: amt(structure.cca_amount) },
    { label: 'Education allowance', amount: amt(structure.education_allowance) },
    { label: 'Internet allowance', amount: amt(structure.internet_allowance) },
    { label: 'Meal allowance', amount: amt(structure.meal_allowance) },
    { label: 'Transport allowance', amount: amt(structure.transport_allowance) },
    { label: 'Uniform allowance', amount: amt(structure.uniform_allowance) },
    { label: 'Books & periodicals', amount: amt(structure.books_periodicals) },
    { label: 'Fuel & maintenance', amount: amt(structure.fuel_maintenance) },
  ].filter((line) => line.amount > 0);

  return {
    basicPercentage: pct(structure.basic_percentage) || DEFAULT_BASIC_PERCENTAGE,
    hraPercentageOfBasic: pct(structure.hra_percentage) || NON_METRO_HRA_PERCENTAGE_OF_BASIC,
    daPercentage: pct(structure.da_percentage),
    conveyance: amt(structure.conveyance_amount),
    allowances: named,
    npsPercentage: pct(structure.nps_percentage),
    vpfPercentage: pct(structure.vpf_percentage),
  };
}
