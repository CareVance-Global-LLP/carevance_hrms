import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Hourglass, Inbox, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import { formatDuration } from '@/lib/formatters';

export type ApprovalKind = 'leave' | 'time-edit' | 'resignation' | 'payroll-lock';
export type StreamFilter = 'all' | ApprovalKind;
export type StreamView = 'pending' | 'history';

/** Superset of the page's ApprovalCardItem — only what the stream renders. */
export interface StreamCard {
  id: number;
  kind: ApprovalKind;
  submittedAt: string;
  description: string;
  employeeName: string;
  employeeEmail: string;
  status: string;
  userId?: number | null;
  reviewerName?: string;
  reviewedAt?: string | null;
  approval_destination?: string | null;
  isSelfApproval?: boolean;
  /* structured facts, per kind */
  startDate?: string | null;
  endDate?: string | null;
  leaveType?: string | null;
  leaveCategory?: string | null;
  attendanceDate?: string | null;
  extraSeconds?: number | null;
  lastWorkingDate?: string | null;
  title?: string;
  onApprove?: () => Promise<void>;
  onReject?: () => Promise<void>;
}

const KIND_META: Record<ApprovalKind, { label: string; chip: string }> = {
  leave: { label: 'Leave', chip: 'bg-blue-50 text-blue-800 border-blue-200' },
  'time-edit': { label: 'Time edit', chip: 'bg-success-50 text-success-800 border-success-100' },
  resignation: { label: 'Resignation', chip: 'bg-danger-50 text-danger-800 border-danger-100' },
  'payroll-lock': { label: 'Payroll lock', chip: 'bg-accent-50 text-warning-800 border-accent-200' },
};

const cardKey = (card: StreamCard) => `${card.kind}-${card.id}`;

export const ageInDays = (submittedAt: string): number => {
  const submitted = new Date(submittedAt);
  if (Number.isNaN(submitted.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - submitted.getTime()) / 86_400_000));
};

/** Aging turns visible after two days — a request nobody answered is a problem. */
const AGE_WARN_DAYS = 2;

const formatDateOnly = (value?: string | null) => {
  const normalized = String(value || '').slice(0, 10);
  if (!normalized) return '';
  const parsed = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return normalized;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/**
 * The one line that decides the request. Everything else — reason, escalation,
 * destinations — is detail, available on expand.
 */
function FactLine({ card, coverage }: { card: StreamCard; coverage?: { count: number; label: string } | null }) {
  if (card.kind === 'leave') {
    const span = [formatDateOnly(card.startDate), formatDateOnly(card.endDate)].filter(Boolean).join(' – ');
    const type = card.leaveType === 'half_day' ? 'half day' : null;
    return (
      <span className="text-xs text-slate-600">
        <b className="font-bold tabular-nums text-slate-900">{span}</b>
        {card.leaveCategory ? ` · ${String(card.leaveCategory).replace(/_/g, ' ')}` : ''}
        {type ? ` · ${type}` : ''}
        {coverage ? (
          coverage.count > 0 ? (
            <span className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-warning-800">
              <AlertTriangle className="h-3 w-3 shrink-0" /> {coverage.label}
            </span>
          ) : (
            <span className="mt-0.5 block text-[11px] font-medium text-success-800">
              ✓ Nobody else off in this span
            </span>
          )
        ) : null}
      </span>
    );
  }

  if (card.kind === 'time-edit') {
    return (
      <span className="text-xs text-slate-600">
        <b className="font-bold tabular-nums text-slate-900">{formatDateOnly(card.attendanceDate)}</b>
        {' · '}
        <b className="font-bold tabular-nums text-slate-900">+{formatDuration(Number(card.extraSeconds || 0))}</b>
        {' requested'}
      </span>
    );
  }

  if (card.kind === 'resignation') {
    return (
      <span className="text-xs text-slate-600">
        Last working day <b className="font-bold tabular-nums text-slate-900">{formatDateOnly(card.lastWorkingDate)}</b>
      </span>
    );
  }

  return <span className="text-xs text-slate-600">{card.title}</span>;
}

const statusTone = (status: string): string => {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'approved') return 'bg-success-50 text-success-800 border-success-100';
  if (normalized === 'rejected') return 'bg-danger-50 text-danger-800 border-danger-100';
  return 'bg-slate-100 text-slate-600 border-slate-200';
};

