import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarPlus } from 'lucide-react';
import { recruitmentApi, userApi } from '@/services/api';
import type { Interview, InterviewSummary, InterviewVerdict } from '@/types';
import Button from '@/components/ui/Button';
import { FieldLabel, SelectInput, TextInput, TextareaInput } from '@/components/ui/FormField';

/**
 * Interviews on one candidacy, and what the panel said.
 *
 * THE SPLIT IS THE HEADLINE, NEVER AN AVERAGE. Three people going two-to-one
 * and three people all lukewarm produce the same mean, and they call for
 * completely different conversations — so a divided panel is called out in
 * words rather than left for somebody to work out from a score.
 *
 * WHO HAS NOT ANSWERED IS SHOWN. "Two of three have responded" is what a
 * recruiter chases all day, and a list of only-submitted feedback cannot say
 * it.
 */
const VERDICT_LABEL: Record<InterviewVerdict, string> = {
  strong_yes: 'Strong yes',
  yes: 'Yes',
  no: 'No',
  strong_no: 'Strong no',
};

export default function InterviewPanel({ applicationId }: { applicationId: number }) {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const [scheduling, setScheduling] = useState(false);
  const [error, setError] = useState('');
  const [openSummary, setOpenSummary] = useState<number | null>(null);

  const interviewsQuery = useQuery({
    queryKey: ['interviews', applicationId],
    queryFn: async () => (await recruitmentApi.interviews({ job_application_id: applicationId })).data,
  });

  const colleaguesQuery = useQuery({
    queryKey: ['interview-panel-options'],
    queryFn: async () => (await userApi.getAll({ simple: 1 })).data,
    enabled: scheduling,
  });

  const schedule = useMutation({
    mutationFn: (payload: Record<string, unknown>) => recruitmentApi.scheduleInterview(payload),
    onSuccess: () => {
      setScheduling(false);
      setError('');
      queryClient.invalidateQueries({ queryKey: ['interviews', applicationId] });
    },
    onError: (err: any) => setError(err?.response?.data?.message || 'Could not schedule that interview.'),
  });

  const interviews = interviewsQuery.data?.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Interviews</h3>
        <Button
          className="ml-auto"
          variant="secondary"
          size="sm"
          iconLeft={<CalendarPlus className="h-3.5 w-3.5" />}
          onClick={() => setScheduling(true)}
        >
          Schedule
        </Button>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      ) : null}

      {scheduling ? (
        <form
          className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            schedule.mutate({
              job_application_id: applicationId,
              title: String(form.get('title') || ''),
              mode: String(form.get('mode') || 'video'),
              scheduled_at: String(form.get('scheduled_at')),
              duration_minutes: Number(form.get('duration_minutes')) || 60,
              panellist_ids: form.getAll('panellist_ids').map(Number).filter(Boolean),
            });
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor={`${fieldId}-title`}>What round</FieldLabel>
              <TextInput id={`${fieldId}-title`} name="title" placeholder="Systems design" />
            </div>
            <div>
              <FieldLabel htmlFor={`${fieldId}-mode`}>Where</FieldLabel>
              <SelectInput id={`${fieldId}-mode`} name="mode" defaultValue="video">
                <option value="video">Video</option>
                <option value="phone">Phone</option>
                <option value="onsite">Onsite</option>
                <option value="take_home">Take-home</option>
              </SelectInput>
            </div>
            <div>
              <FieldLabel htmlFor={`${fieldId}-at`}>When</FieldLabel>
              <TextInput id={`${fieldId}-at`} name="scheduled_at" type="datetime-local" required />
            </div>
            <div>
              <FieldLabel htmlFor={`${fieldId}-mins`}>Minutes</FieldLabel>
              <TextInput id={`${fieldId}-mins`} name="duration_minutes" type="number" min="5" defaultValue="60" />
            </div>
          </div>

          <div>
            <FieldLabel htmlFor={`${fieldId}-panel`}>Panel</FieldLabel>
            <select
              id={`${fieldId}-panel`}
              name="panellist_ids"
              multiple
              size={4}
              className="w-full rounded-lg border border-slate-300 p-2 text-xs"
            >
              {(colleaguesQuery.data ?? []).map((person: any) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-500">
              {/* Said here because the server enforces it and a recruiter
                  should not discover the rule from a refusal. */}
              Only people on the panel can leave feedback.
            </p>
          </div>

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={schedule.isPending}>
              {schedule.isPending ? 'Scheduling…' : 'Schedule'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setScheduling(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {interviews.length === 0 ? (
        <p className="rounded border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500">
          No interviews yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {interviews.map((interview) => (
            <li key={interview.id} className="rounded border border-slate-200 bg-white p-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-slate-900">{interview.title || 'Interview'}</span>
                <span className="text-slate-500">{new Date(interview.scheduled_at).toLocaleString()}</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                  {interview.status}
                </span>
                <Button
                  className="ml-auto"
                  variant="ghost"
                  size="sm"
                  onClick={() => setOpenSummary(openSummary === interview.id ? null : interview.id)}
                >
                  {openSummary === interview.id ? 'Hide' : 'Feedback'}
                </Button>
              </div>

              {openSummary === interview.id ? (
                <PanelSummary interview={interview} applicationId={applicationId} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What the panel said, plus a way to add your own. */
function PanelSummary({ interview, applicationId }: { interview: Interview; applicationId: number }) {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const [error, setError] = useState('');

  const summaryQuery = useQuery({
    queryKey: ['interview-summary', interview.id],
    queryFn: async () => (await recruitmentApi.interviewSummary(interview.id)).data.data,
  });

  const submit = useMutation({
    mutationFn: (payload: { verdict: InterviewVerdict; rating?: number | null; notes?: string | null }) =>
      recruitmentApi.submitFeedback(interview.id, payload),
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['interview-summary', interview.id] });
      queryClient.invalidateQueries({ queryKey: ['interviews', applicationId] });
    },
    // The server refuses anybody not on the panel. Shown rather than
    // swallowed, because "nothing happened" is the worst possible answer.
    onError: (err: any) => setError(err?.response?.data?.message || 'Could not record that.'),
  });

  const summary: InterviewSummary | undefined = summaryQuery.data;

  return (
    <div className="mt-2 border-t border-slate-100 pt-2">
      {error ? <p className="mb-2 text-[11px] text-red-700">{error}</p> : null}

      {summary ? (
        <>
          <p className="text-[11px] text-slate-600">
            {/* Invited and submitted are different states, and this is the
                question a recruiter asks all day. */}
            {summary.panel.submitted} of {summary.panel.invited} have given feedback
            {summary.panel.outstanding > 0 ? ` · ${summary.panel.outstanding} outstanding` : ''}
          </p>

          {summary.is_split ? (
            <p className="mt-1 flex items-start gap-1.5 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {/* Named in words. A mean would show the same number for a
                  unanimously lukewarm panel. */}
              The panel is divided on this candidate.
            </p>
          ) : null}

          <ul className="mt-2 space-y-1">
            {summary.feedback.map((entry, index) => (
              <li key={index} className="text-[11px]">
                <span className="font-medium text-slate-900">{entry.interviewer ?? 'Interviewer'}</span>
                {' · '}
                <span
                  className={
                    entry.verdict === 'strong_yes' || entry.verdict === 'yes'
                      ? 'text-emerald-700'
                      : 'text-red-700'
                  }
                >
                  {VERDICT_LABEL[entry.verdict]}
                </span>
                {entry.rating ? <span className="text-slate-500"> · {entry.rating}/5</span> : null}
                {entry.notes ? <span className="block text-slate-600">{entry.notes}</span> : null}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-[11px] text-slate-400">Loading feedback…</p>
      )}

      <form
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          submit.mutate({
            verdict: String(form.get('verdict')) as InterviewVerdict,
            rating: form.get('rating') ? Number(form.get('rating')) : null,
            notes: String(form.get('notes') || '') || null,
          });
        }}
      >
        <div>
          <FieldLabel htmlFor={`${fieldId}-verdict`}>Your view</FieldLabel>
          <SelectInput id={`${fieldId}-verdict`} name="verdict" defaultValue="yes">
            {(Object.keys(VERDICT_LABEL) as InterviewVerdict[]).map((verdict) => (
              <option key={verdict} value={verdict}>
                {VERDICT_LABEL[verdict]}
              </option>
            ))}
          </SelectInput>
        </div>
        <div className="w-20">
          <FieldLabel htmlFor={`${fieldId}-rating`}>Score</FieldLabel>
          <TextInput id={`${fieldId}-rating`} name="rating" type="number" min="1" max="5" placeholder="–" />
        </div>
        <div className="min-w-[12rem] flex-1">
          <FieldLabel htmlFor={`${fieldId}-notes`}>Notes</FieldLabel>
          <TextareaInput id={`${fieldId}-notes`} name="notes" rows={2} />
        </div>
        <Button type="submit" size="sm" disabled={submit.isPending}>
          {submit.isPending ? 'Saving…' : 'Submit'}
        </Button>
      </form>
    </div>
  );
}
