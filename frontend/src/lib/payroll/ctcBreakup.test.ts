import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BASIC_PERCENTAGE,
  EMPLOYEE_PF_RATE,
  EMPLOYER_PF_RATE,
  ESI_GROSS_THRESHOLD,
  GRATUITY_RATE,
  METRO_HRA_PERCENTAGE_OF_BASIC,
  NON_METRO_HRA_PERCENTAGE_OF_BASIC,
  PF_WAGE_CAP,
  calculateCtcBreakup,
  estimateMonthlyTds,
  formatRupees,
  pfWages,
  resolvePtAmount,
} from './ctcBreakup';

/*
 * These pin the constants against PayrollCalculatorService. If the engine
 * changes one and this file is not updated, CI fails here rather than an admin
 * quoting a candidate a number payroll will not pay.
 */
describe('constants mirror PayrollCalculatorService', () => {
  it('holds the same statutory values as the engine', () => {
    expect(PF_WAGE_CAP).toBe(15000);
    expect(EMPLOYEE_PF_RATE).toBe(0.12);
    expect(EMPLOYER_PF_RATE).toBe(0.12);
    expect(GRATUITY_RATE).toBe(0.0481);
  });

  it('defaults basic to 40% of CTC, not 50%', () => {
    // The design draft for this feature assumed 50%. The engine uses 40%, and
    // the engine is what actually pays people.
    expect(DEFAULT_BASIC_PERCENTAGE).toBe(0.4);
  });

  it('splits HRA by metro status the way the engine does', () => {
    expect(METRO_HRA_PERCENTAGE_OF_BASIC).toBe(0.5);
    expect(NON_METRO_HRA_PERCENTAGE_OF_BASIC).toBe(0.4);
  });
});

describe('calculateCtcBreakup', () => {
  const ctc = 1_200_000; // ₹1L a month, so the arithmetic is checkable by hand

  it('derives basic and HRA from CTC', () => {
    const b = calculateCtcBreakup({ annualCtc: ctc });
    expect(b.monthlyCtc).toBe(100_000);
    expect(b.basic).toBeCloseTo(40_000, 2);
    expect(b.hra).toBeCloseTo(16_000, 2); // 40% of basic, non-metro
  });

  it('raises HRA for a metro city', () => {
    const b = calculateCtcBreakup({ annualCtc: ctc, isMetroCity: true });
    expect(b.hra).toBeCloseTo(20_000, 2); // 50% of basic
  });

  it('caps PF wages at the statutory ceiling', () => {
    // basic is 40,000 here, well over the 15,000 cap.
    const b = calculateCtcBreakup({ annualCtc: ctc });
    expect(pfWages(b.basic)).toBe(PF_WAGE_CAP);
    expect(b.employeePf).toBeCloseTo(1800, 2);
    expect(b.employerPf).toBeCloseTo(1800, 2);
  });

  it('does not cap PF when basic is below the ceiling', () => {
    const b = calculateCtcBreakup({ annualCtc: 300_000 }); // basic 10,000
    expect(b.basic).toBeCloseTo(10_000, 2);
    expect(b.employeePf).toBeCloseTo(1200, 2);
  });

  it('takes employer PF and gratuity out of CTC before gross', () => {
    // calculateSalaryComponents:178 — gross = monthlyCtc - employerPf - gratuity.
    // Getting the order wrong inflates take-home by about 17% of basic.
    const b = calculateCtcBreakup({ annualCtc: ctc });
    expect(b.gratuity).toBeCloseTo(40_000 * 0.0481, 2);
    expect(b.gross).toBeCloseTo(100_000 - b.employerPf - b.gratuity, 2);
  });

  it('uses special allowance as the balancing figure', () => {
    const b = calculateCtcBreakup({ annualCtc: ctc });
    expect(b.basic + b.hra + b.conveyance + b.specialAllowance).toBeCloseTo(b.gross, 2);
  });

  it('never lets special allowance go negative', () => {
    // A basic high enough that the fixed heads exceed gross on their own.
    const b = calculateCtcBreakup({ annualCtc: 200_000, basicPercentage: 0.9 });
    expect(b.specialAllowance).toBe(0);
  });

  it('reports take-home as a share of CTC', () => {
    const b = calculateCtcBreakup({ annualCtc: ctc });
    expect(b.netBeforeTax).toBeCloseTo(b.gross - b.employeePf, 2);
    // Before tax, so comfortably above the 70-82% band that includes TDS.
    expect(b.takeHomeRatio).toBeGreaterThan(0.9);
    expect(b.takeHomeRatio).toBeLessThan(1);
  });

  it('flags a basic below the labour-code floor', () => {
    const low = calculateCtcBreakup({ annualCtc: ctc }); // 40% default
    expect(low.basicShareOfCtc).toBeCloseTo(0.4, 5);
    expect(low.meetsLabourCodeFloor).toBe(false);

    const compliant = calculateCtcBreakup({ annualCtc: ctc, basicPercentage: 0.5 });
    expect(compliant.meetsLabourCodeFloor).toBe(true);
  });

  it('returns zeroes rather than NaN for empty or nonsense input', () => {
    for (const value of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const b = calculateCtcBreakup({ annualCtc: value });
      expect(b.monthlyCtc).toBe(0);
      expect(b.basic).toBe(0);
      expect(b.takeHomeRatio).toBe(0);
      expect(Number.isNaN(b.gross)).toBe(false);
    }
  });
});

