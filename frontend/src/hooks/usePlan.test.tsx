import { describe, it, expect, vi } from 'vitest';
import { usePlan } from './usePlan';
import { payrollEnabled } from '@/lib/runtimeConfig';

// Mock runtimeConfig
vi.mock('@/lib/runtimeConfig', () => ({
  payrollEnabled: true,
}));

// Mock AuthContext
const mockUseAuth = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

describe('usePlan', () => {
  it('should not show payroll for basic plan even when payrollEnabled is true', () => {
    mockUseAuth.mockReturnValue({
      organization: {
        plan_code: 'basic',
        max_seats: 5,
        subscription_status: 'active',
      },
    });

    const { hasFeature } = usePlan();
    expect(hasFeature('payroll')).toBe(false);
  });

  it('should not show payroll for advanced_tracker plan even when payrollEnabled is true', () => {
    mockUseAuth.mockReturnValue({
      organization: {
        plan_code: 'advanced_tracker',
        max_seats: 5,
        subscription_status: 'active',
      },
    });

    const { hasFeature } = usePlan();
    expect(hasFeature('payroll')).toBe(false);
  });

  it('should show payroll for enterprise plan when payrollEnabled is true', () => {
    mockUseAuth.mockReturnValue({
      organization: {
        plan_code: 'enterprise',
        max_seats: 5,
        subscription_status: 'active',
      },
    });

    const { hasFeature } = usePlan();
    expect(hasFeature('payroll')).toBe(true);
  });

  it('should not show payroll for any plan when payrollEnabled is false', () => {
    // Override the mock for this test
    vi.doMock('@/lib/runtimeConfig', () => ({
      payrollEnabled: false,
    }));

    // Need to re-import for the mock to take effect
    const { usePlan: usePlanReloaded } = await import('./usePlan');

    mockUseAuth.mockReturnValue({
      organization: {
        plan_code: 'enterprise',
        max_seats: 5,
        subscription_status: 'active',
      },
    });

    const { hasFeature } = usePlanReloaded();
    expect(hasFeature('payroll')).toBe(false);
  });
});