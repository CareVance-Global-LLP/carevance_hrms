import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import { overlappingApproved } from './leaveUtils';

type Segment = 'inbox' | 'mine' | 'all';

export interface LeaveRequestsPanelProps {
  requests: ReadonlyArray<any>;
  currentUserId: number;
  hasApprovalPowers: boolean;
  isLoading: boolean;
  canReview: (item: any) => boolean;
  canRequestRevoke: (item: any) => boolean;
  isAdmin: boolean;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  onRequestRevoke: (id: number) => void;
  onApproveRevoke: (id: number) => void;
  onRejectRevoke: (id: number) => void;
  formatCategoryLabel: (code?: string | null) => string;
  colorOf: (code?: string | null) => string;
  renderEscalate: (item: any) => ReactNode;
}

const STATUS_TONE: Record<string, string> = {
  approved: 'border-success-100 bg-success-50 text-success-800',
  pending: 'border-accent-200 bg-accent-50 text-warning-800',
  rejected: 'border-danger-100 bg-danger-50 text-danger-700',
  revoked: 'border-slate-200 bg-slate-50 text-slate-500',
};

const requestUserId = (item: any): number => Number(item?.user?.id ?? item?.user_id ?? 0);

/**
 * Requests, with action separated from history. The previous list mixed the
 * three pending approvals into everyone's past requests inside one inner
 * scroller — the segment whose count is gold is the one that needs you.
 */
export default function LeaveRequestsPanel({
  requests,
  currentUserId,
  hasApprovalPowers,
  isLoading,
  canReview,
  canRequestRevoke,
  isAdmin,
  onApprove,
  onReject,
  onRequestRevoke,
  onApproveRevoke,
  onRejectRevoke,
  formatCategoryLabel,
  colorOf,
  renderEscalate,
}: LeaveRequestsPanelProps) {
  const [segment, setSegment] = useState<Segment>(hasApprovalPowers ? 'inbox' : 'mine');

  const inbox = useMemo(
    () =>
      requests.filter(
        (item) => item.status === 'pending' && canReview(item) && requestUserId(item) !== currentUserId
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requests, currentUserId]
  );
  const mine = useMemo(
    () => requests.filter((item) => requestUserId(item) === currentUserId),
    [requests, currentUserId]
  );

  const segments: Array<{ key: Segment; label: string; count: number; warn?: boolean }> = [
    ...(hasApprovalPowers
      ? [{ key: 'inbox' as Segment, label: 'Needs my approval', count: inbox.length, warn: inbox.length > 0 }]
      : []),
    { key: 'mine', label: 'Mine', count: mine.length },
    { key: 'all', label: 'Everyone', count: requests.length },
  ];

  const visible = segment === 'inbox' ? inbox : segment === 'mine' ? mine : requests;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <h2 className="mr-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Requests</h2>
        {segments.map((candidate) => (
          <button
            key={candidate.key}
            type="button"
            aria-pressed={segment === candidate.key}
            onClick={() => setSegment(candidate.key)}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
              segment === candidate.key
                ? 'border-blue-600 bg-blue-50 text-blue-900'
                : 'border-slate-200 bg-white text-slate-500 hover:text-slate-800'
            }`}
          >
            {candidate.label}
            <span
              className={`rounded-full px-1.5 py-px font-mono text-[10px] tabular-nums ${
                candidate.warn ? 'bg-accent-50 text-warning-800' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {candidate.count}
            </span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-xs text-slate-400">
          Loading requests…
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center">
          <p className="text-sm font-semibold text-slate-900">
            {segment === 'inbox' ? 'Nothing waiting on you' : 'No requests here'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {segment === 'inbox'
              ? 'Approvals land in this segment the moment they are submitted.'
              : 'Submitted requests will appear here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((item) => {
            const reviewable = item.status === 'pending' && canReview(item);
            const overlaps = reviewable
              ? overlappingApproved(
                  requests,
                  String(item.start_date || ''),
                  String(item.end_date || ''),
                  requestUserId(item)
                )
              : [];
            const color = colorOf(item.leave_category);

            return (
              <div key={item.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[13px] font-bold tracking-[-0.01em] text-slate-950">
                      {item.user?.name || 'You'}
                      <span
                        className="rounded-full px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.06em]"
                        style={{ backgroundColor: `${color}1E`, color }}
                      >
                        {formatCategoryLabel(item.leave_category)}
                      </span>
                      {item.leave_type === 'half_day' ? (
                        <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] text-slate-500">
                          Half day
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500">
                      {item.start_date}
                      {item.end_date && item.end_date !== item.start_date ? ` → ${item.end_date}` : ''}
                    </p>

                    {reviewable ? (
                      overlaps.length > 0 ? (
                        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-warning-800">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          {overlaps.length} teammate{overlaps.length > 1 ? 's' : ''} already off in this span
                          <span className="font-normal text-slate-400">
                            ({overlaps
                              .slice(0, 2)
                              .map((other: any) => String(other.user?.name || 'Unknown').split(' ')[0])
                              .join(', ')}
                            {overlaps.length > 2 ? '…' : ''})
                          </span>
                        </p>
                      ) : (
                        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-success-800">
                          <CheckCircle2 className="h-3 w-3 shrink-0" />
                          Nobody else off in this span
                        </p>
                      )
                    ) : null}

                    {Array.isArray(item.consumed_breakdown) && item.consumed_breakdown.length > 0 ? (
                      <p className="mt-1 text-[11px] text-slate-500">
                        Consumed:{' '}
                        {item.consumed_breakdown
                          .map(
                            (part: any) =>
                              `${Number(part?.units || 0).toFixed(1)} ${formatCategoryLabel(part?.category)}`
                          )
                          .join(', ')}
                      </p>
                    ) : null}
                    {item.approval_destination ? (
                      <p className="mt-1 text-[11px] font-medium text-blue-700">{item.approval_destination}</p>
                    ) : null}
                    {item.reason ? <p className="mt-1 text-[11px] text-slate-600">{item.reason}</p> : null}
                    {item.revoke_status ? (
                      <p className="mt-1 text-[11px] text-slate-600">
                        Revoke request:{' '}
                        <span
                          className={`font-semibold ${
                            item.revoke_status === 'pending'
                              ? 'text-warning-800'
                              : item.revoke_status === 'approved'
                                ? 'text-success-800'
                                : 'text-danger-700'
                          }`}
                        >
                          {item.revoke_status}
                        </span>
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.08em] ${
                        STATUS_TONE[item.status] ?? STATUS_TONE.revoked
                      }`}
                    >
                      {item.status}
                    </span>

                    {reviewable ? (
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          className="bg-emerald-600 shadow-sm hover:bg-emerald-700"
                          onClick={() => onApprove(item.id)}
                        >
                          Approve
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => onReject(item.id)}>
                          Reject
                        </Button>
                      </div>
                    ) : null}

                    {!isAdmin && canRequestRevoke(item) ? (
                      <Button variant="danger" size="sm" onClick={() => onRequestRevoke(item.id)}>
                        Request revoke
                      </Button>
                    ) : null}

                    {canReview(item) && item.status === 'approved' && item.revoke_status === 'pending' ? (
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          className="bg-emerald-600 shadow-sm hover:bg-emerald-700"
                          onClick={() => onApproveRevoke(item.id)}
                        >
                          Approve revoke
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => onRejectRevoke(item.id)}>
                          Reject revoke
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>

                {renderEscalate(item)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
