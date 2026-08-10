import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import Button from '@/components/ui/Button';
import SlideOver from '@/features/employees/SlideOver';
import { notificationApi } from '@/services/api';
import type { AppNotificationItem, PollResultsResponse } from '@/types';
import { cn } from '@/utils/cn';
import { tallyPoll } from './announcementUtils';

interface PollPanelProps {
  item: AppNotificationItem;
  onClose: () => void;
  onVoted: () => void;
  notifyError: (message: string) => void;
}

/**
 * Voting happens in a drawer. It used to expand underneath the card inside the
 * feed, so opening a poll pushed every announcement below it down the page.
 */
export default function PollPanel({ item, onClose, onVoted, notifyError }: PollPanelProps) {
  const poll = item.poll!;
  const [results, setResults] = useState<PollResultsResponse | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    notificationApi
      .getPollResults(poll.id)
      .then((response) => {
        if (!cancelled) setResults(response.data);
      })
      .catch(() => {
        if (!cancelled) setResults(null);
      });
    return () => {
      cancelled = true;
    };
  }, [poll.id]);

  const tally = tallyPoll(poll, results ?? undefined);
  const closed = tally.isExpired || tally.hasVoted;

  const toggle = (optionId: number) => {
    setSelected((current) => {
      if (tally.isMultipleChoice) {
        return current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId];
      }
      return [optionId];
    });
  };

  const submit = async () => {
    if (selected.length === 0) {
      notifyError('Pick an option before voting.');
      return;
    }
    setIsSubmitting(true);
    try {
      await notificationApi.votePoll(poll.id, selected);
      const response = await notificationApi.getPollResults(poll.id);
      setResults(response.data);
      onVoted();
    } catch (error: any) {
      notifyError(error?.response?.data?.message || 'Failed to submit vote.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SlideOver
      open
      onClose={onClose}
      title={poll.question}
      subtitle={`${tally.totalVotes} vote${tally.totalVotes === 1 ? '' : 's'}${
        tally.isMultipleChoice ? ' · multiple choice' : ''
      }${tally.isExpired ? ' · closed' : ''}`}
      footer={
        closed ? (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={isSubmitting || selected.length === 0}>
              {isSubmitting ? 'Submitting...' : 'Vote'}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3">
        {item.message ? <p className="text-sm text-slate-600">{item.message}</p> : null}

        {closed ? (
          <ul className="space-y-2">
            {tally.options.map((option) => (
              <li key={option.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                    {option.hasVoted ? <Check className="h-4 w-4 text-blue-700" aria-label="Your vote" /> : null}
                    {option.text}
                  </span>
                  <span className="text-xs tabular-nums text-slate-600">
                    {option.votes} · {option.percent}%
                  </span>
                </div>
                <span className="mt-2 block h-2 overflow-hidden rounded-full bg-slate-100">
                  <span className="block h-full rounded-full bg-blue-600" style={{ width: `${option.percent}%` }} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="space-y-2">
            {tally.options.map((option) => {
              const isSelected = selected.includes(option.id);
              return (
                <li key={option.id}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm text-slate-800 transition',
                      isSelected ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'
                    )}
                  >
                    <input
                      type={tally.isMultipleChoice ? 'checkbox' : 'radio'}
                      name={`poll-${poll.id}`}
                      checked={isSelected}
                      onChange={() => toggle(option.id)}
                      className="h-4 w-4 border-slate-300 text-blue-600"
                    />
                    <span className="flex-1">{option.text}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        {poll.expires_at ? (
          <p className="text-xs text-slate-600">Closes {new Date(poll.expires_at).toLocaleString()}</p>
        ) : null}
      </div>
    </SlideOver>
  );
}
