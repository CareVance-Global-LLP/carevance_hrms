import Button from '@/components/ui/Button';
import { formatDateTime } from '@/lib/dateTime';
import { getNotificationDisplay } from '@/lib/notificationDisplay';
import type { AppNotificationItem } from '@/types';
import { cn } from '@/utils/cn';
import {
  PRIORITY_META,
  getAnnouncementHeadline,
  getPriority,
  getReadPercent,
  tallyPoll,
  type DeliveryStat,
} from './announcementUtils';

interface AnnouncementRowProps {
  item: AppNotificationItem;
  viewerTimezone: string;
  delivery?: DeliveryStat;
  onOpenPoll: (item: AppNotificationItem) => void;
  onMarkRead: (id: number) => void;
  onOpenRoute?: (item: AppNotificationItem) => void;
  canOpenRoute: boolean;
}

/**
 * One announcement in the feed.
 *
 * Three things this row does that the old card could not: it shows priority as
 * a rule down the left edge (priority was stored and never rendered), it prints
 * a poll's question and standings instead of an empty heading, and — when the
 * viewer sent it — how many recipients have opened it.
 */
export default function AnnouncementRow({
  item,
  viewerTimezone,
  delivery,
  onOpenPoll,
  onMarkRead,
  onOpenRoute,
  canOpenRoute,
}: AnnouncementRowProps) {
  const display = getNotificationDisplay(item.type);
  const priority = getPriority(item);
  const priorityMeta = priority ? PRIORITY_META[priority] : null;
  const isPoll = item.type === 'poll' && Boolean(item.poll);
  const tally = isPoll ? tallyPoll(item.poll!) : null;
  const headline = getAnnouncementHeadline(item);

  return (
    <article
      className={cn(
        'grid grid-cols-[3px_1fr] gap-3 border-b border-slate-100 last:border-b-0',
        !item.is_read ? 'bg-blue-50/40' : ''
      )}
    >
      <span
        aria-hidden="true"
        className={cn('my-3 rounded-full', priorityMeta ? priorityMeta.rule : 'bg-slate-200')}
      />

      <div className="flex flex-col gap-2 py-3 pr-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-600">{display.icon}</span>
            <h3 className="text-sm font-semibold text-slate-950">{headline}</h3>
            {!item.is_read ? (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-800">
                New
              </span>
            ) : null}
          </div>

          {item.message ? <p className="mt-1 text-sm text-slate-600">{item.message}</p> : null}

          {/* A poll used to render as a blank heading with its message hidden —
              you could not see what was being asked without opening it. */}
          {tally ? (
            <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50/60 p-2.5">
              <p className="text-xs font-semibold text-slate-900">{item.poll!.question}</p>
              <ul className="mt-2 space-y-1.5">
                {tally.options.slice(0, 4).map((option) => (
                  <li key={option.id} className="grid grid-cols-[1fr_2.5rem] items-center gap-2">
                    <span className="relative h-4 overflow-hidden rounded border border-blue-200 bg-surface-card">
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-0 left-0 bg-blue-600/25"
                        style={{ width: `${option.percent}%` }}
                      />
                      <span className="relative block truncate px-1.5 text-[10px] leading-4 text-slate-800">
                        {option.text}
                      </span>
                    </span>
                    <span className="text-right text-[10px] tabular-nums text-slate-600">{option.percent}%</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[10px] text-slate-600">
                {tally.totalVotes} vote{tally.totalVotes === 1 ? '' : 's'}
                {tally.isMultipleChoice ? ' · multiple choice' : ''}
                {tally.isExpired ? ' · closed' : tally.hasVoted ? ' · you voted' : ''}
              </p>
            </div>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
            {priorityMeta && priority !== 'medium' && priority !== 'low' ? (
              <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-semibold', priorityMeta.chip)}>
                {priorityMeta.label}
              </span>
            ) : null}
            <span>{display.label}</span>
            {item.sender ? <span>· sent by {item.sender.name}</span> : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
          <span className="text-[11px] text-slate-600">{formatDateTime(item.created_at, viewerTimezone)}</span>

          {delivery && delivery.total > 0 ? (
            <div className="flex items-center gap-2" title={`${delivery.read} of ${delivery.total} recipients opened this`}>
              <span className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200">
                <span
                  className="block h-full rounded-full bg-blue-600"
                  style={{ width: `${getReadPercent(delivery)}%` }}
                />
              </span>
              <span className="whitespace-nowrap text-[10px] tabular-nums text-slate-600">
                {delivery.read} / {delivery.total} read
              </span>
            </div>
          ) : null}

          <div className="flex gap-1.5">
            {isPoll ? (
              <Button size="sm" variant="secondary" onClick={() => onOpenPoll(item)}>
                {tally?.hasVoted || tally?.isExpired ? 'Results' : 'Vote'}
              </Button>
            ) : canOpenRoute && onOpenRoute ? (
              <Button size="sm" variant="secondary" onClick={() => onOpenRoute(item)}>
                Review
              </Button>
            ) : null}
            {!item.is_read ? (
              <Button size="sm" variant="ghost" onClick={() => onMarkRead(item.id)}>
                Mark read
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