describe('formatRupees', () => {
  it('groups in the Indian system', () => {
    expect(formatRupees(1_200_000)).toBe('₹12,00,000');
    expect(formatRupees(100_000)).toBe('₹1,00,000');
  });

  it('rounds to whole rupees and survives bad input', () => {
    expect(formatRupees(1234.56)).toBe('₹1,235');
    expect(formatRupees(Number.NaN)).toBe('₹0');
  });
});

describe('salary structure inputs', () => {
  const ctc = 1_200_000;

  it('uses the structure percentages instead of the engine defaults', () => {
    const b = calculateCtcBreakup({
      annualCtc: ctc,
      basicPercentage: 0.5,
      hraPercentageOfBasic: 0.6,
    });
    expect(b.basic).toBeCloseTo(50_000, 2);
    expect(b.hra).toBeCloseTo(30_000, 2);
  });

  it('adds named allowances and shrinks special allowance to match', () => {
    // CTC is the ceiling, so a structure redistributes the same number rather
    // than increasing it. Gross must not move.
    const plain = calculateCtcBreakup({ annualCtc: ctc });
    const withAllowances = calculateCtcBreakup({
      annualCtc: ctc,
      allowances: [
        { label: 'Internet', amount: 1000 },
        { label: 'Meal', amount: 2200 },
      ],
    });

    expect(withAllowances.gross).toBeCloseTo(plain.gross, 2);
    expect(withAllowances.allowances).toHaveLength(2);
    expect(withAllowances.specialAllowance).toBeCloseTo(plain.specialAllowance - 3200, 2);
  });

  it('drops allowances with no value rather than rendering empty rows', () => {
    const b = calculateCtcBreakup({
      annualCtc: ctc,
      allowances: [
        { label: 'Internet', amount: 0 },
        { label: 'Books', amount: Number.NaN },
        { label: 'Meal', amount: 500 },
      ],
    });
    expect(b.allowances).toEqual([{ label: 'Meal', amount: 500 }]);
  });

  it('counts DA toward the labour-code floor, not just basic', () => {
    // 40% basic alone fails the 50% floor; 40% basic + 15% DA of basic does not
    // reach it either, but 40% + 30% of basic does — the point is that DA counts.
    const basicOnly = calculateCtcBreakup({ annualCtc: ctc, basicPercentage: 0.45 });
    expect(basicOnly.meetsLabourCodeFloor).toBe(false);

    const withDa = calculateCtcBreakup({ annualCtc: ctc, basicPercentage: 0.45, daPercentage: 0.2 });
    expect(withDa.da).toBeCloseTo(45_000 * 0.2, 2);
    // basic 45% + DA (20% of basic = 9% of CTC) = 54% of CTC
    expect(withDa.basicShareOfCtc).toBeCloseTo(0.54, 4);
    expect(withDa.meetsLabourCodeFloor).toBe(true);
  });

  it('takes NPS and VPF off take-home as employee deductions', () => {
    const b = calculateCtcBreakup({ annualCtc: ctc, npsPercentage: 0.1, vpfPercentage: 0.05 });
    // basic is 40,000 — 40% of the 100,000 monthly CTC.
    expect(b.nps).toBeCloseTo(4_000, 2);
    expect(b.vpf).toBeCloseTo(2_000, 2);
    expect(b.netBeforeTax).toBeCloseTo(b.gross - b.employeePf - b.nps - b.vpf, 2);
  });
});

describe('ESI', () => {
  it('applies at or below the gross threshold and takes 0.75% off take-home', () => {
    // A CTC low enough that gross lands under ₹21,000.
    const b = calculateCtcBreakup({ annualCtc: 240_000 }); // ₹20,000 a month
    expect(b.gross).toBeLessThanOrEqual(ESI_GROSS_THRESHOLD);
    expect(b.esiApplicable).toBe(true);
    expect(b.employeeEsi).toBeCloseTo(b.gross * 0.0075, 2);
    expect(b.employerEsi).toBeCloseTo(b.gross * 0.0325, 2);
    expect(b.netBeforeTax).toBeCloseTo(b.gross - b.employeePf - b.employeeEsi, 2);
  });

  it('does not apply above the threshold', () => {
    const b = calculateCtcBreakup({ annualCtc: 1_200_000 });
    expect(b.gross).toBeGreaterThan(ESI_GROSS_THRESHOLD);
    expect(b.esiApplicable).toBe(false);
    expect(b.employeeEsi).toBe(0);
    expect(b.employerEsi).toBe(0);
  });

  it('does not take employer ESI out of CTC, because the engine does not', () => {
    // calculateSalaryComponents subtracts only employer PF and gratuity.
    const b = calculateCtcBreakup({ annualCtc: 240_000 });
    expect(b.gross).toBeCloseTo(b.monthlyCtc - b.employerPf - b.gratuity, 2);
  });
});

