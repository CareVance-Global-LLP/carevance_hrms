import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import PageHeader from '@/components/dashboard/PageHeader';
import MetricCard from '@/components/dashboard/MetricCard';
import Button from '@/components/ui/Button';
import { FieldLabel, TextInput } from '@/components/ui/FormField';
import { FeedbackBanner, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { payrollApi, payrollWorkspaceApi } from '@/services/api';
import { AlertTriangle, ArrowRight, Banknote, CalendarDays, CheckCircle2, Clock3, Receipt, RefreshCw, Users, Wallet } from 'lucide-react';
import PayrollSectionCard from '@/features/payroll/components/PayrollSectionCard';
import PayrollStatusBadge from '@/features/payroll/components/PayrollStatusBadge';
import { defaultPayrollMonth, formatPayrollCurrency, formatPayrollMonth } from '@/features/payroll/utils';

const formatShortDate = (value?: Date | null) => {
  if (!value || Number.isNaN(value.getTime())) return 'Not scheduled';
  return value.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const resolveUpcomingPayoutDate = (payrollMonth: string, paymentDay?: number) => {
  const normalizedDay = Number(paymentDay || 0);
  if (!/^\d{4}-\d{2}$/.test(payrollMonth) || normalizedDay < 1) return null;
  const [year, month] = payrollMonth.split('-').map(Number);
  const nextMonthIndex = month;
  const lastDay = new Date(year, nextMonthIndex + 1, 0).getDate();
  return new Date(year, nextMonthIndex, Math.min(normalizedDay, lastDay));
};

export default function PayrollOverviewView() {
  const [payrollMonth, setPayrollMonth] = useState(defaultPayrollMonth());
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const overviewQuery = useQuery({
    queryKey: ['payroll-overview-dashboard', payrollMonth],
    queryFn: async () => {
      const [overviewResponse, runsResponse, settingsResponse] = await Promise.all([
        payrollWorkspaceApi.overview({ payroll_month: payrollMonth }),
        payrollWorkspaceApi.getRuns({ payroll_month: payrollMonth }),
        payrollWorkspaceApi.settings(),
      ]);

      return {
        overview: overviewResponse.data,
        runs: runsResponse.data.data,
        settings: settingsResponse.data,
      };
    },
  });

  const handleGenerate = async () => {
    setFeedback(null);
    setIsGenerating(true);
    try {
      const response = await payrollApi.generateRecords({ payroll_month: payrollMonth });
      setFeedback({ tone: 'success', message: response.data.message || 'Payroll generation completed.' });
      await overviewQuery.refetch();
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to generate payroll.' });
    } finally {
      setIsGenerating(false);
    }
  };

  if (overviewQuery.isLoading) {
    return <PageLoadingState label="Loading payroll overview..." />;
  }

  if (overviewQuery.isError) {
    return <PageErrorState message={(overviewQuery.error as any)?.response?.data?.message || 'Failed to load payroll overview.'} onRetry={() => void overviewQuery.refetch()} />;
  }

  const { overview, runs, settings } = overviewQuery.data;
  const currentRun = overview.current_pay_run;
  const draftRuns = runs.filter((run) => run.status === 'draft').length;
  const processedRuns = runs.filter((run) => ['processed', 'approved', 'finalized', 'locked'].includes(run.status)).length;
  const paidRuns = runs.filter((run) => run.status === 'paid').length;
  const failedPayouts = runs.reduce((sum, run) => sum + Number(run.failed_payouts || 0), 0);
  const unresolvedWarnings = overview.readiness_warnings.length;
  const blockedItems = unresolvedWarnings + failedPayouts;
  const readyToProcessCount = Number(overview.status_distribution.processed || 0);
  const upcomingPayoutDate = resolveUpcomingPayoutDate(payrollMonth, Number(settings.payroll_calendar?.payment_day || 0));

  const priorityAction = (() => {
    if (!currentRun) {
      return {
        title: 'Create current pay run',
        description: 'Generate the payroll run for this cycle before validation, approvals, and payouts can start.',
        emphasis: 'No pay run exists for the selected cycle yet.',
        kind: 'generate' as const,
      };
    }
    if (unresolvedWarnings > 0) {
      return {
        title: 'Resolve employee setup blockers',
        description: 'Clear missing salary templates, payout details, and payroll readiness issues before final payroll review.',
        emphasis: `${unresolvedWarnings} unresolved payroll warnings are still open.`,
        kind: 'employees' as const,
      };
    }
    if (currentRun.status === 'draft') {
      return {
        title: 'Validate and approve pay run',
        description: 'The run is still in draft. Review warnings, validate the run, and move it toward approval.',
        emphasis: `${draftRuns} draft run${draftRuns === 1 ? '' : 's'} need attention.`,
        kind: 'runs' as const,
      };
    }
    if (currentRun.status === 'approved') {
      return {
        title: 'Process approved payroll',
        description: 'The run is approved and ready for payroll processing so payout can begin.',
        emphasis: `${readyToProcessCount} employee payroll record${readyToProcessCount === 1 ? '' : 's'} are already processed.`,
        kind: 'runs' as const,
      };
    }
    if (['processed', 'finalized', 'locked'].includes(currentRun.status)) {
      return {
        title: 'Complete payouts',
        description: 'Processed payroll is waiting for payout completion and payout exceptions should be reviewed now.',
        emphasis: `${failedPayouts} failed payout${failedPayouts === 1 ? '' : 's'} currently need follow-up.`,
        kind: 'runs' as const,
      };
    }
    return {
      title: 'Review issued payroll output',
      description: 'The run is paid. Confirm payslips and reports for the completed cycle.',
      emphasis: `${paidRuns} paid run${paidRuns === 1 ? '' : 's'} are already closed.`,
      kind: 'reports' as const,
    };
  })();

  const dueNextItems = [
    currentRun ? `Current run: ${currentRun.run_code} is ${currentRun.status}.` : 'Generate the first pay run for this cycle.',
    blockedItems > 0 ? `${blockedItems} blocked payroll items need resolution before payroll feels clean.` : 'No blocked payroll items are visible right now.',
    upcomingPayoutDate ? `Upcoming payout date is ${formatShortDate(upcomingPayoutDate)} based on payroll settings.` : 'Payment day is not configured in payroll settings yet.',
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Payroll workspace"
        title="Payroll Overview"
        description="Action-focused payroll summary for the current cycle with run health, blocked work, payout timing, and the next operational step."
        actions={(
          <>
            <div className="min-w-[11rem]">
              <FieldLabel>Payroll Month</FieldLabel>
              <TextInput type="month" value={payrollMonth} onChange={(event) => setPayrollMonth(event.target.value)} />
            </div>
            <Button variant="secondary" onClick={() => void overviewQuery.refetch()}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </>
        )}
      />

      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      <div className="overflow-hidden rounded-[32px] bg-[linear-gradient(135deg,#020617_0%,#0f172a_28%,#075985_70%,#38bdf8_100%)] p-6 text-white shadow-[0_38px_100px_-48px_rgba(2,6,23,0.92)]">
        <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-4">
            <div className="space-y-3">
              <p className="text-sm font-medium text-cyan-100/80">Current cycle</p>
              <h2 className="text-3xl font-semibold tracking-[-0.05em] sm:text-4xl">{formatPayrollMonth(payrollMonth)}</h2>
              <p className="max-w-3xl text-sm leading-7 text-cyan-50/90">
                Payroll now sits alongside attendance, leave, time edits, reimbursements, employee readiness, and payout tracking so the cycle feels like a native operational module inside CareVance.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-[24px] border border-white/12 bg-white/10 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.18em] text-cyan-100/70">Current run</p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="font-semibold text-white">{currentRun?.run_code || 'Not generated'}</p>
                  {currentRun ? <PayrollStatusBadge status={currentRun.status} /> : null}
                </div>
              </div>
              <div className="rounded-[24px] border border-white/12 bg-white/10 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.18em] text-cyan-100/70">Blocked items</p>
                <p className="mt-2 text-2xl font-semibold text-white">{blockedItems}</p>
                <p className="mt-2 text-sm text-cyan-50/80">Warnings plus failed payouts.</p>
              </div>
              <div className="rounded-[24px] border border-white/12 bg-white/10 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.18em] text-cyan-100/70">Upcoming payout</p>
                <p className="mt-2 text-lg font-semibold text-white">{formatShortDate(upcomingPayoutDate)}</p>
                <p className="mt-2 text-sm text-cyan-50/80">Driven by payroll settings.</p>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/14 bg-slate-950/24 p-5 backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-cyan-100/70">Due next</p>
                <h3 className="mt-2 text-xl font-semibold text-white">{priorityAction.title}</h3>
                <p className="mt-2 text-sm leading-6 text-cyan-50/85">{priorityAction.description}</p>
              </div>
              <PayrollStatusBadge status={blockedItems > 0 ? 'pending' : 'healthy'} />
            </div>

            <div className="mt-4 rounded-[22px] border border-white/10 bg-white/8 px-4 py-4">
              <p className="text-sm font-semibold text-white">{priorityAction.emphasis}</p>
              <div className="mt-4 flex flex-wrap gap-3">
                {priorityAction.kind === 'generate' ? (
                  <Button onClick={handleGenerate} disabled={isGenerating} className="bg-white text-sky-700 hover:bg-sky-50">
                    <Wallet className="h-4 w-4" />
                    {isGenerating ? 'Generating...' : 'Create Pay Run'}
                  </Button>
                ) : null}
                {priorityAction.kind === 'runs' ? (
                  <Link to="/payroll/runs" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-sky-700 transition hover:bg-sky-50">
                    <ArrowRight className="h-4 w-4" />
                    Open Pay Runs
                  </Link>
                ) : null}
                {priorityAction.kind === 'employees' ? (
                  <Link to="/payroll/employees" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-sky-700 transition hover:bg-sky-50">
                    <Users className="h-4 w-4" />
                    Resolve Employees
                  </Link>
                ) : null}
                {priorityAction.kind === 'reports' ? (
                  <Link to="/payroll/reports" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-sky-700 transition hover:bg-sky-50">
                    <Receipt className="h-4 w-4" />
                    Open Reports
                  </Link>
                ) : null}
                <Link to="/payroll/settings" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 text-sm font-semibold text-white transition hover:bg-white/18">
                  <CalendarDays className="h-4 w-4" />
                  Review Settings
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Employees In Payroll" value={overview.summary.employees_in_current_run} hint="Included in the current cycle." icon={Users} accent="sky" />
        <MetricCard label="Ready To Process" value={readyToProcessCount} hint="Processed payroll records waiting for payout completion." icon={CheckCircle2} accent="emerald" />
        <MetricCard label="Blocked Items" value={blockedItems} hint="Unresolved warnings and failed payouts." icon={AlertTriangle} accent="amber" />
        <MetricCard label="Failed Payouts" value={failedPayouts} hint="Requires retry or payout detail review." icon={AlertTriangle} accent="rose" />
        <MetricCard label="Draft Runs" value={draftRuns} hint="Still being prepared or reviewed." icon={Clock3} accent="amber" />
        <MetricCard label="Processed Runs" value={processedRuns} hint="Operationally ready for payout or closure." icon={Banknote} accent="violet" />
        <MetricCard label="Gross Payroll" value={formatPayrollCurrency(overview.summary.gross_payroll)} hint="Current cycle gross payroll." icon={Wallet} accent="sky" />
        <MetricCard label="Net Payroll" value={formatPayrollCurrency(overview.summary.net_payroll)} hint="Current cycle take-home total." icon={Wallet} accent="emerald" />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <PayrollSectionCard title="Operational Attention" description="Immediate run health, approval pressure, and what payroll needs next.">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Current pay run</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">{currentRun?.run_code || 'Not generated'}</p>
                </div>
                {currentRun ? <PayrollStatusBadge status={currentRun.status} /> : <PayrollStatusBadge status="draft" />}
              </div>
              <p className="mt-3 text-sm text-slate-500">
                {currentRun ? 'This run reflects the current payroll cycle and should drive validation, processing, payouts, and payslips.' : 'Generate payroll to create the operational pay run for this cycle.'}
              </p>
            </div>

            <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Pending approvals</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{overview.summary.pending_approvals}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <PayrollStatusBadge status={`${overview.pending_actions.leave_requests} leave`} />
                <PayrollStatusBadge status={`${overview.pending_actions.attendance_time_edits} time edits`} />
                <PayrollStatusBadge status={`${overview.pending_actions.payroll_adjustments} adjustments`} />
              </div>
            </div>

            <div className="rounded-[24px] border border-amber-200 bg-amber-50/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-amber-700">Unresolved warnings</p>
              <p className="mt-2 text-2xl font-semibold text-amber-950">{unresolvedWarnings}</p>
              <p className="mt-2 text-sm text-amber-900/80">Employees still missing payroll setup or payout readiness.</p>
            </div>

            <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Due next</p>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                {dueNextItems.map((item) => <p key={item}>{item}</p>)}
              </div>
            </div>
          </div>
        </PayrollSectionCard>

        <PayrollSectionCard title="Quick Access" description="Jump straight into the payroll area that best matches the current blocker or next action.">
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { label: 'Pay Runs', to: '/payroll/runs', value: runs.length, hint: 'Validate, approve, process, payout' },
              { label: 'Employees', to: '/payroll/employees', value: overview.quick_links.profiles, hint: 'Profile setup and readiness' },
              { label: 'Structures', to: '/payroll/structures', value: overview.quick_links.templates, hint: 'Templates and salary engine' },
              { label: 'Adjustments', to: '/payroll/adjustments', value: overview.quick_links.adjustments, hint: 'Variable pay and one-time changes' },
              { label: 'Payslips', to: '/payroll/payslips', value: overview.quick_links.payslips, hint: 'Generated cycle output' },
              { label: 'Reports', to: '/payroll/reports', value: processedRuns + paidRuns, hint: 'Finance and audit view' },
            ].map((item) => (
              <Link key={item.to} to={item.to} className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-4 transition hover:bg-white">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-slate-950">{item.label}</p>
                  <span className="text-sm font-semibold text-slate-950">{item.value}</span>
                </div>
                <p className="mt-2 text-sm text-slate-500">{item.hint}</p>
              </Link>
            ))}
          </div>
        </PayrollSectionCard>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <PayrollSectionCard title="Blocked Employees" description="Employees who still need payroll setup, payout details, or compensation configuration.">
          <div className="space-y-3">
            {overview.missing_profiles.length === 0 ? (
              <p className="text-sm text-slate-500">No payroll readiness warnings for the selected month.</p>
            ) : overview.missing_profiles.map((item) => (
              <div key={item.user_id} className="rounded-[22px] border border-amber-200 bg-amber-50/70 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-amber-950">{item.name}</p>
                    <p className="mt-1 text-sm text-amber-900/80">{item.email}</p>
                  </div>
                  <Link to={`/payroll/employees/${item.user_id}`}>
                    <Button size="sm" variant="secondary">Open Record</Button>
                  </Link>
                </div>
                <div className="mt-3 space-y-1 text-sm text-amber-900">
                  {item.warnings.slice(0, 3).map((warning) => <p key={warning}>{warning}</p>)}
                </div>
              </div>
            ))}
          </div>
        </PayrollSectionCard>

        <PayrollSectionCard title="Recent Payroll Activity" description="Latest payout and transaction activity for the selected payroll cycle.">
          <div className="space-y-3">
            {overview.recent_transactions.length === 0 ? (
              <p className="text-sm text-slate-500">No recent payroll activity found for this month.</p>
            ) : overview.recent_transactions.map((transaction) => (
              <div key={transaction.id} className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-950">{transaction.employee?.name || 'Employee'}</p>
                    <p className="mt-1 text-sm text-slate-500">{transaction.provider} payout | {new Date(transaction.created_at).toLocaleString()}</p>
                  </div>
                  <PayrollStatusBadge status={transaction.status} />
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-950">{formatPayrollCurrency(transaction.amount, transaction.currency)}</p>
              </div>
            ))}
          </div>
        </PayrollSectionCard>
      </div>
    </div>
  );
}
