import { ArrowLeft, IndianRupee } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import EmployeeDetailsSection from '../../../components/EmployeeDetailsSection';
import Button from '@/components/ui/Button';
import SalaryBreakdownView from '@/components/payroll/SalaryBreakdownView';
import { PageLoadingState, PageEmptyState } from '@/components/ui/PageState';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import type { AddUserWizardForm } from './types';

interface Step3Props {
  form: AddUserWizardForm;
  isCreatingUser: boolean;
  creationError: string | null;
  onGoBack: () => void;
}

export function Step3Profile({ form, isCreatingUser, creationError, onGoBack }: Step3Props) {
  const navigate = useNavigate();

  /*
   * Declared above the early returns below — a hook cannot be called
   * conditionally. `enabled` keeps it from firing until the account exists.
   *
   * No overrides are passed, so this is the employee's stored configuration:
   * the CTC and salary structure the wizard just posted on create.
   */
  const {
    data: breakdown,
    isLoading: breakdownLoading,
    error: breakdownError,
  } = useQuery({
    queryKey: ['employee-salary-breakdown', form.userId],
    queryFn: () => payrollApi.getEmployeeSalaryBreakdown(form.userId!).then((r) => r.data),
    enabled: !!form.userId,
    retry: false,
  });

  if (isCreatingUser) {
    return (
      <div className="px-6 py-16 text-center space-y-3">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
          <svg className="h-5 w-5 animate-spin text-blue-600" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-slate-700">Creating account...</p>
        <p className="text-xs text-slate-500">Setting up the employee profile for {form.email}</p>
      </div>
    );
  }

  if (creationError) {
    return (
      <div className="px-6 py-10 text-center space-y-4">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
          <span className="text-xl">!</span>
        </div>
        <p className="text-sm text-red-600 font-medium">{creationError}</p>
        <button
          onClick={onGoBack}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Go back and try again
        </button>
      </div>
    );
  }

  if (!form.userId) {
    return (
      <div className="px-6 py-10 text-center">
        <p className="text-sm text-slate-500">Unable to load profile. Please go back and try again.</p>
      </div>
    );
  }

  return (
    // The page scrolls; a step must not be a scroll container inside one.
    // This one clipped the salary breakup mid-table.
    <div>
      <div className="px-6 py-3 bg-blue-50 border-b border-blue-100">
        <p className="text-xs text-blue-700 font-medium">
          Complete the employee's profile below. All fields are optional — the employee can also fill them later.
        </p>
      </div>
      {/* py only: the wrapping section already pads horizontally, and three
          stacked paddings cost the breakup tables ~64px of width. */}
      <div className="space-y-6 py-4">
        <EmployeeDetailsSection
          userId={form.userId}
          employeeCode={form.employeeCode || String(form.userId ?? '')}
          editable
        />

        {/*
          Review only.

          The figures come from the server — the same
          /employee-cards/{id}/breakdown the payroll panel uses, computed by
          PayrollCalculatorService. This step deliberately offers no controls:
          the account has just been created and this is a check, not a place to
          reconfigure pay. To try a different structure, open the full panel.

          It used to render CtcBreakupPanel, which recomputed the whole split in
          TypeScript. Two engines for one number is how they drift apart.
        */}
        <section className="rounded-lg border border-border-strong bg-surface-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <IndianRupee className="h-4 w-4 text-slate-500" />
                <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">
                  Salary breakdown
                </h3>
              </div>
              <p className="mt-1 max-w-2xl text-sm text-slate-500">
                What the annual CTC entered in step 1 pays this employee month to month.
                For review — change it on the payroll card, not here.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                navigate(`/payroll/employee-pay?type=salary-breakdown&employee=${form.userId}`)
              }
            >
              Open full breakdown
            </Button>
          </div>

          <div className="mt-4">
            {breakdownLoading ? (
              <PageLoadingState label="Calculating breakdown…" />
            ) : breakdownError ? (
              <PageEmptyState
                title="No salary breakdown yet"
                description={getApiErrorMessage(
                  breakdownError,
                  'This employee has no annual CTC set, so there is nothing to break down.',
                )}
              />
            ) : breakdown ? (
              <SalaryBreakdownView breakdown={breakdown} />
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
