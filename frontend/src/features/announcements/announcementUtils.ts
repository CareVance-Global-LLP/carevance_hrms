import type { AppNotificationItem } from '@/types';

export type AnnouncementPriority = 'low' | 'medium' | 'high' | 'urgent';

export const PRIORITY_OPTIONS: AnnouncementPriority[] = ['low', 'medium', 'high', 'urgent'];

interface PriorityMeta {
  label: string;
  /** The rule down the left edge of a feed row. */
  rule: string;
  chip: string;
  rank: number;
}

/**
 * Priority was stored at publish time and read by nothing except the desktop
 * notifier, so an "urgent" announcement looked identical to a "low" one in the
 * list. These are the styles that finally make it visible.
 */
export const PRIORITY_META: Record<AnnouncementPriority, PriorityMeta> = {
  urgent: {
    label: 'Urgent',
    rule: 'bg-rose-500',
    chip: 'bg-rose-50 text-rose-700 border-rose-200',
    rank: 0,
  },
  high: {
    label: 'High',
    rule: 'bg-amber-500',
    chip: 'bg-amber-50 text-amber-700 border-amber-200',
    rank: 1,
  },
  medium: {
    label: 'Normal',
    rule: 'bg-slate-300',
    chip: 'bg-slate-100 text-slate-700 border-slate-200',
    rank: 2,
  },
  low: {
    label: 'Low',
    rule: 'bg-slate-200',
    chip: 'bg-slate-100 text-slate-600 border-slate-200',
    rank: 3,
  },
};

export const getPriority = (item: AppNotificationItem): AnnouncementPriority | null => {
  const raw = String(item.meta?.priority || '').trim().toLowerCase();
  return (PRIORITY_OPTIONS as string[]).includes(raw) ? (raw as AnnouncementPriority) : null;
};

/**
 * Polls are published with an empty title, so `item.title` renders a blank
 * heading for them. The question is the headline — this is what the card should
 * show instead.
 */
export const getAnnouncementHeadline = (item: AppNotificationItem): string => {
  const title = String(item.title || '').trim();
  if (title) return title;
  const question = String(item.poll?.question || '').trim();
  if (question) return question;
  return 'Untitled';
};

export interface PollTally {
  totalVotes: number;
  options: Array<{
    id: number;
    text: string;
    votes: number;
    percent: number;
    hasVoted: boolean;
  }>;
  hasVoted: boolean;
  isMultipleChoice: boolean;
  isExpired: boolean;
}

export const tallyPoll = (
  poll: NonNullable<AppNotificationItem['poll']>,
  override?: { data?: Array<{ id: number; option_text: string; vote_count: number; has_voted?: boolean }>; total_votes?: number; is_multiple_choice?: boolean; has_expired?: boolean }
): PollTally => {
  const source = override?.data ?? poll.options ?? [];
  const totalVotes = override?.total_votes ?? source.reduce((sum, option) => sum + Number(option.vote_count || 0), 0);

  return {
    totalVotes,
    options: source.map((option) => ({
      id: option.id,
      text: option.option_text,
      votes: Number(option.vote_count || 0),
      percent: totalVotes > 0 ? Math.round((Number(option.vote_count || 0) / totalVotes) * 100) : 0,
      hasVoted: Boolean(option.has_voted),
    })),
    hasVoted: source.some((option) => option.has_voted),
    isMultipleChoice: override?.is_multiple_choice ?? poll.is_multiple_choice ?? false,
    isExpired: override?.has_expired ?? (poll.expires_at ? new Date(poll.expires_at).getTime() < Date.now() : false),
  };
};

/** Recipient summary for a row the current user sent. */
export interface DeliveryStat {
  total: number;
  read: number;
}

export const getReadPercent = (stat: DeliveryStat) =>
  stat.total > 0 ? Math.round((stat.read / stat.total) * 100) : 0;