describe('resolvePtAmount', () => {
  // Maharashtra's monthly table, as PTStateService holds it.
  const maharashtra = [
    { min: 0, max: 7500, amount: 0 },
    { min: 7501, max: 10000, amount: 175 },
    { min: 10001, max: null, amount: 200 },
  ];

  it('picks the band the gross falls in', () => {
    expect(resolvePtAmount(maharashtra, 5000)).toBe(0);
    expect(resolvePtAmount(maharashtra, 9000)).toBe(175);
    expect(resolvePtAmount(maharashtra, 50_000)).toBe(200);
  });

  it('treats a null max as the open-ended top band', () => {
    expect(resolvePtAmount(maharashtra, 10_000_000)).toBe(200);
  });

  it('returns zero for a state that levies none, rather than guessing', () => {
    // Several states levy no PT at all — an empty table is a real answer.
    expect(resolvePtAmount([], 50_000)).toBe(0);
    expect(resolvePtAmount(null, 50_000)).toBe(0);
    expect(resolvePtAmount(undefined, 50_000)).toBe(0);
  });

  it('returns zero for a gross of zero or nonsense', () => {
    expect(resolvePtAmount(maharashtra, 0)).toBe(0);
    expect(resolvePtAmount(maharashtra, Number.NaN)).toBe(0);
  });
});

describe('estimateMonthlyTds', () => {
  it('is zero below the 87A rebate limit under the new regime', () => {
    // 12L taxable is fully rebated, so a 12L gross pays nothing.
    expect(estimateMonthlyTds(1_200_000, 'new')).toBe(0);
    expect(estimateMonthlyTds(600_000, 'new')).toBe(0);
  });

  it('taxes above the rebate limit using the slab table', () => {
    // 20L gross, new regime: taxable 19.25L after the 75k standard deduction.
    // 4L nil + 4L@5% (20,000) + 4L@10% (40,000) + 4L@15% (60,000)
    // + 3.25L@20% (65,000) = 185,000, plus 4% cess = 192,400 a year.
    const monthly = estimateMonthlyTds(2_000_000, 'new');
    expect(monthly * 12).toBeCloseTo(192_400, 0);
  });

  it('differs between regimes, because the slabs and deduction do', () => {
    const newRegime = estimateMonthlyTds(2_000_000, 'new');
    const oldRegime = estimateMonthlyTds(2_000_000, 'old');
    expect(oldRegime).toBeGreaterThan(newRegime);
  });

  it('returns zero for empty or nonsense input', () => {
    expect(estimateMonthlyTds(0)).toBe(0);
    expect(estimateMonthlyTds(-1)).toBe(0);
    expect(estimateMonthlyTds(Number.NaN)).toBe(0);
  });
});

describe('resolvePtAmount boundaries and special months', () => {
  const maharashtra = [
    { min: 0, max: 7500, amount: 0 },
    { min: 7501, max: 10000, amount: 175 },
    { min: 10001, max: null, amount: 200 },
  ];

  it('matches on the upper bound, so boundary values do not fall through', () => {
    // The declared minimums are one rupee above the previous maximum, so a
    // gross between them belongs to the NEXT band. A min/max test returned 0.
    expect(resolvePtAmount(maharashtra, 7500.5)).toBe(175);
    expect(resolvePtAmount(maharashtra, 10000.5)).toBe(200);
    expect(resolvePtAmount(maharashtra, 7500)).toBe(0);
    expect(resolvePtAmount(maharashtra, 7501)).toBe(175);
  });

  it('applies a special month rate to the top band only', () => {
    const special = { february: 300 };
    // February, top band -> the higher instalment.
    expect(resolvePtAmount(maharashtra, 50_000, 2, special)).toBe(300);
    // February, but a lower band -> the ordinary rate, because that person is
    // already under the annual cap.
    expect(resolvePtAmount(maharashtra, 9_000, 2, special)).toBe(175);
    // Any other month -> ordinary rate.
    expect(resolvePtAmount(maharashtra, 50_000, 3, special)).toBe(200);
  });

  it('ignores a special table when no month is given', () => {
    expect(resolvePtAmount(maharashtra, 50_000, undefined, { february: 300 })).toBe(200);
  });
});
