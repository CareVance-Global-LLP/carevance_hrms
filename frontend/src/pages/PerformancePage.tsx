import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Lock,
  Plus,
  Search,
  Star,
  Target,
  Trash2,
} from 'lucide-react';
import {
  performanceApi,
  type Aggregate360,
  type CompetencyRating,
  type CycleParticipant,
  type CyclePhase,
  type PerformanceReview,
  type ReviewCycle,
  type ReviewSummary,
} from '@/services/performanceApi';
import { userApi, getApiErrorMessage } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmployeeSelect from '@/components/ui/EmployeeSelect';
import { FieldLabel, TextInput, TextareaInput, SelectInput, ToggleInput } from '@/components/ui/FormField';
import { FeedbackBanner, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';
import MetricCard from '@/components/dashboard/MetricCard';
import SlideOver from '@/features/employees/SlideOver';
import { cn } from '@/utils/cn';

type ScopeTab = 'mine' | 'team' | 'all';

const REVIEW_TYPE_LABELS: Record<PerformanceReview['review_type'], string> = {
  self: 'Self',
  manager: 'Manager',
  peer: 'Peer',
  '360': '360°',
};

const REVIEW_TYPE_TONES: Record<PerformanceReview['review_type'], 'neutral' | 'info' | 'success' | 'warning'> = {
  self: 'neutral',
  manager: 'info',
  peer: 'success',
  '360': 'warning',
};

const STATUS_TONES: Record<string, 'success' | 'warning' | 'neutral'> = {
  completed: 'success',
  draft: 'warning',
  archived: 'neutral',
};

// Legacy rows can hold non-canonical statuses (e.g. "in_progress")
const statusLabel = (status: string) => status.replace(/_/g, ' ');

const RATING_LABELS: Record<number, string> = {
  5: 'Outstanding',
  4: 'Exceeds expectations',
  3: 'Meets expectations',
  2: 'Needs improvement',
  1: 'Unsatisfactory',
};

const AVATAR_COLORS = ['bg-blue-600', 'bg-blue-700', 'bg-accent-400', 'bg-slate-500', 'bg-emerald-600'];

function initials(name?: string) {
  if (!name) return '?';
  return name
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function Avatar({ id, name }: { id: number; name?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white',
        AVATAR_COLORS[id % AVATAR_COLORS.length]
      )}
    >
      {initials(name)}
    </span>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatPeriod(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const sLabel = s.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: s.getFullYear() === e.getFullYear() ? undefined : 'numeric',
  });
  return `${sLabel} – ${e.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function toDateInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function currentQuarter() {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3);
  return {
    label: `Q${q + 1} ${now.getFullYear()}`,
    start: new Date(now.getFullYear(), q * 3, 1),
    end: new Date(now.getFullYear(), q * 3 + 3, 0),
  };
}

function periodsOverlap(aStart: string, aEnd: string, bStart: Date, bEnd: Date) {
  return new Date(aStart) <= bEnd && new Date(aEnd) >= bStart;
}

/** Legacy rows store these JSON fields as strings (sometimes double-encoded) or keyed objects, not arrays. */
function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter((s) => s.trim());
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        return toList(JSON.parse(trimmed));
      } catch {
        return [trimmed];
      }
    }
    return [trimmed];
  }
  if (value && typeof value === 'object') return Object.values(value).map(String).filter((s) => s.trim());
  return [];
}

function RatingStars({ rating, size = 'sm' }: { rating: number | null; size?: 'sm' | 'lg' }) {
  if (!rating) return <span className="text-xs text-slate-500">Not rated</span>;
  const starClass = size === 'lg' ? 'h-5 w-5' : 'h-3.5 w-3.5';
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={cn(starClass, star <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-200')}
          />
        ))}
      </span>
      <span className={cn('font-semibold text-slate-700', size === 'lg' ? 'text-base' : 'text-xs')}>
        {rating.toFixed(1)}
      </span>
    </span>
  );
}

function ReviewNotes({ review }: { review: PerformanceReview }) {
  const strengths = toList(review.strengths);
  const improvements = toList(review.areas_for_improvement);
  const goals = toList(review.goals);
  return (
    <div className="space-y-4">
      {review.comments ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Comments</p>
          <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-600">{review.comments}</p>
        </div>
      ) : null}
      {strengths.length ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Strengths</p>
          <ul className="mt-1.5 space-y-1">
            {strengths.map((item, index) => (
              <li key={index} className="flex items-start gap-2 text-sm text-slate-600">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {improvements.length ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Areas for improvement</p>
          <ul className="mt-1.5 space-y-1">
            {improvements.map((item, index) => (
              <li key={index} className="flex items-start gap-2 text-sm text-slate-600">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {goals.length ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Goals</p>
          <ul className="mt-1.5 space-y-1">
            {goals.map((item, index) => (
              <li key={index} className="flex items-start gap-2 text-sm text-slate-600">
                <Target className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ReviewPane({ review, heading }: { review: PerformanceReview; heading: string }) {
  return (
    <div className="min-w-0 space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">{heading}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          by {review.reviewer?.name || 'Anonymous'} · {formatDate(review.updated_at)}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <RatingStars rating={review.overall_rating} size="lg" />
          {review.overall_rating ? (
            <span className="text-xs text-slate-500">{RATING_LABELS[review.overall_rating]}</span>
          ) : null}
        </div>
      </div>
      <ReviewNotes review={review} />
    </div>
  );
}

const CYCLE_STEPS = [
  { id: 'self', label: 'Self-assessment' },
  { id: 'manager', label: 'Manager review' },
  { id: 'shared', label: 'Results shared' },
] as const;

function CycleBanner({
  cycle,
  me,
  counts,
  onStartSelf,
  onStartManager,
}: {
  cycle: ReviewCycle;
  me: CycleParticipant | null;
  counts?: { enrolled: number; self_done: number; manager_done: number };
  onStartSelf: () => void;
  onStartManager: () => void;
}) {
  const currentIndex = cycle.phase === 'self' ? 0 : cycle.phase === 'manager' ? 1 : 2;
  const selfPending = cycle.phase === 'self' && Boolean(me) && !me?.self_review_id;

  const stepHint = (id: (typeof CYCLE_STEPS)[number]['id']) => {
    if (id === 'self') {
      const done = counts ? `${counts.self_done}/${counts.enrolled} done` : null;
      const due = cycle.self_due ? `due ${formatDate(cycle.self_due)}` : null;
      return [due, done].filter(Boolean).join(' · ');
    }
    if (id === 'manager') {
      const done = counts ? `${counts.manager_done}/${counts.enrolled} done` : null;
      const due = cycle.manager_due ? `due ${formatDate(cycle.manager_due)}` : null;
      return [due, done].filter(Boolean).join(' · ');
    }
    return cycle.share_date ? formatDate(cycle.share_date) : '';
  };

  return (
    <SurfaceCard className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">Active review cycle</p>
          <p className="mt-0.5 text-base font-bold text-slate-900">
            {cycle.name}
            <span className="ml-2 text-xs font-normal text-slate-500">
              {formatPeriod(cycle.period_start, cycle.period_end)}
            </span>
          </p>
        </div>
        {selfPending ? (
          <Button onClick={onStartSelf}>Start self-assessment</Button>
        ) : cycle.phase === 'manager' ? (
          <Button onClick={onStartManager}>Write manager review</Button>
        ) : null}
      </div>
      <div className="mt-4 flex items-center overflow-x-auto pb-1">
        {CYCLE_STEPS.map((step, index) => {
          const done = index < currentIndex || cycle.phase === 'shared' || cycle.phase === 'closed';
          const now = index === currentIndex && !done;
          return (
            <div key={step.id} className="flex items-center">
              {index > 0 ? (
                <div className={cn('mx-3 h-0.5 w-10 sm:w-14', index <= currentIndex ? 'bg-blue-600' : 'bg-slate-200')} />
              ) : null}
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                    done && 'bg-blue-600 text-white',
                    now && 'border-2 border-blue-600 bg-white text-blue-700',
                    !done && !now && 'bg-slate-100 text-slate-500'
                  )}
                >
                  {done ? '✓' : index + 1}
                </span>
                <span className="whitespace-nowrap">
                  <span className={cn('block text-xs font-semibold', done || now ? 'text-slate-900' : 'text-slate-500')}>
                    {step.label}
                  </span>
                  <span className="block text-[11px] text-slate-500">{stepHint(step.id)}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </SurfaceCard>
  );
}

function CompetencyBars({
  self,
  manager,
  single,
}: {
  self?: CompetencyRating[];
  manager?: CompetencyRating[];
  single?: boolean;
}) {
  const names = new Map<number, string>();
  (self ?? []).forEach((r) => names.set(r.competency_id, r.competency?.name ?? `#${r.competency_id}`));
  (manager ?? []).forEach((r) => names.set(r.competency_id, r.competency?.name ?? `#${r.competency_id}`));
  if (names.size === 0) return null;

  const byId = (list: CompetencyRating[] | undefined, id: number) => list?.find((r) => r.competency_id === id)?.rating ?? null;

  const bar = (rating: number | null, tone: 'self' | 'manager') => (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
        {rating ? (
          <div
            className={cn('h-full rounded-full', tone === 'self' ? 'bg-primary-200' : 'bg-blue-600')}
            style={{ width: `${(rating / 5) * 100}%` }}
          />
        ) : null}
      </div>
      <span className="w-4 text-right text-[11px] font-bold tabular-nums text-slate-600">{rating ?? '—'}</span>
    </div>
  );

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Competencies</p>
      {!single ? (
        <div className="mt-1.5 grid grid-cols-[110px_1fr_1fr] items-center gap-x-3 text-[10px] font-bold uppercase tracking-[0.13em]">
          <span />
          <span className="text-slate-500">Self</span>
          <span className="text-blue-700">Manager</span>
        </div>
      ) : null}
      <div className="mt-1 space-y-1.5">
        {[...names.entries()].map(([id, name]) => (
          <div key={id} className={cn('grid items-center gap-x-3', single ? 'grid-cols-[110px_1fr]' : 'grid-cols-[110px_1fr_1fr]')}>
            <span className="truncate text-xs font-medium text-slate-600">{name}</span>
            {!single ? bar(byId(self, id), 'self') : null}
            {bar(byId(manager, id), 'manager')}
          </div>
        ))}
      </div>
    </div>
  );
}

