import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { recruitmentApi } from '@/services/api';
import type { ApplicationStageEvent, JobApplication } from '@/types';
import { SlideOver } from '@/components/ui/dialog';
import Button from '@/components/ui/Button';
import { FieldLabel, TextareaInput } from '@/components/ui/FormField';
import InterviewPanel from './InterviewPanel';
import OfferPanel from './OfferPanel';

/**
 * One candidacy: where they are, how they got there, and how to end it.
 *
 * The history is the point. A current stage says where somebody is; only the
 * event trail answers "why has this person been in screening for three weeks",
 * which is the question that actually gets asked.
 *
 * Rejecting requires a reason, here as well as on the server. Asking for it at
 * the moment of the decision is the only time anybody actually knows it.
 */
const ACTION_LABEL: Record<ApplicationStageEvent['action'], string> = {
  applied: 'Applied',
  advanced: 'Moved forward',
  moved_back: 'Moved back',
  rejected: 'Rejected',
  withdrawn: 'Withdrew',
  hired: 'Hired',
};

export default function CandidateDrawer({
  application,
  onClose,
}: {
  application: JobApplication | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState<'rejected' | 'withdrawn' | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const open = application !== null;

  const eventsQuery = useQuery({
    queryKey: ['application-events', application?.id],
    queryFn: async () => (await recruitmentApi.applicationEvents(application!.id)).data.data,
    enabled: open,
  });

  const decide = useMutation({
    mutationFn: () => recruitmentApi.decideApplication(application!.id, decision!, reason.trim()),
    onSuccess: () => {
      setDecision(null);
      setReason('');
      setError('');
      queryClient.invalidateQueries({ queryKey: ['pipeline'] });
      onClose();
    },
    onError: (err: any) => setError(err?.response?.data?.message || 'Could not record that decision.'),
  });

  const name = `${application?.candidate?.first_name ?? ''} ${application?.candidate?.last_name ?? ''}`.trim();

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={name || 'Candidate'}
      subtitle={application?.candidate?.email ?? undefined}
    >
      {error ? (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-slate-100 px-2 py-1 font-medium text-slate-700">
          {application?.stage?.name ?? 'No stage'}
        </span>
        <span
          className={`rounded px-2 py-1 font-medium ${
            application?.status === 'active'
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          {application?.status}
        </span>
      </div>

      {application?.rejection_reason ? (
        <p className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <span className="font-semibold">Rejected:</span> {application.rejection_reason}
        </p>
      ) : null}

      {application?.status === 'active' ? (
        <div className="mb-4 space-y-4 border-b border-slate-200 pb-4">
          <InterviewPanel applicationId={application.id} />
          <OfferPanel applicationId={application.id} />
        </div>
      ) : null}

      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">History</h3>

      {eventsQuery.isLoading ? (
        <p className="py-4 text-center text-xs text-slate-500">Loading history…</p>
      ) : (
        <ol className="space-y-2">
          {(eventsQuery.data ?? []).map((event) => (
            <li key={event.id} className="rounded border border-slate-200 bg-white p-2 text-xs">
              <div className="flex flex-wrap items-baseline gap-1.5">
                <span className="font-medium text-slate-900">{ACTION_LABEL[event.action] ?? event.action}</span>
                {event.to_stage ? (
                  <span className="text-slate-600">
                    {event.from_stage ? `${event.from_stage.name} → ` : ''}
                    {event.to_stage.name}
                  </span>
                ) : null}
                <span className="ml-auto tabular-nums text-slate-500">
                  {new Date(event.created_at).toLocaleDateString()}
                </span>
              </div>
              {event.note ? <p className="mt-0.5 text-slate-600">{event.note}</p> : null}
              {event.actor ? <p className="mt-0.5 text-[10px] text-slate-500">by {event.actor.name}</p> : null}
            </li>
          ))}
        </ol>
      )}

      {application?.status === 'active' ? (
        <div className="mt-4 border-t border-slate-200 pt-3">
          {decision ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                decide.mutate();
              }}
            >
              <FieldLabel>
                {decision === 'rejected' ? 'Why are they not moving forward?' : 'What did they say?'}
              </FieldLabel>
              <TextareaInput
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                // Required for a rejection here as well as on the server. The
                // moment of the decision is the only time anybody knows it.
                required={decision === 'rejected'}
                placeholder={decision === 'rejected' ? 'Failed the system design round' : 'Accepted another offer'}
              />

              <div className="mt-2 flex gap-2">
                <Button type="submit" disabled={decide.isPending}>
                  {decide.isPending ? 'Saving...' : 'Confirm'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setDecision(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setDecision('rejected')}>
                Reject
              </Button>
              {/* A separate action, not a flavour of rejection — different
                  statistic, and filing it as a rejection makes a team look
                  pickier than it is. */}
              <Button variant="ghost" size="sm" onClick={() => setDecision('withdrawn')}>
                They withdrew
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </SlideOver>
  );
}
