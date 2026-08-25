import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, FileCheck2, Loader2, PartyPopper } from 'lucide-react';
import { onboardingApi, type ChecklistItem } from '@/services/api';
import { formatDate } from '@/lib/dateTime';
import { isEvidenceBacked } from '@/features/lifecycle/checklistEvidence';

/**
 * A new joiner's own onboarding, on their dashboard.
 *
 * Deliberately narrow: only the tasks this person owns. Whether IT has ordered
 * their laptop is not something they can act on, and showing it turns their
 * first screen into a list of other people's obligations.
 *
 * Renders nothing at all once there is no open journey, so it disappears from
 * the dashboard of everyone who is not currently joining.
 */
export default function MyOnboardingCard() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['my-onboarding'],
    queryFn: async () => (await onboardingApi.myJourney()).data.data,
    /*
     * Always refetched on mount, and never served stale.
     *
     * The read is what reconciles the checklist against the documents on file,
     * so a cached answer is not merely old — it is the answer from before the
     * upload the joiner just made. With a 60s staleTime they uploaded their PAN
     * card in Settings, came back to the dashboard, and saw the same pending
     * circle, which reads as "the upload did not work".
     */
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const completeItem = useMutation({
    mutationFn: async (item: ChecklistItem) =>
      onboardingApi.completeItem(data!.journey.id, item.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-onboarding'] }),
  });

  if (isLoading || !data) return null;

  const { journey, my_items: items, my_progress: progress, buddy, manager } = data;
  const allDone = progress.total > 0 && progress.done === progress.total;

  const daysAway = journey.days_until_joining;
  const whenLabel =
    daysAway === null || daysAway === undefined
      ? formatDate(journey.joining_date)
      : daysAway > 0
        ? `You start in ${daysAway} day${daysAway === 1 ? '' : 's'} — ${formatDate(journey.joining_date)}`
        : daysAway === 0
          ? `Today is your first day`
          : `You started ${formatDate(journey.joining_date)}`;

  return (
    <section className="scroll-mt-24 rounded-lg border border-sky-200 bg-sky-50/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-slate-950">
            {allDone ? 'You are all set' : 'Getting you set up'}
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">{whenLabel}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold tabular-nums text-slate-900">
            {progress.done}/{progress.total}
          </p>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">done</p>
        </div>
      </div>

      {/* One bar beats six numbers for "how far along am I". */}
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-sky-100">
        <div
          className="h-full rounded-full bg-sky-600 transition-all"
          style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
        />
      </div>

      {allDone ? (
        <p className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800">
          <PartyPopper className="h-4 w-4 shrink-0" />
          Everything on your list is done. {manager ? `${manager.name} will take it from here.` : ''}
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-1.5">
          {items.map((item) => {
            const done = item.status === 'done';
            const busy = completeItem.isPending && completeItem.variables?.id === item.id;
            // A manual tick leaves both empty, and then there is nothing
            // truthful to name.
            const evidence = item.evidence_label ?? item.document?.title ?? null;
            /*
             * The joiner does not tick these either.
             *
             * "Add PAN details" ticked by the person who was asked for the PAN,
             * without the PAN, is the least useful record in the system — and
             * the API refuses it, so offering the control would only produce an
             * error. Uploading it in Settings → Profile is what completes it.
             */
            const evidenceOnly = isEvidenceBacked(item);

            return (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={done || busy || evidenceOnly}
                  onClick={() => completeItem.mutate(item)}
                  title={
                    evidenceOnly && !done
                      ? 'Completes itself once you add this in Settings → Profile.'
                      : undefined
                  }
                  className="flex w-full items-start gap-2.5 rounded-lg border border-transparent bg-white px-3 py-2.5 text-left transition hover:border-sky-200 disabled:cursor-default disabled:opacity-70 focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  {busy ? (
                    <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-sky-600" />
                  ) : done ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={`block text-xs font-medium ${done ? 'text-slate-500 line-through' : 'text-slate-900'}`}>
                      {item.title}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-slate-500">
                      {/*
                        What satisfied it — a file, or a detail already on their
                        record. Without this a done item looks identical whether
                        the evidence cleared it or somebody clicked, and the
                        joiner cannot see that what they supplied was what
                        counted.
                      */}
                      {done && evidence ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <FileCheck2 className="h-3 w-3 shrink-0" />
                          <span className="truncate">From {evidence}</span>
                        </span>
                      ) : (
                        <>
                          {item.is_blocking && !done && (
                            <span className="font-semibold text-warning-800">Required</span>
                          )}
                          {item.is_blocking && !done && item.due_date ? <span> · </span> : null}
                          {item.due_date ? <span>by {formatDate(item.due_date)}</span> : null}
                          {/*
                            Where to go, since the row is no longer a control.
                            Without this the joiner is left with an item they
                            cannot act on and no hint that it completes itself.
                          */}
                          {evidenceOnly ? (
                            <span className="mt-0.5 block text-sky-700">Add this in Settings → Profile</span>
                          ) : null}
                        </>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {buddy && !allDone && (
        <p className="mt-3 text-[11px] text-slate-600">
          Stuck on something? <span className="font-medium text-slate-900">{buddy.name}</span> is your onboarding buddy.
        </p>
      )}
    </section>
  );
}
