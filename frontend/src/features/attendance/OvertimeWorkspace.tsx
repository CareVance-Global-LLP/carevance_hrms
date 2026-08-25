import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Hourglass, Inbox, Send } from 'lucide-react';
import Button from '@/components/ui/Button';
import { formatDuration } from '@/lib/formatters';

/** A calendar day as the attendance API returns it — the request's context. */
export interface DayContext {
  date?: string;
  status?: string;
  is_weekend?: boolean;
  is_holiday?: boolean;
  worked_seconds?: number;
  holiday?: { title?: string } | null;
}

export interface OvertimeSegment {
  key: 'inbox' | 'mine' | 'all';
  label: string;
}

const QUICK_MINUTES = [30, 60, 120] as const;
/** Above this, the resulting day gets a visible flag — a hint, never a block. */
const LONG_DAY_SECONDS = 12 * 3600;
const AGE_WARN_DAYS = 2;

const todayISO = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const initialsOf = (value: string): string => {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const ageInDays = (value?: string | null): number => {
  const parsed = new Date(String(value || ''));
  if (Number.isNaN(parsed.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 86_400_000));
};

const formatDateShort = (iso?: string | null) => {
  const normalized = String(iso || '').slice(0, 10);
  if (!normalized) return '';
  const parsed = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return normalized;
  return parsed.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

/** tracked → requested → resulting, as one strip. The approver's arithmetic. */
function DayMath({ worked, extraSeconds }: { worked: number | null; extraSeconds: number }) {
  if (worked === null) {
    return (
      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
        No tracked time recorded on that day — judge the request on the message alone.
      </p>
    );
  }

  const resulting = worked + extraSeconds;
  const long = resulting > LONG_DAY_SECONDS;

  return (
    <div>
      <div className="flex overflow-hidden rounded-lg border border-slate-100 text-center text-[11px]">
        <span className="flex-1 px-2 py-1.5">
          <span className="block text-slate-500">Tracked that day</span>
          <b className="text-xs tabular-nums text-slate-900">{formatDuration(worked)}</b>
        </span>
        <span className="flex-1 bg-success-50 px-2 py-1.5">
          <span className="block text-slate-500">Requested</span>
          <b className="text-xs tabular-nums text-success-800">+{formatDuration(extraSeconds)}</b>
        </span>
        <span className={`flex-1 px-2 py-1.5 ${long ? 'bg-danger-50' : 'bg-blue-50'}`}>
          <span className="block text-slate-500">Day becomes</span>
          <b className={`text-xs tabular-nums ${long ? 'text-danger-700' : 'text-blue-800'}`}>
            {formatDuration(resulting)}
          </b>
        </span>
      </div>
      {long ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-danger-700">
          <AlertTriangle className="h-3 w-3 shrink-0" /> Resulting day exceeds 12h — worth a look before approving.
        </p>
      ) : null}
    </div>
  );
}

export interface OvertimeWorkspaceProps {
  requests: any[];
  currentUserId: number;
  canRequest: boolean;
  canReview: (item: any) => boolean;
  isLoading: boolean;
  submitting: boolean;
  /** Day context for the viewer's own dates, from the calendar already loaded. */
  dayLookup: (dateISO: string) => DayContext | undefined;
  /** Called when the picked date's month isn't loaded, so the page can fetch it. */
  onMonthNeeded: (monthISO: string) => void;
  /** Lazy day context for other people's days, used on reviewer cards. */
  fetchDayFor: (userId: number, dateISO: string) => Promise<DayContext | null>;
  onSubmit: (payload: { date: string; extraMinutes: number; message: string }) => Promise<boolean>;
  onApprove: (id: number) => Promise<void> | void;
  onReject: (id: number) => Promise<void> | void;
  renderEscalate?: (item: any) => ReactNode;
}

export default function OvertimeWorkspace({
  requests,
  currentUserId,
  canRequest,
  canReview,
  isLoading,
  submitting,
  dayLookup,
  onMonthNeeded,
  fetchDayFor,
  onSubmit,
  onApprove,
  onReject,
  renderEscalate,
}: OvertimeWorkspaceProps) {
  const [date, setDate] = useState(todayISO);
  const [quick, setQuick] = useState<number | 'custom'>(60);
  const [customMinutes, setCustomMinutes] = useState(90);
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  const inboxItems = useMemo(
    () =>
      requests.filter(
        (item) => item.status === 'pending' && Number(item.user_id) !== currentUserId && canReview(item)
      ),
    [requests, currentUserId, canReview]
  );
  const mineItems = useMemo(
    () => requests.filter((item) => Number(item.user_id) === currentUserId),
    [requests, currentUserId]
  );

  const [segment, setSegment] = useState<'inbox' | 'mine' | 'all'>(() => 'mine');
  // Reviewers land on what needs them; requesters land on their own history.
  const landedRef = useRef(false);
  useEffect(() => {
    if (landedRef.current || isLoading) return;
    landedRef.current = true;
    if (inboxItems.length > 0) setSegment('inbox');
  }, [inboxItems.length, isLoading]);

  const showInboxSegment = inboxItems.length > 0 || requests.some((item) => canReview(item));

  /* ── requester day context ─────────────────────────────────── */

  const day = dayLookup(date);
  const requestedMonthRef = useRef<string | null>(null);
  useEffect(() => {
    if (day || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const month = date.slice(0, 7);
    if (requestedMonthRef.current === month) return;
    requestedMonthRef.current = month;
    onMonthNeeded(month);
  }, [date, day, onMonthNeeded]);

  const minutes = quick === 'custom' ? Math.max(0, Math.floor(Number(customMinutes) || 0)) : quick;
  const worked = day?.worked_seconds != null ? Number(day.worked_seconds) : null;
  const isHoliday = Boolean(day?.is_holiday || day?.status === 'holiday');
  const resulting = worked !== null ? worked + minutes * 60 : null;

  const handleSubmit = async () => {
    const submitted = await onSubmit({ date, extraMinutes: minutes, message });
    if (submitted) {
      setMessage('');
      setQuick(60);
    }
  };

  /* ── reviewer day context, fetched lazily and cached ───────── */

  const [dayCache, setDayCache] = useState<Map<string, DayContext | null>>(() => new Map());
  useEffect(() => {
    if (segment !== 'inbox') return;
    const missing = inboxItems
      .map((item) => ({ userId: Number(item.user_id), date: String(item.attendance_date || '').slice(0, 10) }))
      .filter((entry) => entry.userId && entry.date && !dayCache.has(`${entry.userId}:${entry.date}`));
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      // Sequential on purpose: pending overtime is a handful of rows, and one
      // calendar call per (person, month) is cheap; hammering in parallel is not.
      for (const entry of missing) {
        try {
          const context = await fetchDayFor(entry.userId, entry.date);
          if (cancelled) return;
          setDayCache((current) => new Map(current).set(`${entry.userId}:${entry.date}`, context));
        } catch {
          if (cancelled) return;
          setDayCache((current) => new Map(current).set(`${entry.userId}:${entry.date}`, null));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [segment, inboxItems, dayCache, fetchDayFor]);

  /* ── monthly accrual, from the same list ───────────────────── */

  const accrual = useMemo(() => {
    const month = todayISO().slice(0, 7);
    const totals = new Map<string, number>();
    requests.forEach((item) => {
      if (item.status !== 'approved') return;
      if (String(item.attendance_date || '').slice(0, 7) !== month) return;
      const name = item.user?.name || `User #${item.user_id}`;
      totals.set(name, (totals.get(name) ?? 0) + Number(item.extra_seconds || 0));
    });
    const rows = Array.from(totals.entries())
      .map(([name, seconds]) => ({ name, seconds }))
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 6);
    const max = rows.reduce((most, row) => Math.max(most, row.seconds), 0);
    return { rows, max };
  }, [requests]);

  /* ── list rendering ────────────────────────────────────────── */

  const visible = useMemo(() => {
    const source = segment === 'inbox' ? inboxItems : segment === 'mine' ? mineItems : requests;
    return [...source].sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (b.status === 'pending' && a.status !== 'pending') return 1;
      return +new Date(a.created_at) - +new Date(b.created_at);
    });
  }, [segment, inboxItems, mineItems, requests]);

  const toggleExpand = (id: number) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const statusTone = (status: string) =>
    status === 'approved'
      ? 'bg-success-50 text-success-800 border-success-100'
      : status === 'rejected'
        ? 'bg-danger-50 text-danger-800 border-danger-100'
        : 'bg-accent-50 text-warning-800 border-accent-200';

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(300px,340px)_minmax(0,1fr)]">
      {/* ── request panel ── */}
      <div className="space-y-4">
        {canRequest ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-bold tracking-[-0.015em] text-slate-950">Request overtime</h2>

            <label className="mt-3 block text-xs font-bold text-slate-700" htmlFor="ot-date">
              Date
            </label>
            <input
              id="ot-date"
              type="date"
              value={date}
              max={todayISO()}
              onChange={(event) => setDate(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:outline-none"
            />

            {/* The day comes with the date — nobody types minutes into a vacuum. */}
            {isHoliday ? (
              <p className="mt-2 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 text-xs font-semibold text-warning-800">
                {day?.holiday?.title || 'Holiday'} — overtime requests are not allowed on holidays.
              </p>
            ) : (
              <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {day == null
                  ? 'Loading that day…'
                  : worked !== null && worked > 0
                    ? (
                      <>
                        You tracked <b className="font-bold tabular-nums text-slate-900">{formatDuration(worked)}</b> on{' '}
                        {formatDateShort(date)}.{day?.is_weekend ? ' (weekend)' : ''}
                      </>
                    )
                    : `No tracked time recorded on ${formatDateShort(date)}.${day?.is_weekend ? ' (weekend)' : ''}`}
              </p>
            )}

            <p className="mt-3 text-xs font-bold text-slate-700">Extra time</p>
            <div className="mt-1 flex gap-1.5">
              {QUICK_MINUTES.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={quick === preset}
                  onClick={() => setQuick(preset)}
                  className={`flex-1 rounded-lg border py-1.5 text-xs font-bold tabular-nums transition ${
                    quick === preset
                      ? 'border-blue-600 bg-blue-50 text-blue-800'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  +{preset >= 60 ? `${preset / 60}h` : `${preset}m`}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={quick === 'custom'}
                onClick={() => setQuick('custom')}
                className={`flex-1 rounded-lg border py-1.5 text-xs font-bold transition ${
                  quick === 'custom'
                    ? 'border-blue-600 bg-blue-50 text-blue-800'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                Custom
              </button>
            </div>
            {quick === 'custom' ? (
              <input
                type="number"
                min={1}
                max={480}
                value={customMinutes}
                onChange={(event) => setCustomMinutes(Number(event.target.value))}
                aria-label="Custom minutes"
                placeholder="Minutes"
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums text-slate-800 focus:border-blue-400 focus:outline-none"
              />
            ) : null}

            {!isHoliday && minutes > 0 ? (
              <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 text-xs">
                <div className="flex justify-between border-b border-slate-100 px-3 py-1.5 text-slate-600">
                  <span>Requested extra</span>
                  <b className="tabular-nums text-slate-900">{formatDuration(minutes * 60)}</b>
                </div>
                {resulting !== null ? (
                  <div className="flex justify-between bg-blue-50 px-3 py-1.5 text-slate-600">
                    <span>Day total becomes</span>
                    <b className={`tabular-nums ${resulting > LONG_DAY_SECONDS ? 'text-danger-700' : 'text-blue-800'}`}>
                      {formatDuration(resulting)}
                    </b>
                  </div>
                ) : null}
                {resulting !== null && resulting > LONG_DAY_SECONDS ? (
                  <p className="px-3 py-1.5 text-[11px] text-danger-700">
                    Your approver will see this flagged as a 12h+ day.
                  </p>
                ) : null}
              </div>
            ) : null}

            <label className="mt-3 block text-xs font-bold text-slate-700" htmlFor="ot-message">
              Message to approver
            </label>
            <textarea
              id="ot-message"
              rows={2}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="What kept you on the clock?"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:outline-none"
            />

            <Button
              className="mt-3 w-full"
              disabled={submitting || isHoliday || minutes <= 0}
              loading={submitting}
              onClick={() => void handleSubmit()}
              iconLeft={<Send className="h-3.5 w-3.5" />}
            >
              Send for approval
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white p-4 text-xs text-slate-500">
            Time edit requests are disabled for your account.
          </div>
        )}

        {accrual.rows.length > 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
              Approved overtime · this month
            </h3>
            <div className="mt-2 space-y-1.5">
              {accrual.rows.map((row) => (
                <div key={row.name} className="grid grid-cols-[minmax(0,1fr)_64px] items-center gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-slate-800">{row.name}</span>
                    <span className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <span
                        className="block h-full rounded-full bg-blue-400"
                        style={{ width: `${accrual.max > 0 ? Math.max(4, Math.round((row.seconds / accrual.max) * 100)) : 0}%` }}
                      />
                    </span>
                  </span>
                  <span className="text-right text-xs font-bold tabular-nums text-slate-700">
                    {formatDuration(row.seconds)}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-slate-500">
              Summed from approved requests — context, so approvals stop being judged in a vacuum.
            </p>
          </div>
        ) : null}
      </div>

      {/* ── list ── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ...(showInboxSegment ? [{ key: 'inbox', label: 'Needs my approval' }] : []),
              { key: 'mine', label: 'Mine' },
              { key: 'all', label: 'Everyone' },
            ] as OvertimeSegment[]
          ).map((candidate) => {
            const count =
              candidate.key === 'inbox' ? inboxItems.length : candidate.key === 'mine' ? mineItems.length : requests.length;
            return (
              <button
                key={candidate.key}
                type="button"
                aria-pressed={segment === candidate.key}
                onClick={() => setSegment(candidate.key)}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                  segment === candidate.key
                    ? 'border-blue-600 bg-blue-50 text-slate-950'
                    : 'border-slate-200 bg-white text-slate-500 hover:text-slate-800'
                }`}
              >
                {candidate.label}
                <span
                  className={`rounded-full px-1.5 py-px text-[10px] tabular-nums ${
                    candidate.key === 'inbox' && count > 0
                      ? 'bg-accent-50 text-warning-800'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {isLoading ? (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-14 text-center text-sm text-slate-500">
            Loading requests…
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
            <Inbox className="mx-auto h-6 w-6 text-slate-300" />
            <p className="mt-2 text-sm font-semibold text-slate-900">
              {segment === 'inbox' ? 'Nothing waiting on you' : 'No requests here yet'}
            </p>
          </div>
        ) : (
          visible.map((item) => {
            const isOpen = expanded.has(item.id);
            const age = ageInDays(item.created_at);
            const reviewable = item.status === 'pending' && canReview(item) && Number(item.user_id) !== currentUserId;
            const cacheKey = `${Number(item.user_id)}:${String(item.attendance_date || '').slice(0, 10)}`;
            const cachedDay = dayCache.get(cacheKey);

            return (
              <div key={item.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="flex items-center gap-3 px-3.5 py-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">
                    {initialsOf(item.user?.name || 'You')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-slate-950">
                      {Number(item.user_id) === currentUserId ? 'You' : item.user?.name || 'Unknown'}
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      submitted {age === 0 ? 'today' : `${age}d ago`}
                      {item.reviewer?.name ? ` · reviewed by ${item.reviewer.name}` : ''}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1 text-xs text-slate-600">
                    <b className="font-bold tabular-nums text-slate-900">{formatDateShort(item.attendance_date)}</b>
                    {' · '}
                    <b className="font-bold tabular-nums text-slate-900">
                      +{formatDuration(Number(item.extra_seconds || 0))}
                    </b>
                  </span>
                  {item.status === 'pending' ? (
                    <span
                      className={`flex shrink-0 items-center gap-1 text-[10px] font-bold tabular-nums ${
                        age > AGE_WARN_DAYS ? 'text-warning-800' : 'text-slate-500'
                      }`}
                    >
                      {age > AGE_WARN_DAYS ? <Hourglass className="h-3 w-3" /> : null}
                      {age}d
                    </span>
                  ) : (
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] ${statusTone(item.status)}`}
                    >
                      {item.status}
                    </span>
                  )}
                  {reviewable ? (
                    <span className="flex shrink-0 items-center gap-1.5">
                      <Button size="sm" onClick={() => void onApprove(item.id)}>
                        Approve
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => void onReject(item.id)}>
                        Reject
                      </Button>
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => toggleExpand(item.id)}
                    aria-expanded={isOpen}
                    aria-label="Details"
                    className="shrink-0 rounded-md p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                  >
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>
                </div>

                {reviewable ? (
                  <div className="border-t border-slate-100 px-3.5 py-2.5">
                    {cachedDay === undefined ? (
                      <p className="text-[11px] text-slate-500">Loading that day…</p>
                    ) : (
                      <DayMath
                        worked={cachedDay?.worked_seconds != null ? Number(cachedDay.worked_seconds) : null}
                        extraSeconds={Number(item.extra_seconds || 0)}
                      />
                    )}
                  </div>
                ) : null}

                {isOpen ? (
                  <div className="space-y-2 border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                    <p>{item.message || 'No message provided.'}</p>
                    {item.approval_destination ? (
                      <p className="font-medium text-blue-800">{item.approval_destination}</p>
                    ) : null}
                    {item.review_note ? <p>Review note: {item.review_note}</p> : null}
                    {item.status === 'pending' ? renderEscalate?.(item) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
