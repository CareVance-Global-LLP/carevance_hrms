import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Check } from 'lucide-react';
import { opsDashboardApi, payrollApi } from '@/services/api';

/**
 * What is waiting on the administrator, as chips.
 *
 * Three rules make this the first band on the page rather than a metric row:
 *
 * A CHIP WITH A ZERO COUNT IS NOT RENDERED. Eight zeroes teach somebody to
 * stop reading the strip, which is the one part of the page that must never be
 * skimmed. When everything is clear the strip collapses to a single line.
 *
 * A NULL IS NOT A ZERO. `pendingCounts` returns null for a queue it could not
 * count - the table is absent on this tenant - and a null chip is omitted
 * rather than shown as "0 waiting", which would be a false all-clear.
 *
 * A 403 OMITS THE CHIP TOO. An administrator without payroll rights must not
 * be told there is no payroll work; they must be told nothing, because they
 * are not the person who would action it.
 */
export default function AttentionStrip() {
  const navigate = useNavigate();

  const counts = useQuery({
    queryKey: ['ops', 'pending-counts'],
    queryFn: async () => (await opsDashboardApi.pendingCounts()).data.data,
    refetchInterval: 60_000,
  });

  const attention = useQuery({
    queryKey: ['ops', 'payroll-attention'],
    queryFn: async () => (await payrollApi.getDashboardAttention()).data,
    // A payroll-gated caller gets 403 here. One retry would not change that.
    retry: false,
    refetchInterval: 15 * 60_000,
  });

  const today = useQuery({
    queryKey: ['ops', 'today-summary'],
    queryFn: async () => (await opsDashboardApi.todaySummary()).data.data,
    refetchInterval: 60_000,
  });

  const c = counts.data;
  // Typed, not `any`: the client declares this shape, so a renamed field is a
  // compile error rather than a chip that silently reads zero.
  const a = attention.data?.attention;
  const t = today.data;

  type Chip = {
    key: string;
    count: number;
    noun: string;
    detail: string;
    tone: 'bad' | 'warn' | 'info';
    to: string;
  };

  const chips: Chip[] = [];

  const push = (chip: Chip) => {
    // Null and zero are both omitted, for different reasons - see the header.
    if (chip.count > 0) chips.push(chip);
  };

  /*
   * Rostered and not here leads, whenever a roster exists. It is the only
   * genuinely time-critical row: a line short two people at 09:30 is a
   * production decision taken by 09:45.
   */
  if (t?.roster.published) {
    push({
      key: 'absent',
      count: t.rostered_absent.count,
      noun: 'Rostered, not in',
      detail: 'No punch, not on leave',
      tone: 'bad',
      to: '/attendance',
    });
  }

  push({
    key: 'filings',
    count: c?.filings_overdue ?? 0,
    noun: 'Filings overdue',
    detail: 'A late return is a penalty',
    tone: 'bad',
    to: '/payroll?tab=tax-compliance',
  });

  push({
    key: 'leave',
    count: c?.leave ?? 0,
    noun: 'Leave approvals',
    detail: 'Somebody is waiting on a yes',
    tone: 'warn',
    to: '/approval-inbox?section=leave',
  });

  push({
    key: 'bank',
    count: a?.missing_bank_details ?? 0,
    noun: 'No bank account',
    detail: 'A payout line that will bounce',
    tone: 'warn',
    to: '/payroll',
  });

  push({
    key: 'pan',
    count: a?.missing_pan_uan ?? 0,
    noun: 'Missing PAN or UAN',
    detail: 'Filing reports not-ready',
    tone: 'warn',
    to: '/payroll',
  });

  push({
    key: 'edits',
    count: c?.time_edits ?? 0,
    noun: 'Time-edit requests',
    detail: 'Unapproved is unpaid',
    tone: 'info',
    to: '/approval-inbox?section=time',
  });

  push({
    key: 'reimb',
    count: c?.reimbursements ?? 0,
    noun: 'Reimbursements',
    detail: 'Money owed to staff, ageing',
    tone: 'info',
    to: '/payroll',
  });

  push({
    key: 'exits',
    count: c?.resignations ?? 0,
    noun: 'Resignations',
    detail: 'The notice clock has started',
    tone: 'info',
    to: '/employees',
  });

  if (counts.isLoading || today.isLoading) {
    return (
      <div className="flex gap-2.5 overflow-hidden" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[58px] w-52 shrink-0 animate-pulse rounded-[10px] bg-surface-sunken" />
        ))}
      </div>
    );
  }

  if (chips.length === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-[10px] border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3">
        <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
        <p className="text-sm text-slate-600">
          Nothing is waiting on you.
          {t?.roster.published === false ? ' No roster is published for today, so absence is not being checked.' : ''}
        </p>
      </div>
    );
  }

  const tones: Record<Chip['tone'], string> = {
    bad: 'border-red-500/35 bg-red-500/[0.07] text-red-700',
    warn: 'border-amber-500/35 bg-amber-500/[0.07] text-amber-700',
    info: 'border-sky-500/30 bg-sky-500/[0.07] text-sky-700',
  };

  return (
    <div className="flex gap-2.5 overflow-x-auto pb-1" role="list" aria-label="Waiting on you">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          role="listitem"
          onClick={() => navigate(chip.to)}
          className={`group flex shrink-0 items-center gap-2.5 rounded-[10px] border px-3.5 py-2.5 text-left transition-transform hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${tones[chip.tone]}`}
        >
          {chip.tone === 'bad' ? <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
          <span className="font-display text-xl font-bold leading-none tabular-nums">{chip.count}</span>
          <span className="leading-tight">
            <span className="block text-xs font-medium">{chip.noun}</span>
            <span className="block text-[11px] opacity-80">{chip.detail}</span>
          </span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
