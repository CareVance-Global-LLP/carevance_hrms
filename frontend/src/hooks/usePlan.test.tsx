import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePlan } from './usePlan';

// Mock runtimeConfig
vi.mock('@/lib/runtimeConfig', () => ({
  payrollEnabled: true,
}));

// Mock AuthContext
const mockUseAuth = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

/**
 * usePlan is a React hook and calls useCallback, so it only runs inside a
 * render. These tests used to invoke it directly, which threw
 * "Cannot read properties of null (reading 'useCallback')" because React had no
 * current dispatcher. renderHook supplies one.
 */
const planFor = (planCode: string) => {
  mockUseAuth.mockReturnValue({
    organization: {
      plan_code: planCode,
      max_seats: 5,
      subscription_status: 'active',
    },
  });

  return renderHook(() => usePlan()).result.current;
};

describe('usePlan', () => {
  it('should not show payroll for the basic tracking plan even when payrollEnabled is true', () => {
    expect(planFor('basic_tracking').hasFeature('payroll')).toBe(false);
  });

  it('should not show payroll for the advance tracking plan even when payrollEnabled is true', () => {
    expect(planFor('advance_tracking').hasFeature('payroll')).toBe(false);
  });

  it('should show payroll for the enterprise plan when payrollEnabled is true', () => {
    expect(planFor('enterprise').hasFeature('payroll')).toBe(true);
  });

  it('should show payroll for the dedicated payroll plans', () => {
    expect(planFor('basic_payroll').hasFeature('payroll')).toBe(true);
    expect(planFor('professional_payroll').hasFeature('payroll')).toBe(true);
  });

  it('should not show payroll for an unrecognised plan code', () => {
    expect(planFor('some_plan_that_does_not_exist').hasFeature('payroll')).toBe(false);
  });
});