const initialsOf = (value: string): string => {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export interface ApprovalStreamProps {
  pending: StreamCard[];
  history: StreamCard[];
  filter: StreamFilter;
  onFilterChange: (next: StreamFilter) => void;
  view: StreamView;
  onViewChange: (next: StreamView) => void;
  visibleKinds: ApprovalKind[];
  isLoading: boolean;
  busy: boolean;
  onAction: (action: () => Promise<void>, successMessage: string) => Promise<void> | void;
  onBulk: (cards: StreamCard[], decision: 'approve' | 'reject') => Promise<void> | void;
  coverageFor?: (card: StreamCard) => { count: number; label: string } | null;
  renderDetail?: (card: StreamCard) => ReactNode;
}

/**
 * One stream for everything pending on the viewer — the Keka-inbox shape.
 * Type chips filter it, nothing lives behind a section switch, and multi-select
 * clears a Friday backlog in two clicks instead of twenty.
 */
export default function ApprovalStream({
  pending,
  history,
  filter,
  onFilterChange,
  view,
  onViewChange,
  visibleKinds,
  isLoading,
  busy,
  onAction,
  onBulk,
  coverageFor,
  renderDetail,
}: ApprovalStreamProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const source = view === 'pending' ? pending : history;
  const cards = useMemo(() => {
    const filtered = filter === 'all' ? source : source.filter((card) => card.kind === filter);
    return [...filtered].sort((a, b) =>
      view === 'pending'
        ? +new Date(a.submittedAt) - +new Date(b.submittedAt) // oldest first: longest-waiting on top
        : +new Date(b.reviewedAt || b.submittedAt) - +new Date(a.reviewedAt || a.submittedAt)
    );
  }, [source, filter, view]);

  const selectedCards = useMemo(
    () => cards.filter((card) => selected.has(cardKey(card)) && (card.onApprove || card.onReject)),
    [cards, selected]
  );

  const toggleSelect = (key: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleExpand = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const clearSelection = () => setSelected(new Set());

  const chips: Array<{ key: StreamFilter; label: string }> = [
    { key: 'all', label: 'Everything' },
    ...visibleKinds.map((kind) => ({ key: kind as StreamFilter, label: KIND_META[kind].label })),
  ];

  const pendingCount = (kind: StreamFilter) =>
    kind === 'all' ? pending.length : pending.filter((card) => card.kind === kind).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            aria-pressed={filter === chip.key}
            onClick={() => onFilterChange(chip.key)}
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
              filter === chip.key
                ? 'border-blue-600 bg-blue-50 text-slate-950'
                : 'border-slate-200 bg-white text-slate-500 hover:text-slate-800'
            }`}
          >
            {chip.label}
            <span
              className={`rounded-full px-1.5 py-px text-[10px] tabular-nums ${
                chip.key === 'all' && pending.length > 0
                  ? 'bg-accent-50 text-warning-800'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              {pendingCount(chip.key)}
            </span>
          </button>
        ))}

        <div className="ml-auto flex gap-0.5 rounded-lg bg-slate-100 p-0.5" role="group" aria-label="View">
          {(['pending', 'history'] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={view === candidate}
              onClick={() => {
                onViewChange(candidate);
                clearSelection();
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition ${
                view === candidate ? 'bg-white text-slate-950 shadow-card' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {candidate}
            </button>
          ))}
        </div>
      </div>

      {view === 'pending' && selectedCards.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5">
          <p className="text-xs font-bold text-blue-900">{selectedCards.length} selected</p>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                void onBulk(selectedCards, 'approve');
                clearSelection();
              }}
            >
              <Check className="h-3.5 w-3.5" /> Approve all
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              onClick={() => {
                void onBulk(selectedCards, 'reject');
                clearSelection();
              }}
            >
              Reject all
            </Button>
            <button
              type="button"
              onClick={clearSelection}
              aria-label="Clear selection"
              className="rounded p-1 text-slate-500 transition hover:text-slate-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-500">
          Loading approvals…
        </div>
      ) : cards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center">
          <Inbox className="mx-auto h-7 w-7 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-900">
            {view === 'pending' ? 'Inbox zero' : 'No history here yet'}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {view === 'pending'
              ? filter === 'all'
                ? 'Nothing is waiting on you right now.'
                : `No ${KIND_META[filter as ApprovalKind].label.toLowerCase()} requests are waiting.`
              : 'Decisions you make will appear here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {cards.map((card) => {
            const key = cardKey(card);
            const age = ageInDays(card.submittedAt);
            const isOpen = expanded.has(key);
            const actionable = view === 'pending' && (card.onApprove || card.onReject);
            const coverage = card.kind === 'leave' && view === 'pending' ? coverageFor?.(card) ?? null : null;

            return (
              <div key={key} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="flex items-center gap-3 px-3.5 py-2.5">
                  {actionable ? (
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={() => toggleSelect(key)}
                      aria-label={`Select request from ${card.employeeName}`}
                      className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-blue-600"
                    />
                  ) : null}

                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">
                    {initialsOf(card.employeeName)}
                  </span>

                  <span className="min-w-0 flex-[1.2]">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-bold text-slate-950">{card.employeeName}</span>
                      <span
                        className={`shrink-0 rounded-full border px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.06em] ${KIND_META[card.kind].chip}`}
                      >
                        {KIND_META[card.kind].label}
                      </span>
                    </span>
                    <span className="block truncate text-[10px] text-slate-500">
                      submitted {age === 0 ? 'today' : `${age}d ago`}
                      {card.reviewerName ? ` · reviewed by ${card.reviewerName}` : ''}
                    </span>
                  </span>

                  <span className="min-w-0 flex-[1.6]">
                    <FactLine card={card} coverage={coverage} />
                  </span>

                  {view === 'pending' ? (
                    <span
                      className={`flex shrink-0 items-center gap-1 text-[10px] font-bold tabular-nums ${
                        age > AGE_WARN_DAYS ? 'text-warning-800' : 'text-slate-500'
                      }`}
                      title={age > AGE_WARN_DAYS ? `Waiting ${age} days` : undefined}
                    >
                      {age > AGE_WARN_DAYS ? <Hourglass className="h-3 w-3" /> : null}
                      {age}d
                    </span>
                  ) : (
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] ${statusTone(card.status)}`}
                    >
                      {String(card.status || '').replace(/_/g, ' ')}
                    </span>
                  )}

                  {actionable ? (
                    <span className="flex shrink-0 items-center gap-1.5">
                      {card.onApprove ? (
                        <Button
                          size="sm"
                          disabled={busy || card.isSelfApproval}
                          title={card.isSelfApproval ? 'You cannot approve your own request' : undefined}
                          onClick={() =>
                            void onAction(card.onApprove!, `${card.employeeName}'s request approved.`)
                          }
                        >
                          Approve
                        </Button>
                      ) : null}
                      {card.onReject ? (
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void onAction(card.onReject!, `${card.employeeName}'s request rejected.`)
                          }
                        >
                          Reject
                        </Button>
                      ) : null}
                    </span>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => toggleExpand(key)}
                    aria-expanded={isOpen}
                    aria-label="Details"
                    className="shrink-0 rounded-md p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                  >
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>
                </div>

                {isOpen ? (
                  <div className="space-y-2 border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                    <p>{card.description}</p>
                    {card.approval_destination ? (
                      <p className="font-medium text-blue-800">{card.approval_destination}</p>
                    ) : null}
                    {renderDetail?.(card)}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