function Panel360({ data }: { data: Aggregate360 }) {
  if (!data.review_count) return null;
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-amber-600">
          360° feedback · {data.reviewer_count} reviewer{data.reviewer_count === 1 ? '' : 's'}
        </p>
        {data.average_rating ? (
          <span className="text-sm font-bold text-slate-800">
            {data.average_rating.toFixed(1)} <span className="text-[11px] font-medium text-slate-500">avg</span>
          </span>
        ) : null}
      </div>
      {data.competencies.length ? (
        <div className="mt-2.5 space-y-1.5">
          {data.competencies.map((c) => (
            <div key={c.competency_id} className="grid grid-cols-[110px_1fr] items-center gap-x-3">
              <span className="truncate text-xs font-medium text-slate-600">{c.name}</span>
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-amber-400" style={{ width: `${(c.avg / 5) * 100}%` }} />
                </div>
                <span className="w-7 text-right text-[11px] font-bold tabular-nums text-slate-600">{c.avg.toFixed(1)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {data.comments.slice(0, 3).map((c, index) => (
        <blockquote key={index} className="mt-2.5 border-l-2 border-slate-200 pl-3">
          <p className="text-sm text-slate-600">"{c.comment}"</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {c.reviewer_name ?? `${c.review_type === '360' ? '360°' : 'Peer'} reviewer · anonymized`}
          </p>
        </blockquote>
      ))}
    </div>
  );
}

interface ListEditorProps {
  label: string;
  addLabel: string;
  values: string[];
  onChange: (values: string[]) => void;
}

function ListEditor({ label, addLabel, values, onChange }: ListEditorProps) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="space-y-2">
        {values.map((value, index) => (
          <div key={index} className="flex gap-2">
            <TextInput
              value={value}
              onChange={(e) => onChange(values.map((v, i) => (i === index ? e.target.value : v)))}
              placeholder={`${label} ${index + 1}`}
              className="flex-1"
            />
            {values.length > 1 ? (
              <button
                type="button"
                onClick={() => onChange(values.filter((_, i) => i !== index))}
                className="rounded-lg p-2 text-slate-500 transition hover:bg-rose-50 hover:text-rose-500"
                aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...values, ''])}
        className="mt-2 text-xs font-semibold text-blue-600 transition hover:text-blue-700"
      >
        + {addLabel}
      </button>
    </div>
  );
}

interface ReviewFormState {
  employee_id: number | '';
  review_type: PerformanceReview['review_type'];
  review_period_start: string;
  review_period_end: string;
  overall_rating: string;
  strengths: string[];
  areas_for_improvement: string[];
  goals: string[];
  comments: string;
  is_confidential: boolean;
  review_cycle_id: number | null;
  competency_ratings: Record<number, number>;
}

const emptyForm = (): ReviewFormState => ({
  employee_id: '',
  review_type: 'self',
  review_period_start: '',
  review_period_end: '',
  overall_rating: '',
  strengths: [''],
  areas_for_improvement: [''],
  goals: [''],
  comments: '',
  is_confidential: false,
  review_cycle_id: null,
  competency_ratings: {},
});

export default function PerformancePage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const myId = user?.id;

  const [scope, setScope] = useState<ScopeTab>(isAdmin ? 'all' : 'mine');
  const [view, setView] = useState<'reviews' | 'cycles'>('reviews');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [banner, setBanner] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingReview, setEditingReview] = useState<PerformanceReview | null>(null);
  const [form, setForm] = useState<ReviewFormState>(emptyForm());
  const [deleteTarget, setDeleteTarget] = useState<PerformanceReview | null>(null);

  const reviewsQuery = useQuery({
    queryKey: ['performance-reviews'],
    queryFn: () => performanceApi.getReviews(),
  });

  const summaryQuery = useQuery<ReviewSummary>({
    queryKey: ['performance-summary'],
    queryFn: () => performanceApi.getSummary(),
  });

  const activeCycleQuery = useQuery({
    queryKey: ['performance-active-cycle'],
    queryFn: () => performanceApi.getActiveCycle(),
  });
  const activeCycle = activeCycleQuery.data?.cycle ?? null;
  const myParticipant = activeCycleQuery.data?.me ?? null;
  const cycleCounts = activeCycleQuery.data?.counts;

  const competenciesQuery = useQuery({
    queryKey: ['performance-competencies'],
    queryFn: () => performanceApi.getCompetencies(),
    enabled: formOpen,
    staleTime: 300_000,
  });
  const competencies = competenciesQuery.data ?? [];

  const needsEmployeePicker = form.review_type !== 'self';
  const employeesQuery = useQuery({
    queryKey: ['performance-employee-picker'],
    queryFn: async () => (await userApi.getAll({ simple: true })).data,
    enabled: formOpen && needsEmployeePicker,
    staleTime: 60_000,
  });
  const employees = (employeesQuery.data ?? []).map((u: any) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role_name ?? u.role ?? null,
  }));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['performance-reviews'] });
    queryClient.invalidateQueries({ queryKey: ['performance-summary'] });
    queryClient.invalidateQueries({ queryKey: ['performance-active-cycle'] });
  };

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof performanceApi.createReview>[0]) => performanceApi.createReview(data),
    onSuccess: () => {
      invalidate();
      setFormOpen(false);
      setBanner({ tone: 'success', message: 'Review created.' });
    },
    onError: (err) => setBanner({ tone: 'error', message: getApiErrorMessage(err, 'Failed to create review.') }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof performanceApi.updateReview>[1] }) =>
      performanceApi.updateReview(id, data),
    onSuccess: () => {
      invalidate();
      setFormOpen(false);
      setEditingReview(null);
      setBanner({ tone: 'success', message: 'Review updated.' });
    },
    onError: (err) => setBanner({ tone: 'error', message: getApiErrorMessage(err, 'Failed to update review.') }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => performanceApi.deleteReview(id),
    onSuccess: () => {
      invalidate();
      setDeleteTarget(null);
      setSelectedId(null);
      setBanner({ tone: 'success', message: 'Review deleted.' });
    },
    onError: (err) => setBanner({ tone: 'error', message: getApiErrorMessage(err, 'Failed to delete review.') }),
  });

  const reviews = reviewsQuery.data ?? [];
  const selectedReview = reviews.find((r) => r.id === selectedId) ?? null;

  const scopedReviews = useMemo(() => {
    return reviews.filter((review) => {
      if (scope === 'mine') return review.employee_id === myId;
      if (scope === 'team') return review.reviewer_id === myId && review.employee_id !== myId;
      return true;
    });
  }, [reviews, scope, myId]);

  const visibleReviews = useMemo(() => {
    const term = search.trim().toLowerCase();
    return scopedReviews.filter((review) => {
      if (typeFilter !== 'all' && review.review_type !== typeFilter) return false;
      if (statusFilter !== 'all' && review.status !== statusFilter) return false;
      if (term) {
        const haystack = `${review.employee?.name ?? ''} ${review.reviewer?.name ?? ''}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [scopedReviews, typeFilter, statusFilter, search]);

  // Counterpart for the side-by-side view: the matching self/manager review
  // for the same employee with an overlapping period.
  const counterpart = useMemo(() => {
    if (!selectedReview) return null;
    const wanted = selectedReview.review_type === 'self' ? 'manager' : selectedReview.review_type === 'manager' ? 'self' : null;
    if (!wanted) return null;
    return (
      reviews.find(
        (other) =>
          other.id !== selectedReview.id &&
          other.employee_id === selectedReview.employee_id &&
          other.review_type === wanted &&
          periodsOverlap(
            other.review_period_start,
            other.review_period_end,
            new Date(selectedReview.review_period_start),
            new Date(selectedReview.review_period_end)
          )
      ) ?? null
    );
  }, [reviews, selectedReview]);

  // 360 aggregate for the drawer; the API 403s for viewers without standing, so fail quietly
  const aggregate360Query = useQuery({
    queryKey: [
      'performance-360',
      selectedReview?.employee_id,
      selectedReview?.review_period_start,
      selectedReview?.review_period_end,
    ],
    queryFn: () =>
      performanceApi.getAggregate360({
        employee_id: selectedReview!.employee_id,
        period_start: selectedReview!.review_period_start.slice(0, 10),
        period_end: selectedReview!.review_period_end.slice(0, 10),
      }),
    enabled: Boolean(selectedReview),
    retry: false,
    staleTime: 60_000,
  });

  const quarter = useMemo(currentQuarter, []);
  const hasSelfReviewThisQuarter = reviews.some(
    (r) =>
      r.review_type === 'self' &&
      r.employee_id === myId &&
      periodsOverlap(r.review_period_start, r.review_period_end, quarter.start, quarter.end)
  );
  // When a cycle is running, it owns the self-assessment prompt (and its deadline);
  // the quarterly heuristic is only a fallback for orgs without cycles.
  const cycleSelfPending = activeCycle?.phase === 'self' && Boolean(myParticipant) && !myParticipant?.self_review_id;
  const showSelfPrompt = activeCycle ? cycleSelfPending : !hasSelfReviewThisQuarter;
  const selfPromptLabel = activeCycle ? `Your self-assessment for ${activeCycle.name}` : `Your self-assessment for ${quarter.label}`;
  const selfPromptDue = activeCycle?.self_due ? `due ${formatDate(activeCycle.self_due)}` : null;
  const myDrafts = reviews.filter((r) => r.reviewer_id === myId && r.status === 'draft');
  const visibleDrafts = myDrafts.slice(0, 3);
  const hiddenDraftCount = myDrafts.length - visibleDrafts.length;
  const showAttention = !reviewsQuery.isLoading && (showSelfPrompt || myDrafts.length > 0);

  // The summary endpoint scopes to the org for admins and to the user otherwise;
  // fall back to client-side counts if it is unavailable.
  const summary = summaryQuery.data;
  const kpis = {
    total: summary?.total_reviews ?? reviews.length,
    completed: summary?.completed_reviews ?? reviews.filter((r) => r.status === 'completed').length,
    avgRating:
      summary?.average_rating ??
      (() => {
        const rated = reviews.filter((r) => r.overall_rating);
        if (!rated.length) return null;
        return rated.reduce((sum, r) => sum + (r.overall_rating ?? 0), 0) / rated.length;
      })(),
  };
  const drafts = kpis.total - kpis.completed;

  const openCreate = (prefill?: Partial<ReviewFormState>) => {
    setEditingReview(null);
    setForm({ ...emptyForm(), ...prefill });
    setFormOpen(true);
  };

  const openSelfAssessment = () =>
    openCreate({
      review_type: 'self',
      employee_id: myId ?? '',
      review_period_start: toDateInput(activeCycle ? new Date(activeCycle.period_start) : quarter.start),
      review_period_end: toDateInput(activeCycle ? new Date(activeCycle.period_end) : quarter.end),
      review_cycle_id: activeCycle?.id ?? null,
    });

  const openCycleManagerReview = () =>
    openCreate({
      review_type: 'manager',
      review_period_start: activeCycle ? toDateInput(new Date(activeCycle.period_start)) : '',
      review_period_end: activeCycle ? toDateInput(new Date(activeCycle.period_end)) : '',
      review_cycle_id: activeCycle?.id ?? null,
    });

  const openEdit = (review: PerformanceReview) => {
    setEditingReview(review);
    setForm({
      employee_id: review.employee_id,
      review_type: review.review_type,
      review_period_start: review.review_period_start.slice(0, 10),
      review_period_end: review.review_period_end.slice(0, 10),
      overall_rating: review.overall_rating ? String(review.overall_rating) : '',
      strengths: toList(review.strengths).length ? toList(review.strengths) : [''],
      areas_for_improvement: toList(review.areas_for_improvement).length ? toList(review.areas_for_improvement) : [''],
      goals: toList(review.goals).length ? toList(review.goals) : [''],
      comments: review.comments ?? '',
      is_confidential: review.is_confidential,
      review_cycle_id: review.review_cycle_id,
      competency_ratings: Object.fromEntries(
        (review.competency_ratings ?? []).map((r) => [r.competency_id, r.rating])
      ),
    });
    setSelectedId(null);
    setFormOpen(true);
  };

  const submitForm = () => {
    const ratings = Object.entries(form.competency_ratings)
      .filter(([, rating]) => rating > 0)
      .map(([competencyId, rating]) => ({ competency_id: Number(competencyId), rating }));
    const shared = {
      overall_rating: form.overall_rating ? parseInt(form.overall_rating, 10) : undefined,
      strengths: form.strengths.filter((s) => s.trim()),
      areas_for_improvement: form.areas_for_improvement.filter((s) => s.trim()),
      goals: form.goals.filter((s) => s.trim()),
      comments: form.comments || undefined,
      is_confidential: form.is_confidential,
      competency_ratings: ratings,
    };
    if (editingReview) {
      updateMutation.mutate({ id: editingReview.id, data: shared });
      return;
    }
    createMutation.mutate({
      ...shared,
      employee_id: form.review_type === 'self' ? myId : form.employee_id || undefined,
      review_type: form.review_type,
      review_period_start: form.review_period_start,
      review_period_end: form.review_period_end,
      review_cycle_id: form.review_cycle_id ?? undefined,
    });
  };

  const formValid =
    (form.review_type === 'self' || typeof form.employee_id === 'number') &&
    Boolean(form.review_period_start) &&
    Boolean(form.review_period_end) &&
    form.review_period_end >= form.review_period_start;

  const canEditSelected = Boolean(selectedReview && (isAdmin || selectedReview.reviewer_id === myId));

  if (reviewsQuery.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Performance Reviews" description="Track review cycles, self-assessments, and manager feedback" />
        <PageLoadingState label="Loading reviews..." />
      </div>
    );
  }

  if (reviewsQuery.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Performance Reviews" description="Track review cycles, self-assessments, and manager feedback" />
        <PageErrorState
          message={getApiErrorMessage(reviewsQuery.error, 'Could not load performance reviews.')}
          onRetry={() => reviewsQuery.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Performance Reviews"
        description="Track review cycles, self-assessments, and manager feedback"
        actions={
          <Button onClick={() => openCreate()} iconLeft={<Plus className="h-4 w-4" />}>
            Start review
          </Button>
        }
      />

      {banner ? (
        <FeedbackBanner tone={banner.tone} message={banner.message} onDismiss={() => setBanner(null)} />
      ) : null}

      {activeCycle && view === 'reviews' ? (
        <CycleBanner
          cycle={activeCycle}
          me={myParticipant}
          counts={cycleCounts}
          onStartSelf={openSelfAssessment}
          onStartManager={openCycleManagerReview}
        />
      ) : null}

      {showAttention && view === 'reviews' ? (
        <SurfaceCard className="border-l-4 border-l-amber-400 p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-600">Needs your attention</p>
          <div className="mt-2 divide-y divide-dashed divide-slate-100">
            {showSelfPrompt ? (
              <div className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-sm text-slate-700">
                  {selfPromptLabel}
                  {selfPromptDue ? <span className="ml-2 text-xs text-slate-500">{selfPromptDue}</span> : null}
                </span>
                <Button variant="ghost" size="sm" onClick={openSelfAssessment}>
                  Start →
                </Button>
              </div>
            ) : null}
            {visibleDrafts.map((draft) => (
              <div key={draft.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-sm text-slate-700">
                  Draft {REVIEW_TYPE_LABELS[draft.review_type].toLowerCase()} review for{' '}
                  <span className="font-semibold">{draft.employee?.name || 'Unknown'}</span>
                </span>
                <Button variant="ghost" size="sm" onClick={() => setSelectedId(draft.id)}>
                  Resume →
                </Button>
              </div>
            ))}
            {hiddenDraftCount > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-sm text-slate-500">
                  {hiddenDraftCount} more draft {hiddenDraftCount === 1 ? 'review' : 'reviews'} waiting on you
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setScope('team');
                    setStatusFilter('draft');
                    setTypeFilter('all');
                  }}
                >
                  View all →
                </Button>
              </div>
            ) : null}
          </div>
        </SurfaceCard>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total reviews" value={kpis.total} icon={ClipboardList} accent="sky" hint={isAdmin ? 'across the organization' : 'about you'} />
        <MetricCard
          label="Completed"
          value={kpis.completed}
          icon={CheckCircle2}
          accent="emerald"
          hint={kpis.total ? `${Math.round((kpis.completed / kpis.total) * 100)}% of total` : undefined}
        />
        <MetricCard
          label="Average rating"
          value={kpis.avgRating ? Number(kpis.avgRating).toFixed(1) : '—'}
          icon={Star}
          accent="amber"
          hint="out of 5"
        />
        <MetricCard label="In draft" value={Math.max(drafts, 0)} icon={AlertCircle} accent="slate" hint="not yet completed" />
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="inline-flex w-fit rounded-lg bg-slate-100 p-1">
          {(
            [
              { id: 'mine', label: 'My reviews' },
              { id: 'team', label: 'Given by me' },
              ...(isAdmin ? [{ id: 'all', label: 'All reviews' }, { id: 'cycles', label: 'Cycles' }] : []),
            ] as Array<{ id: ScopeTab | 'cycles'; label: string }>
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                if (tab.id === 'cycles') {
                  setView('cycles');
                } else {
                  setView('reviews');
                  setScope(tab.id);
                }
              }}
              className={cn(
                'rounded-md px-3.5 py-1.5 text-sm font-medium transition',
                (tab.id === 'cycles' ? view === 'cycles' : view === 'reviews' && scope === tab.id)
                  ? 'bg-surface-inverse text-on-inverse shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {view === 'cycles' ? <div /> : (
        <div className="flex flex-wrap items-center gap-2">
          <SelectInput value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-36" aria-label="Filter by type">
            <option value="all">All types</option>
            <option value="self">Self</option>
            <option value="manager">Manager</option>
            <option value="peer">Peer</option>
            <option value="360">360°</option>
          </SelectInput>
          <SelectInput value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-36" aria-label="Filter by status">
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
          </SelectInput>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employee..."
              className="w-48 pl-9"
              aria-label="Search reviews"
            />
          </div>
        </div>
        )}
      </div>

      {view === 'cycles' && isAdmin ? (
        <CyclesPanel activeCycleId={activeCycle?.id ?? null} onNotify={setBanner} />
      ) : (
      <SurfaceCard className="overflow-hidden">
        {visibleReviews.length === 0 ? (
          <div className="p-10 text-center text-slate-500">
            <ClipboardList className="mx-auto mb-3 h-12 w-12 text-slate-300" />
            <p className="font-medium text-slate-700">
              {scope === 'mine' ? 'No reviews about you yet' : scope === 'team' ? "You haven't written any reviews yet" : 'No reviews match the current filters'}
            </p>
            <p className="mt-1 text-sm">
              {scope === 'mine'
                ? 'Start your self-assessment to kick off the review conversation.'
                : 'Start a review to capture feedback for a teammate.'}
            </p>
            <Button className="mt-4" onClick={() => (scope === 'mine' ? openSelfAssessment() : openCreate())} iconLeft={<Plus className="h-4 w-4" />}>
              {scope === 'mine' ? 'Start self-assessment' : 'Start review'}
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {['Employee', 'Type', 'Period', 'Rating', 'Status', 'Updated'].map((header) => (
                    <th key={header} className="whitespace-nowrap px-4 py-3 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {visibleReviews.map((review) => (
                  <tr
                    key={review.id}
                    onClick={() => setSelectedId(review.id)}
                    className="cursor-pointer transition hover:bg-blue-500/5"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar id={review.employee_id} name={review.employee?.name} />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{review.employee?.name || 'Unknown'}</p>
                          <p className="truncate text-xs text-slate-500">by {review.reviewer?.name || 'Anonymous'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <StatusBadge tone={REVIEW_TYPE_TONES[review.review_type]}>{REVIEW_TYPE_LABELS[review.review_type]}</StatusBadge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {formatPeriod(review.review_period_start, review.review_period_end)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <RatingStars rating={review.overall_rating} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <StatusBadge tone={STATUS_TONES[review.status] ?? 'neutral'}>{statusLabel(review.status)}</StatusBadge>
                        {review.is_confidential ? <Lock className="h-3.5 w-3.5 text-rose-400" aria-label="Confidential" /> : null}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatDate(review.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>
      )}

      {/* Detail drawer */}
      <SlideOver
        open={Boolean(selectedReview)}
        title={selectedReview?.employee?.name || 'Review'}
        subtitle={
          selectedReview
            ? `${REVIEW_TYPE_LABELS[selectedReview.review_type]} review · ${formatPeriod(selectedReview.review_period_start, selectedReview.review_period_end)}`
            : undefined
        }
        onClose={() => setSelectedId(null)}
        footer={
          canEditSelected && selectedReview ? (
            <>
              <Button
                variant="ghost"
                onClick={() => setDeleteTarget(selectedReview)}
                iconLeft={<Trash2 className="h-4 w-4" />}
                className="mr-auto text-rose-600 hover:bg-rose-50 hover:text-rose-700"
              >
                Delete
              </Button>
              <Button variant="secondary" onClick={() => openEdit(selectedReview)}>
                Edit
              </Button>
              {selectedReview.status === 'draft' ? (
                selectedReview.overall_rating ? (
                  <Button
                    onClick={() => updateMutation.mutate({ id: selectedReview.id, data: { status: 'completed' } })}
                    loading={updateMutation.isPending}
                  >
                    Mark completed
                  </Button>
                ) : (
                  <Button onClick={() => openEdit(selectedReview)}>Add rating to complete</Button>
                )
              ) : null}
            </>
          ) : undefined
        }
      >
        {selectedReview ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={STATUS_TONES[selectedReview.status] ?? 'neutral'}>{statusLabel(selectedReview.status)}</StatusBadge>
              <StatusBadge tone={REVIEW_TYPE_TONES[selectedReview.review_type]}>
                {REVIEW_TYPE_LABELS[selectedReview.review_type]}
              </StatusBadge>
              {selectedReview.is_confidential ? <StatusBadge tone="danger">Confidential</StatusBadge> : null}
            </div>

            {counterpart ? (
              <div className="grid grid-cols-1 gap-6 border-t border-slate-100 pt-4 sm:grid-cols-2">
                <ReviewPane
                  review={selectedReview.review_type === 'self' ? selectedReview : counterpart}
                  heading="Self-assessment"
                />
                <ReviewPane
                  review={selectedReview.review_type === 'manager' ? selectedReview : counterpart}
                  heading="Manager review"
                />
              </div>
            ) : (
              <div className="border-t border-slate-100 pt-4">
                <ReviewPane review={selectedReview} heading={`${REVIEW_TYPE_LABELS[selectedReview.review_type]} review`} />
              </div>
            )}

            {counterpart ? (
              <CompetencyBars
                self={(selectedReview.review_type === 'self' ? selectedReview : counterpart).competency_ratings}
                manager={(selectedReview.review_type === 'manager' ? selectedReview : counterpart).competency_ratings}
              />
            ) : (
              <CompetencyBars manager={selectedReview.competency_ratings} single />
            )}

            {aggregate360Query.data ? <Panel360 data={aggregate360Query.data} /> : null}
          </div>
        ) : null}
      </SlideOver>

      {/* Create / edit drawer */}
      <SlideOver
        open={formOpen}
        title={editingReview ? 'Edit review' : 'Start a review'}
        subtitle={editingReview ? `${editingReview.employee?.name || ''} · ${formatPeriod(editingReview.review_period_start, editingReview.review_period_end)}` : undefined}
        onClose={() => {
          setFormOpen(false);
          setEditingReview(null);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setFormOpen(false);
                setEditingReview(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={submitForm}
              disabled={!editingReview && !formValid}
              loading={createMutation.isPending || updateMutation.isPending}
            >
              {editingReview ? 'Save changes' : form.overall_rating ? 'Submit review' : 'Save draft'}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          {!editingReview ? (
            <>
              <div>
                <FieldLabel>Review type</FieldLabel>
                <SelectInput
                  value={form.review_type}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      review_type: e.target.value as ReviewFormState['review_type'],
                      employee_id: e.target.value === 'self' ? (myId ?? '') : prev.employee_id,
                    }))
                  }
                >
                  <option value="self">Self-assessment</option>
                  <option value="manager">Manager review</option>
                  <option value="peer">Peer review</option>
                  <option value="360">360° review</option>
                </SelectInput>
              </div>

              <div>
                <FieldLabel>Employee</FieldLabel>
                {form.review_type === 'self' ? (
                  <TextInput value={user?.name ?? ''} disabled aria-label="Employee" />
                ) : (
                  <>
                    <EmployeeSelect
                      employees={employees}
                      value={form.employee_id}
                      onChange={(value) => setForm((prev) => ({ ...prev, employee_id: value }))}
                      disabled={employeesQuery.isLoading}
                      placeholder={employeesQuery.isLoading ? 'Loading employees...' : 'Choose employee'}
                      ariaLabel="Employee under review"
                    />
                    {employeesQuery.isError ? (
                      <p className="mt-1 text-xs text-rose-600">Could not load the employee list. Close and reopen this panel to retry.</p>
                    ) : null}
                  </>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Period start</FieldLabel>
                  <TextInput
                    type="date"
                    value={form.review_period_start}
                    onChange={(e) => setForm((prev) => ({ ...prev, review_period_start: e.target.value }))}
                  />
                </div>
                <div>
                  <FieldLabel>Period end</FieldLabel>
                  <TextInput
                    type="date"
                    value={form.review_period_end}
                    onChange={(e) => setForm((prev) => ({ ...prev, review_period_end: e.target.value }))}
                  />
                </div>
              </div>
            </>
          ) : null}

          <div>
            <FieldLabel hint="leave unrated to keep it a draft">Overall rating</FieldLabel>
            <SelectInput value={form.overall_rating} onChange={(e) => setForm((prev) => ({ ...prev, overall_rating: e.target.value }))}>
              <option value="">Not rated yet</option>
              <option value="5">5 · Outstanding</option>
              <option value="4">4 · Exceeds expectations</option>
              <option value="3">3 · Meets expectations</option>
              <option value="2">2 · Needs improvement</option>
              <option value="1">1 · Unsatisfactory</option>
            </SelectInput>
          </div>

          {competencies.length ? (
            <div>
              <FieldLabel hint="optional">Competency ratings</FieldLabel>
              <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                {competencies.map((competency) => {
                  const current = form.competency_ratings[competency.id] ?? 0;
                  return (
                    <div key={competency.id} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm text-slate-700" title={competency.description ?? undefined}>
                        {competency.name}
                      </span>
                      <span className="inline-flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map((value) => (
                          <button
                            key={value}
                            type="button"
                            aria-label={`Rate ${competency.name} ${value} of 5`}
                            onClick={() =>
                              setForm((prev) => ({
                                ...prev,
                                competency_ratings: {
                                  ...prev.competency_ratings,
                                  [competency.id]: prev.competency_ratings[competency.id] === value ? 0 : value,
                                },
                              }))
                            }
                            className="rounded p-0.5 transition hover:scale-110"
                          >
                            <Star
                              className={cn(
                                'h-[18px] w-[18px]',
                                value <= current ? 'fill-amber-400 text-amber-400' : 'text-slate-200'
                              )}
                            />
                          </button>
                        ))}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div>
            <FieldLabel>Comments</FieldLabel>
            <TextareaInput
              rows={4}
              value={form.comments}
              onChange={(e) => setForm((prev) => ({ ...prev, comments: e.target.value }))}
              placeholder="Overall feedback for this period..."
            />
          </div>

          <ListEditor
            label="Strengths"
            addLabel="Add strength"
            values={form.strengths}
            onChange={(values) => setForm((prev) => ({ ...prev, strengths: values }))}
          />
          <ListEditor
            label="Areas for improvement"
            addLabel="Add area"
            values={form.areas_for_improvement}
            onChange={(values) => setForm((prev) => ({ ...prev, areas_for_improvement: values }))}
          />
          <ListEditor
            label="Goals"
            addLabel="Add goal"
            values={form.goals}
            onChange={(values) => setForm((prev) => ({ ...prev, goals: values }))}
          />

          <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-slate-800">Confidential</p>
              <p className="text-xs text-slate-500">Hidden from the employee; visible to admins and you.</p>
            </div>
            <ToggleInput checked={form.is_confidential} onChange={(checked) => setForm((prev) => ({ ...prev, is_confidential: checked }))} />
          </div>
        </div>
      </SlideOver>

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete this review?"
        message={`The ${deleteTarget ? REVIEW_TYPE_LABELS[deleteTarget.review_type].toLowerCase() : ''} review for ${deleteTarget?.employee?.name || 'this employee'} will be permanently removed.`}
        confirmLabel="Delete review"
        tone="danger"
        isLoading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

const PHASE_TONES: Record<CyclePhase, 'neutral' | 'info' | 'warning' | 'success'> = {
  draft: 'neutral',
  self: 'info',
  manager: 'warning',
  shared: 'success',
  closed: 'neutral',
};

const NEXT_PHASE: Record<string, { next: CyclePhase; label: string; confirm: string }> = {
  draft: {
    next: 'self',
    label: 'Launch cycle',
    confirm: 'Launching enrolls every active employee and opens the self-assessment phase.',
  },
  self: {
    next: 'manager',
    label: 'Advance to manager phase',
    confirm: 'The self-assessment window closes and managers start writing reviews.',
  },
  manager: {
    next: 'shared',
    label: 'Share results',
    confirm: 'Results are marked as shared with every enrolled employee.',
  },
  shared: {
    next: 'closed',
    label: 'Close cycle',
    confirm: 'The cycle is archived and the banner disappears.',
  },
};

const emptyCycleForm = () => ({
  name: '',
  period_start: '',
  period_end: '',
  self_due: '',
  manager_due: '',
  share_date: '',
  anonymize_peer: true,
});

function CyclesPanel({
  activeCycleId,
  onNotify,
}: {
  activeCycleId: number | null;
  onNotify: (banner: { tone: 'success' | 'error'; message: string }) => void;
}) {
  const queryClient = useQueryClient();
  const [selectedCycleId, setSelectedCycleId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [advanceTarget, setAdvanceTarget] = useState<ReviewCycle | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReviewCycle | null>(null);
  const [cycleForm, setCycleForm] = useState(emptyCycleForm());

  const cyclesQuery = useQuery({
    queryKey: ['performance-cycles'],
    queryFn: () => performanceApi.getCycles(),
  });
  const cycles = cyclesQuery.data ?? [];
  const effectiveId = selectedCycleId ?? activeCycleId ?? cycles[0]?.id ?? null;

  const detailQuery = useQuery({
    queryKey: ['performance-cycle', effectiveId],
    queryFn: () => performanceApi.getCycle(effectiveId!),
    enabled: effectiveId !== null,
  });
  const detail = detailQuery.data;

  const invalidateCycles = () => {
    queryClient.invalidateQueries({ queryKey: ['performance-cycles'] });
    queryClient.invalidateQueries({ queryKey: ['performance-cycle'] });
    queryClient.invalidateQueries({ queryKey: ['performance-active-cycle'] });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      performanceApi.createCycle({
        name: cycleForm.name,
        period_start: cycleForm.period_start,
        period_end: cycleForm.period_end,
        self_due: cycleForm.self_due || null,
        manager_due: cycleForm.manager_due || null,
        share_date: cycleForm.share_date || null,
        anonymize_peer: cycleForm.anonymize_peer,
      }),
    onSuccess: (cycle) => {
      invalidateCycles();
      setCreateOpen(false);
      setSelectedCycleId(cycle.id);
      onNotify({ tone: 'success', message: 'Cycle created as a draft. Launch it to enroll employees.' });
    },
    onError: (err) => onNotify({ tone: 'error', message: getApiErrorMessage(err, 'Failed to create cycle.') }),
  });

  const advanceMutation = useMutation({
    mutationFn: ({ id, phase }: { id: number; phase: CyclePhase }) => performanceApi.updateCycle(id, { phase }),
    onSuccess: () => {
      invalidateCycles();
      setAdvanceTarget(null);
      onNotify({ tone: 'success', message: 'Cycle phase advanced.' });
    },
    onError: (err) => {
      setAdvanceTarget(null);
      onNotify({ tone: 'error', message: getApiErrorMessage(err, 'Failed to advance the cycle.') });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => performanceApi.deleteCycle(id),
    onSuccess: () => {
      invalidateCycles();
      setDeleteTarget(null);
      setSelectedCycleId(null);
      onNotify({ tone: 'success', message: 'Draft cycle deleted.' });
    },
    onError: (err) => {
      setDeleteTarget(null);
      onNotify({ tone: 'error', message: getApiErrorMessage(err, 'Failed to delete the cycle.') });
    },
  });

  const cycleFormValid =
    cycleForm.name.trim().length > 0 &&
    Boolean(cycleForm.period_start) &&
    Boolean(cycleForm.period_end) &&
    cycleForm.period_end >= cycleForm.period_start;

  const completionBar = (done: number, total: number) => (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn('h-full rounded-full', total && done / total >= 0.7 ? 'bg-blue-600' : 'bg-amber-500')}
          style={{ width: total ? `${Math.round((done / total) * 100)}%` : 0 }}
        />
      </div>
      <span className="w-9 text-right text-xs font-bold tabular-nums text-slate-600">
        {total ? Math.round((done / total) * 100) : 0}%
      </span>
    </div>
  );

  return (
    <div className="space-y-4">
      <SurfaceCard className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-950">Review cycles</h2>
            <p className="mt-0.5 text-xs text-slate-500">Launch a cycle, watch completion, advance phases</p>
          </div>
          <Button size="sm" onClick={() => { setCycleForm(emptyCycleForm()); setCreateOpen(true); }} iconLeft={<Plus className="h-4 w-4" />}>
            New cycle
          </Button>
        </div>
        {cycles.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            No cycles yet. Create one to run a structured review round.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {cycles.map((cycle) => (
              <button
                key={cycle.id}
                type="button"
                onClick={() => setSelectedCycleId(cycle.id)}
                className={cn(
                  'flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left transition hover:bg-blue-500/5',
                  effectiveId === cycle.id && 'bg-blue-500/[0.07]'
                )}
              >
                <span>
                  <span className="text-sm font-semibold text-slate-900">{cycle.name}</span>
                  <span className="ml-2 text-xs text-slate-500">{formatPeriod(cycle.period_start, cycle.period_end)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{cycle.participants_count ?? 0} enrolled</span>
                  <StatusBadge tone={PHASE_TONES[cycle.phase]}>{cycle.phase}</StatusBadge>
                </span>
              </button>
            ))}
          </div>
        )}
      </SurfaceCard>

      {detail ? (
        <SurfaceCard className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900">{detail.cycle.name}</h3>
              <StatusBadge tone={PHASE_TONES[detail.cycle.phase]}>{detail.cycle.phase}</StatusBadge>
            </div>
            <div className="flex items-center gap-2">
              {detail.cycle.phase === 'draft' ? (
                <Button variant="ghost" size="sm" className="text-rose-600 hover:bg-rose-50" onClick={() => setDeleteTarget(detail.cycle)}>
                  Delete draft
                </Button>
              ) : null}
              {NEXT_PHASE[detail.cycle.phase] ? (
                <Button size="sm" onClick={() => setAdvanceTarget(detail.cycle)}>
                  {NEXT_PHASE[detail.cycle.phase].label} →
                </Button>
              ) : null}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Enrolled', value: detail.stats.enrolled },
              { label: 'Self done', value: detail.stats.self_done },
              { label: 'Manager done', value: detail.stats.manager_done },
              { label: 'Blocked on', value: `${detail.stats.blocked_managers} mgrs` },
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg border border-slate-200 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{stat.label}</p>
                <p className="mt-0.5 text-lg font-bold text-slate-900">{stat.value}</p>
              </div>
            ))}
          </div>

          {detail.stats.by_department.length ? (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr>
                    {['Department', 'Enrolled', 'Self', 'Manager'].map((header) => (
                      <th key={header} className="whitespace-nowrap px-2 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detail.stats.by_department.map((row) => (
                    <tr key={row.department}>
                      <td className="px-2 py-2 font-medium text-slate-800">{row.department}</td>
                      <td className="px-2 py-2 text-slate-600">{row.enrolled}</td>
                      <td className="px-2 py-2">{completionBar(Number(row.self_done), Number(row.enrolled))}</td>
                      <td className="px-2 py-2">{completionBar(Number(row.manager_done), Number(row.enrolled))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </SurfaceCard>
      ) : null}

      <SlideOver
        open={createOpen}
        title="New review cycle"
        subtitle="Created as a draft — launching it enrolls every active employee"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => createMutation.mutate()} disabled={!cycleFormValid} loading={createMutation.isPending}>
              Create draft cycle
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div>
            <FieldLabel>Cycle name</FieldLabel>
            <TextInput
              value={cycleForm.name}
              onChange={(e) => setCycleForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Q3 2026 Review"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Period start</FieldLabel>
              <TextInput type="date" value={cycleForm.period_start} onChange={(e) => setCycleForm((prev) => ({ ...prev, period_start: e.target.value }))} />
            </div>
            <div>
              <FieldLabel>Period end</FieldLabel>
              <TextInput type="date" value={cycleForm.period_end} onChange={(e) => setCycleForm((prev) => ({ ...prev, period_end: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <FieldLabel>Self due</FieldLabel>
              <TextInput type="date" value={cycleForm.self_due} onChange={(e) => setCycleForm((prev) => ({ ...prev, self_due: e.target.value }))} />
            </div>
            <div>
              <FieldLabel>Manager due</FieldLabel>
              <TextInput type="date" value={cycleForm.manager_due} onChange={(e) => setCycleForm((prev) => ({ ...prev, manager_due: e.target.value }))} />
            </div>
            <div>
              <FieldLabel>Share on</FieldLabel>
              <TextInput type="date" value={cycleForm.share_date} onChange={(e) => setCycleForm((prev) => ({ ...prev, share_date: e.target.value }))} />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-slate-800">Anonymize peer & 360° reviewers</p>
              <p className="text-xs text-slate-500">Reviewer names are hidden from everyone except admins.</p>
            </div>
            <ToggleInput
              checked={cycleForm.anonymize_peer}
              onChange={(checked) => setCycleForm((prev) => ({ ...prev, anonymize_peer: checked }))}
            />
          </div>
        </div>
      </SlideOver>

      <ConfirmDialog
        isOpen={Boolean(advanceTarget)}
        title={advanceTarget ? `${NEXT_PHASE[advanceTarget.phase]?.label}?` : ''}
        message={advanceTarget ? NEXT_PHASE[advanceTarget.phase]?.confirm ?? '' : ''}
        confirmLabel={advanceTarget ? NEXT_PHASE[advanceTarget.phase]?.label : 'Confirm'}
        isLoading={advanceMutation.isPending}
        onConfirm={() =>
          advanceTarget && advanceMutation.mutate({ id: advanceTarget.id, phase: NEXT_PHASE[advanceTarget.phase].next })
        }
        onClose={() => setAdvanceTarget(null)}
      />

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete this draft cycle?"
        message={`"${deleteTarget?.name ?? ''}" will be permanently removed.`}
        confirmLabel="Delete cycle"
        tone="danger"
        isLoading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
