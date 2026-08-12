import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BASIC_PERCENTAGE,
  EMPLOYEE_PF_RATE,
  EMPLOYER_PF_RATE,
  GRATUITY_RATE,
  METRO_HRA_PERCENTAGE_OF_BASIC,
  NON_METRO_HRA_PERCENTAGE_OF_BASIC,
  PF_WAGE_CAP,
  calculateCtcBreakup,
  formatRupees,
  pfWages,
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
