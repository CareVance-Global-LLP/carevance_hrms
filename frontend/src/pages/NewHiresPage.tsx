import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarPlus,
  CheckCircle2,
  Search,
  UserPlus,
  X,
} from 'lucide-react';
import { onboardingApi, type ChecklistItem, type OnboardingJourney } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import Button from '@/components/ui/Button';
import { PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import SlideOver from '@/features/employees/SlideOver';
import ChecklistPanel from '@/features/lifecycle/ChecklistPanel';
import { formatDate } from '@/lib/dateTime';
import { FIELD_GROUP_LABEL, groupMissing, profileCompleteness } from '@/lib/employeeProfileFields';

/* ────────────────────────────────────────────────────────────────
   Grouping
   ──────────────────────────────────────────────────────────────── */

type BandKey = 'overdue' | 'this_week' | 'next_week' | 'later' | 'started';

const BANDS: Array<{ key: BandKey; label: string; hint: string }> = [
  { key: 'overdue', label: 'Needs attention', hint: 'Blocking work outstanding' },
  { key: 'this_week', label: 'Joining this week', hint: 'Next 7 days' },
  { key: 'next_week', label: 'Joining next week', hint: '8 – 14 days' },
  { key: 'later', label: 'Joining later', hint: 'More than 14 days away' },
  { key: 'started', label: 'Recently started', hint: 'Already with us' },
];

/**
 * Onboarding is anchored to a date, so the grouping is by *when*, not by a
 * status column. "Needs attention" outranks the date bands: a joiner three
 * weeks out with a blocking document missing matters more than one arriving
 * on Monday with everything done.
 */
const bandFor = (journey: OnboardingJourney): BandKey => {
  if (journey.readiness.blocking_overdue > 0) return 'overdue';
  const days = journey.days_until_joining;
  if (days < 0) return 'started';
  if (days <= 7) return 'this_week';
  if (days <= 14) return 'next_week';
  return 'later';
};

const initialsOf = (value: string): string => {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

/** Progress ring — readable at a glance where a bar or a fraction is not. */
function ReadinessRing({ done, total, alarm }: { done: number; total: number; alarm: boolean }) {
  const pct = total > 0 ? done / total : 0;
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  const stroke = alarm ? '#C8923A' : pct === 1 ? '#10B981' : '#5D969D';

  return (
    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center">
      <svg viewBox="0 0 36 36" className="h-10 w-10 -rotate-90">
        <circle cx="18" cy="18" r={radius} fill="none" stroke="#E4E8EB" strokeWidth="3" />
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
        />
      </svg>
      <span className="absolute text-[9px] font-bold tabular-nums text-slate-700">
        {done}/{total}
      </span>
    </span>
  );
}

/** What the person's record is still missing, by group. */
function ProfileGaps({ user }: { user: unknown }) {
  const completeness = profileCompleteness(user);
  const grouped = groupMissing(completeness.missing);

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
        <h4 className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Profile record</h4>
        <span className="text-[10px] font-bold tabular-nums text-slate-400">
          {completeness.filled}/{completeness.total}
        </span>
        {completeness.missingForPayroll.length > 0 ? (
          <span className="ml-auto rounded-full border border-accent-200 bg-accent-50 px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.06em] text-warning-800">
            {completeness.missingForPayroll.length} needed for payroll
          </span>
        ) : null}
      </div>

      {completeness.isComplete ? (
        <p className="px-3 py-3 text-xs text-slate-500">Everything on file.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {grouped.map(({ group, fields }) => (
            <div key={group} className="px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">
                {FIELD_GROUP_LABEL[group]}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">
                {fields.map((field) => field.label).join(' · ')}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   Create form
   ──────────────────────────────────────────────────────────────── */

function StartOnboardingForm({
  onCancel,
  onSubmit,
  saving,
}: {
  onCancel: () => void;
  onSubmit: (values: { candidate_name: string; candidate_email: string; joining_date: string; job_title?: string }) => void;
  saving: boolean;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [joining, setJoining] = useState('');
  const [title, setTitle] = useState('');

  const valid = name.trim() && email.trim() && joining;

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-slate-500">
        The journey opens now, not on the joining date — document collection and equipment happen
        in the run-up to Day 1.
      </p>

      {[
        { id: 'ob-name', label: 'Candidate name', value: name, set: setName, type: 'text', placeholder: 'Priya Shah' },
        { id: 'ob-email', label: 'Email', value: email, set: setEmail, type: 'email', placeholder: 'priya@example.com' },
        { id: 'ob-title', label: 'Job title', value: title, set: setTitle, type: 'text', placeholder: 'Backend Engineer' },
        { id: 'ob-joining', label: 'Joining date', value: joining, set: setJoining, type: 'date', placeholder: '' },
      ].map((field) => (
        <div key={field.id}>
          <label htmlFor={field.id} className="mb-1 block text-xs font-bold text-slate-700">
            {field.label}
          </label>
          <input
            id={field.id}
            type={field.type}
            value={field.value}
            placeholder={field.placeholder}
            onChange={(event) => field.set(event.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:outline-none"
          />
        </div>
      ))}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          size="sm"
          loading={saving}
          disabled={!valid}
          onClick={() =>
            onSubmit({
              candidate_name: name.trim(),
              candidate_email: email.trim(),
              joining_date: joining,
              job_title: title.trim() || undefined,
            })
          }
        >
          Start onboarding
        </Button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   Page
   ──────────────────────────────────────────────────────────────── */

export default function NewHiresPage() {
  const { isLoading: authLoading, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyItemId, setBusyItemId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const journeysQuery = useQuery({
    queryKey: ['onboarding-journeys'],
    queryFn: async () => (await onboardingApi.list()).data.data,
    enabled: isAuthenticated && !authLoading,
  });

  const detailQuery = useQuery({
    queryKey: ['onboarding-journey', openId],
    queryFn: async () => (await onboardingApi.show(openId as number)).data.data,
    enabled: openId !== null,
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['onboarding-journeys'] }),
      queryClient.invalidateQueries({ queryKey: ['onboarding-journey', openId] }),
    ]);
  };

  const createMutation = useMutation({
    mutationFn: async (values: Parameters<typeof onboardingApi.create>[0]) =>
      (await onboardingApi.create(values)).data.data,
    onSuccess: async (journey) => {
      setCreating(false);
      setFeedback({ tone: 'success', message: `Onboarding started for ${journey.candidate_name}.` });
      await invalidate();
    },
    onError: (error: any) => {
      setFeedback({
        tone: 'error',
        message: error?.response?.data?.message || 'Could not start that onboarding.',
      });
    },
  });

  const toggleItem = async (item: ChecklistItem, complete: boolean) => {
    if (openId === null) return;
    setBusyItemId(item.id);
    try {
      if (complete) await onboardingApi.completeItem(openId, item.id);
      else await onboardingApi.reopenItem(openId, item.id);
      await invalidate();
    } catch (error: any) {
      setFeedback({
        tone: 'error',
        message: error?.response?.data?.message || 'Could not update that item.',
      });
    } finally {
      setBusyItemId(null);
    }
  };

  const journeys = journeysQuery.data ?? [];

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return journeys;
    return journeys.filter((journey) =>
      [journey.candidate_name, journey.candidate_email, journey.job_title]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }, [journeys, query]);

  const banded = useMemo(() => {
    const map = new Map<BandKey, OnboardingJourney[]>();
    filtered
      .filter((journey) => journey.stage !== 'completed' && journey.stage !== 'cancelled')
      .forEach((journey) => {
        const band = bandFor(journey);
        map.set(band, [...(map.get(band) ?? []), journey]);
      });
    map.forEach((list) => list.sort((a, b) => a.days_until_joining - b.days_until_joining));
    return map;
  }, [filtered]);

  const attentionCount = banded.get('overdue')?.length ?? 0;
  const openJourney = detailQuery.data ?? null;

  if (journeysQuery.isLoading) return <PageLoadingState label="Loading onboarding…" />;
  if (journeysQuery.isError) {
    return <PageErrorState message="Could not load onboarding journeys." onRetry={() => void journeysQuery.refetch()} />;
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
          <button type="button" onClick={() => setFeedback(null)} aria-label="Dismiss" className="text-slate-400">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
            <UserPlus className="h-4 w-4" />
          </span>
          <div>
            <h1 className="text-lg font-bold tracking-[-0.025em] text-slate-950">Onboarding</h1>
            <p className="text-[11px] font-medium text-slate-500">
              <span className="font-bold text-slate-900">{filtered.length}</span> joiners in progress
            </p>
          </div>
        </div>

        {attentionCount > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-200 bg-accent-50 px-2.5 py-1 text-[11px] font-semibold text-warning-800">
            <AlertTriangle className="h-3 w-3" />
            {attentionCount} {attentionCount === 1 ? 'needs' : 'need'} attention
          </span>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search joiners"
              aria-label="Search joiners"
              className="w-52 rounded-lg border border-slate-200 py-1.5 pl-9 pr-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
            />
          </div>
          <Button size="sm" iconLeft={<CalendarPlus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Start onboarding
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
          <p className="text-sm font-semibold text-slate-900">Nobody is being onboarded</p>
          <p className="mt-1 text-sm text-slate-500">
            Start a journey as soon as someone accepts — the paperwork happens before Day 1.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {BANDS.map((band) => {
            const rows = banded.get(band.key) ?? [];
            if (rows.length === 0) return null;

            return (
              <section key={band.key}>
                <div className="mb-2 flex items-baseline gap-2">
                  <h2
                    className={`text-[11px] font-bold uppercase tracking-[0.12em] ${
                      band.key === 'overdue' ? 'text-warning-800' : 'text-slate-500'
                    }`}
                  >
                    {band.label}
                  </h2>
                  <span className="text-[10px] font-semibold tabular-nums text-slate-400">{rows.length}</span>
                  <span className="text-[10px] text-slate-400">· {band.hint}</span>
                </div>

                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  {rows.map((journey, index) => (
                    <button
                      key={journey.id}
                      type="button"
                      onClick={() => setOpenId(journey.id)}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-blue-50 ${
                        index > 0 ? 'border-t border-slate-100' : ''
                      }`}
                    >
                      <ReadinessRing
                        done={journey.readiness.done}
                        total={journey.readiness.total}
                        alarm={journey.readiness.blocking_overdue > 0}
                      />

                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">
                        {initialsOf(journey.candidate_name)}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-bold text-slate-950">
                          {journey.candidate_name}
                        </span>
                        <span className="block truncate text-[11px] text-slate-500">
                          {journey.job_title || journey.candidate_email}
                        </span>
                      </span>

                      <span className="hidden shrink-0 text-right sm:block">
                        <span className="block text-[11px] font-bold text-slate-700">
                          {formatDate(journey.joining_date)}
                        </span>
                        <span className="block text-[10px] font-semibold text-slate-400">
                          {journey.days_until_joining === 0
                            ? 'Joins today'
                            : journey.days_until_joining > 0
                              ? `in ${journey.days_until_joining} day${journey.days_until_joining === 1 ? '' : 's'}`
                              : `${Math.abs(journey.days_until_joining)} day${Math.abs(journey.days_until_joining) === 1 ? '' : 's'} ago`}
                        </span>
                      </span>

                      {journey.readiness.blocking_overdue > 0 ? (
                        <span className="shrink-0 rounded-full border border-accent-200 bg-accent-50 px-2 py-0.5 text-[10px] font-bold text-warning-800">
                          {journey.readiness.blocking_overdue} blocking
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <SlideOver
        open={creating}
        title="Start onboarding"
        subtitle="Opens a journey and its checklist"
        onClose={() => setCreating(false)}
      >
        <StartOnboardingForm
          saving={createMutation.isPending}
          onCancel={() => setCreating(false)}
          onSubmit={(values) => createMutation.mutate(values)}
        />
      </SlideOver>

      <SlideOver
        open={openId !== null}
        title={openJourney?.candidate_name ?? 'Loading…'}
        subtitle={
          openJourney
            ? `Joining ${formatDate(openJourney.joining_date)}${openJourney.job_title ? ` · ${openJourney.job_title}` : ''}`
            : undefined
        }
        onClose={() => setOpenId(null)}
        footer={
          <Button variant="secondary" size="sm" iconLeft={<ArrowLeft className="h-3.5 w-3.5" />} onClick={() => setOpenId(null)}>
            Back to timeline
          </Button>
        }
      >
        {detailQuery.isLoading || !openJourney ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading journey…</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Ready', value: `${openJourney.readiness.done}/${openJourney.readiness.total}` },
                { label: 'Overdue', value: openJourney.readiness.overdue },
                // Blocking work still open, not just the part that has already
                // run late — a panel headed "Blocking 0" beside four items
                // badged BLOCKING is the opposite of reassuring.
                { label: 'Blocking', value: openJourney.readiness.blocking_outstanding ?? openJourney.readiness.blocking_overdue },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg border border-slate-200 px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{stat.label}</p>
                  <p
                    className={`mt-0.5 text-sm font-bold tabular-nums ${
                      stat.label === 'Blocking' && Number(stat.value) > 0 ? 'text-warning-800' : 'text-slate-900'
                    }`}
                  >
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>

            {/*
              What the record itself is still missing, measured against the same
              registry the Employees page uses. A ticked checklist and an empty
              profile used to be able to coexist quite happily.
            */}
            {openJourney.user ? <ProfileGaps user={openJourney.user} /> : null}

            <ChecklistPanel
              items={openJourney.checklist_items ?? []}
              canEdit
              busyItemId={busyItemId}
              onComplete={(item) => void toggleItem(item, true)}
              onReopen={(item) => void toggleItem(item, false)}
            />
          </div>
        )}
      </SlideOver>
    </div>
  );
}
