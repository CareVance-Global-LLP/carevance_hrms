import { describe, expect, it } from 'vitest';
import {
  currentFinancialYear,
  financialYearOfMonth,
  formatFinancialYear,
} from './financialYear';

describe('financialYearOfMonth', () => {
  it('starts the year in April', () => {
    expect(financialYearOfMonth('2026-04')).toBe('2026-27');
    expect(financialYearOfMonth('2026-03')).toBe('2025-26');
  });

  it('keeps January to March in the previous starting year', () => {
    // The trap: Mar 2027 belongs to FY 2026-27, not 2027-28.
    expect(financialYearOfMonth('2027-01')).toBe('2026-27');
    expect(financialYearOfMonth('2027-03')).toBe('2026-27');
    expect(financialYearOfMonth('2027-04')).toBe('2027-28');
  });

  it('pads the second half to two digits across a century', () => {
    expect(financialYearOfMonth('2099-04')).toBe('2099-00');
  });

  it('hands back anything it cannot parse rather than guessing', () => {
    // A lookup that finds nothing is recoverable; one that finds the wrong
    // year's declarations is not.
    expect(financialYearOfMonth('nonsense')).toBe('nonsense');
  });
});

describe('currentFinancialYear', () => {
  it('matches the canonical YYYY-YY shape the server looks up by', () => {
    expect(currentFinancialYear()).toMatch(/^\d{4}-\d{2}$/);
  });

  it('resolves a fixed date the same way the backend does', () => {
    // August 2026 is FY 2026-27. MyPayroll previously sent "2026" here, which
    // matches nothing on an exact-match lookup, so an employee's own
    // declaration never loaded on their own page.
    expect(currentFinancialYear(new Date('2026-08-12T00:00:00Z'))).toBe('2026-27');
    expect(currentFinancialYear(new Date('2026-02-12T00:00:00Z'))).toBe('2025-26');
  });
});

describe('formatFinancialYear', () => {
  it('is for display only', () => {
    expect(formatFinancialYear('2026-27')).toBe('FY 2026–27');
  });
});
