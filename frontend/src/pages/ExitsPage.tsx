import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  DoorOpen,
  Lock,
  Search,
  ShieldOff,
  X,
} from 'lucide-react';
import {
  exitApi,
  type ChecklistItem,
  type EmployeeExit,
  type ExitStage,
  type RehireDecision,
} from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { hasPayrollAdminAccess, hasStrictAdminAccess } from '@/lib/permissions';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import { PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import SlideOver from '@/features/employees/SlideOver';
import ChecklistPanel from '@/features/lifecycle/ChecklistPanel';
import { formatDate } from '@/lib/dateTime';

const STAGES: Array<{ key: ExitStage; label: string; hint: string }> = [
  { key: 'notice', label: 'Serving notice', hint: 'Still working' },
  { key: 'clearance', label: 'Clearance', hint: 'Handover and returns' },
  { key: 'settlement', label: 'Settlement', hint: 'Final pay' },
  { key: 'closed', label: 'Closed', hint: 'Complete' },
];

const REASONS = [
  'compensation', 'career_growth', 'management', 'work_life_balance',
  'relocation', 'health', 'higher_studies', 'role_mismatch', 'culture', 'other',
] as const;

/*
 * The employer's decision. Kept in its own block, with its own wording, well
 * away from the exit interview: `interview.would_rejoin` is the LEAVER's answer
 * to a near-identical question, and two look-alike verdicts on one screen is
 * how somebody reads one and acts on the other. Naming the owner of each
 * answer is the whole point of the labels.
 */
const REHIRE_OPTIONS: Array<{ value: RehireDecision; label: string }> = [
  { value: 'undecided', label: 'Not decided yet' },
  { value: 'eligible', label: 'Eligible for rehire' },
  { value: 'not_eligible', label: 'Not eligible for rehire' },
];

const REHIRE_TONE: Record<RehireDecision, 'neutral' | 'success' | 'danger'> = {
  undecided: 'neutral',
  eligible: 'success',
  not_eligible: 'danger',
};

const initialsOf = (value: string): string => {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export default function ExitsPage() {
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = hasStrictAdminAccess(user);

  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [busyItemId, setBusyItemId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [reason, setReason] = useState('');
  const [comments, setComments] = useState('');
  /*
   * Carries the exit it belongs to, so opening a different person's drawer
   * falls back to THEIR recorded decision instead of showing the last one
   * somebody typed.
   */
  const [rehireDraft, setRehireDraft] = useState<
    { exitId: number; value: RehireDecision; note: string } | null
  >(null);

  const exitsQuery = useQuery({
    queryKey: ['employee-exits'],
    queryFn: async () => (await exitApi.list()).data.data,
    enabled: isAuthenticated && !authLoading,
  });

  const detailQuery = useQuery({
    queryKey: ['employee-exit', openId],
    queryFn: async () => (await exitApi.show(openId as number)).data.data,
    enabled: openId !== null,
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['employee-exits'] }),
      queryClient.invalidateQueries({ queryKey: ['employee-exit', openId] }),
    ]);
  };

  const advanceMutation = useMutation({
    mutationFn: async ({ id, stage }: { id: number; stage: ExitStage }) =>
      (await exitApi.advance(id, stage)).data.data,
    onSuccess: async (_data, variables) => {
      setFeedback({ tone: 'success', message: `Moved to ${variables.stage}.` });
      await invalidate();
    },
    onError: (error: any) => {
      // A refused settlement is the gate doing its job, not a fault.
      setFeedback({
        tone: 'error',
        message: error?.response?.data?.message || 'Could not move this exit.',
      });
    },
  });

  const rehireMutation = useMutation({
    mutationFn: async ({ id, value, note }: { id: number; value: RehireDecision; note: string }) =>
      (await exitApi.setRehireEligibility(id, { rehire_eligibility: value, note: note || undefined })).data.data,
    onSuccess: async () => {
      setRehireDraft(null);
      setFeedback({ tone: 'success', message: 'Rehire decision recorded.' });
      await invalidate();
    },
    onError: (error: any) => {
      setFeedback({
        tone: 'error',
        message: error?.response?.data?.message || 'Could not record the rehire decision.',
      });
    },
  });

  const toggleItem = async (item: ChecklistItem, complete: boolean) => {
    if (openId === null) return;
    setBusyItemId(item.id);
    try {
      if (complete) await exitApi.completeItem(openId, item.id);
      else await exitApi.reopenItem(openId, item.id);
      await invalidate();
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Could not update that item.' });
    } finally {
      setBusyItemId(null);
    }
  };

  const saveInterview = async () => {
    if (openId === null) return;
    try {
      await exitApi.saveInterview(openId, { primary_reason: reason || null, comments: comments || null });
      setFeedback({ tone: 'success', message: 'Exit interview saved.' });
      await invalidate();
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Could not save the interview.' });
    }
  };

  const exits = exitsQuery.data ?? [];

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return exits;
    return exits.filter((exit) =>
      [exit.user?.name, exit.user?.email, exit.exit_type]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }, [exits, query]);

  const byStage = useMemo(() => {
    const map = new Map<ExitStage, EmployeeExit[]>();
    filtered.forEach((exit) => map.set(exit.stage, [...(map.get(exit.stage) ?? []), exit]));
    map.forEach((list) => list.sort((a, b) => a.days_remaining - b.days_remaining));
    return map;
  }, [filtered]);

  const blockedCount = useMemo(
    () => filtered.filter((exit) => exit.clearance_progress.blocking_outstanding > 0 && exit.stage !== 'closed').length,
    [filtered]
  );

  const openExit = detailQuery.data ?? null;
  const canSettle = openExit ? openExit.clearance_progress.blocking_outstanding === 0 : false;

  /* Level <= 20 — admin, HR and payroll_manager, matching the API's own gate. */
  const canDecideRehire = hasPayrollAdminAccess(user);
  const isDraftForOpenExit = openExit !== null && rehireDraft?.exitId === openExit.id;
  const rehireValue: RehireDecision = isDraftForOpenExit
    ? (rehireDraft as { value: RehireDecision }).value
    : openExit?.rehire_eligibility ?? 'undecided';
  const rehireNote = isDraftForOpenExit
    ? (rehireDraft as { note: string }).note
    : openExit?.rehire_note ?? '';
  const rehireIsDirty =
    openExit !== null &&
    (rehireValue !== (openExit.rehire_eligibility ?? 'undecided') || rehireNote !== (openExit.rehire_note ?? ''));

  if (exitsQuery.isLoading) return <PageLoadingState label="Loading exits…" />;
  if (exitsQuery.isError) {
    return <PageErrorState message="Could not load exits." onRetry={() => void exitsQuery.refetch()} />;
  }

  return (
    <div className="w-full space-y-4 pb-8 text-slate-900">
      {feedback ? (
        <div
          className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${
            feedback.tone === 'success'
              ? 'border-success-100 bg-success-50 text-success-800'
              : 'border-danger-100 bg-danger-50 text-danger-800'
          }`}
        >
          {feedback.tone === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <p className="flex-1">{feedback.message}</p>
          <button type="button" onClick={() => setFeedback(null)} aria-label="Dismiss" className="text-slate-500">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
            <DoorOpen className="h-4 w-4" />
          </span>
          <div>
            <h1 className="text-lg font-bold tracking-[-0.025em] text-slate-950">Exits</h1>
            <p className="text-[11px] font-medium text-slate-500">
              <span className="font-bold text-slate-900">{filtered.length}</span> in progress
            </p>
          </div>
        </div>

        {blockedCount > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-200 bg-accent-50 px-2.5 py-1 text-[11px] font-semibold text-warning-800">
            <Lock className="h-3 w-3" />
            {blockedCount} blocked on clearance
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search people"
              aria-label="Search exits"
              className="w-52 rounded-lg border border-slate-200 py-1.5 pl-9 pr-3 text-xs text-slate-800 placeholder:text-slate-500 focus:border-blue-400 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
          <p className="text-sm font-semibold text-slate-900">No exits in progress</p>
          <p className="mt-1 text-sm text-slate-500">
            An exit opens automatically when a resignation is approved.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {STAGES.map((stage) => {
            const rows = byStage.get(stage.key) ?? [];
            if (rows.length === 0) return null;

            return (
              <section key={stage.key}>
                <div className="mb-2 flex items-baseline gap-2">
                  <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">{stage.label}</h2>
                  <span className="text-[10px] font-semibold tabular-nums text-slate-500">{rows.length}</span>
                  <span className="text-[10px] text-slate-500">· {stage.hint}</span>
                </div>

                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  {rows.map((exit, index) => {
                    const blocked = exit.clearance_progress.blocking_outstanding > 0;
                    return (
                      <button
                        key={exit.id}
                        type="button"
                        onClick={() => setOpenId(exit.id)}
                        className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-blue-50 ${
                          index > 0 ? 'border-t border-slate-100' : ''
                        }`}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">
                          {initialsOf(exit.user?.name ?? '?')}
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-bold text-slate-950">
                            {exit.user?.name ?? 'Unknown'}
                          </span>
                          <span className="block truncate text-[11px] capitalize text-slate-500">
                            {exit.exit_type.replace('_', ' ')}
                            {exit.shortfall_days > 0 ? ` · ${exit.shortfall_days} days short of notice` : ''}
                          </span>
                        </span>

                        <span className="hidden shrink-0 text-right sm:block">
                          <span className="block text-[11px] font-bold text-slate-700">
                            {formatDate(exit.last_working_date)}
                          </span>
                          <span className="block text-[10px] font-semibold text-slate-500">
                            {exit.days_remaining > 0
                              ? `${exit.days_remaining} day${exit.days_remaining === 1 ? '' : 's'} left`
                              : exit.days_remaining === 0
                                ? 'Last day today'
                                : 'Left the company'}
                          </span>
                        </span>

                        <span className="shrink-0 text-[10px] font-bold tabular-nums text-slate-500">
                          {exit.clearance_progress.done}/{exit.clearance_progress.total}
                        </span>

                        {blocked ? (
                          <span className="shrink-0 rounded-full border border-accent-200 bg-accent-50 px-2 py-0.5 text-[10px] font-bold text-warning-800">
                            {exit.clearance_progress.blocking_outstanding} blocking
                          </span>
                        ) : null}

                        {exit.access_revoked_at ? (
                          <span title="Access revoked">
                            <ShieldOff className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <SlideOver
        open={openId !== null}
        title={openExit?.user?.name ?? 'Loading…'}
        subtitle={
          openExit
            ? `Last working day ${formatDate(openExit.last_working_date)} · ${openExit.exit_type}`
            : undefined
        }
        onClose={() => setOpenId(null)}
        footer={
          openExit ? (
            <>
              {/* The gate, made visible. A disabled button with a reason beats a
                  request that fails after the click. */}
              {openExit.stage === 'clearance' || openExit.stage === 'notice' ? (
                <Button
                  size="sm"
                  disabled={!canSettle || advanceMutation.isPending}
                  title={canSettle ? undefined : 'Clearance is not complete'}
                  onClick={() => advanceMutation.mutate({ id: openExit.id, stage: 'settlement' })}
                >
                  {canSettle ? 'Move to settlement' : 'Blocked by clearance'}
                </Button>
              ) : null}
              {openExit.stage === 'settlement' ? (
                <Button
                  size="sm"
                  loading={advanceMutation.isPending}
                  onClick={() => advanceMutation.mutate({ id: openExit.id, stage: 'closed' })}
                >
                  Close exit
                </Button>
              ) : null}
            </>
          ) : null
        }
      >
        {detailQuery.isLoading || !openExit ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading exit…</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Notice', value: `${openExit.served_days}/${openExit.notice_period_days}d` },
                { label: 'Shortfall', value: `${openExit.shortfall_days}d`, warn: openExit.shortfall_days > 0 },
                {
                  label: 'Blocking',
                  value: openExit.clearance_progress.blocking_outstanding,
                  warn: openExit.clearance_progress.blocking_outstanding > 0,
                },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg border border-slate-200 px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{stat.label}</p>
                  <p
                    className={`mt-0.5 text-sm font-bold tabular-nums ${
                      stat.warn ? 'text-warning-800' : 'text-slate-900'
                    }`}
                  >
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>

            {openExit.access_revoked_at ? (
              <p className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <ShieldOff className="h-3.5 w-3.5 shrink-0" />
                Access revoked {formatDate(openExit.access_revoked_at)}
              </p>
            ) : isAdmin && openExit.days_remaining <= 0 ? (
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                iconLeft={<ShieldOff className="h-3.5 w-3.5" />}
                onClick={async () => {
                  await exitApi.revokeAccess(openExit.id);
                  setFeedback({ tone: 'success', message: 'Access revoked.' });
                  await invalidate();
                }}
              >
                Revoke access now
              </Button>
            ) : null}

            {/* Would we take them back? — OUR answer. The leaver's own answer
                lives with the exit interview below and is a different fact. */}
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  Rehire decision (ours)
                </p>
                <StatusBadge tone={REHIRE_TONE[rehireValue]} className="px-2 py-0.5 tracking-[0.1em]">
                  {REHIRE_OPTIONS.find((option) => option.value === rehireValue)?.label ?? rehireValue}
                </StatusBadge>
              </div>

              {openExit.rejoined_at ? (
                <p className="mt-2 text-xs text-slate-600">
                  Rejoined {formatDate(openExit.rejoined_at)}
                  {openExit.previous_joining_date
                    ? ` · earlier service started ${formatDate(openExit.previous_joining_date)}`
                    : ''}
                </p>
              ) : null}

              {canDecideRehire ? (
                <div className="mt-2 space-y-2">
                  <select
                    value={rehireValue}
                    onChange={(event) =>
                      setRehireDraft({
                        exitId: openExit.id,
                        value: event.target.value as RehireDecision,
                        note: rehireNote,
                      })
                    }
                    aria-label="Rehire decision"
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800"
                  >
                    {REHIRE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <textarea
                    value={rehireNote}
                    onChange={(event) =>
                      setRehireDraft({ exitId: openExit.id, value: rehireValue, note: event.target.value })
                    }
                    rows={2}
                    aria-label="Rehire note"
                    placeholder="Why — for whoever reads this in two years"
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-500"
                  />
                  <Button
                    size="sm"
                    disabled={!rehireIsDirty}
                    loading={rehireMutation.isPending}
                    onClick={() =>
                      rehireMutation.mutate({ id: openExit.id, value: rehireValue, note: rehireNote })
                    }
                  >
                    Save rehire decision
                  </Button>
                </div>
              ) : openExit.rehire_note ? (
                <p className="mt-2 text-xs leading-relaxed text-slate-600">{openExit.rehire_note}</p>
              ) : null}
            </div>

            <ChecklistPanel
              items={openExit.checklist_items ?? []}
              canEdit={openExit.stage !== 'closed'}
              busyItemId={busyItemId}
              onComplete={(item) => void toggleItem(item, true)}
              onReopen={(item) => void toggleItem(item, false)}
            />

            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Exit interview</p>
              {openExit.interview?.submitted_at ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <p className="font-semibold capitalize text-slate-800">
                    {openExit.interview.primary_reason?.replace('_', ' ') ?? 'Recorded'}
                  </p>
                  {openExit.interview.would_rejoin !== null ? (
                    <p className="mt-1">
                      Would they rejoin? (their answer):{' '}
                      <span className="font-semibold text-slate-800">
                        {openExit.interview.would_rejoin ? 'Yes' : 'No'}
                      </span>
                    </p>
                  ) : null}
                  {openExit.interview.comments ? (
                    <p className="mt-1 leading-relaxed">{openExit.interview.comments}</p>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                  <select
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    aria-label="Primary reason for leaving"
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800"
                  >
                    <option value="">Primary reason…</option>
                    {REASONS.map((value) => (
                      <option key={value} value={value} className="capitalize">
                        {value.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                  <textarea
                    value={comments}
                    onChange={(event) => setComments(event.target.value)}
                    rows={3}
                    placeholder="What would have made them stay?"
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-500"
                  />
                  <Button size="sm" disabled={!reason} onClick={() => void saveInterview()}>
                    Save interview
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </SlideOver>
    </div>
  );
}
