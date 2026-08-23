import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, GripVertical } from 'lucide-react';
import { recruitmentApi } from '@/services/api';
import type { HiringStage, JobApplication } from '@/types';
import { PageLoadingState } from '@/components/ui/PageState';

/**
 * The pipeline, as columns.
 *
 * Every stage gets a column including the empty ones — a board that hides its
 * gaps is exactly the view a hiring manager cannot use, because the gap is the
 * problem.
 *
 * Drag-and-drop is HTML5 native rather than a library. The interaction is one
 * card into one column; pulling in a drag framework for that is weight the
 * bundle does not need, and the keyboard path below matters more anyway.
 *
 * KEYBOARD PARITY IS NOT OPTIONAL HERE. A recruiter lives in this screen all
 * day, and a board that can only be operated by mouse excludes both
 * keyboard-only users and anybody working fast. Each card carries a stage
 * selector that does the same thing as a drop.
 */
export default function PipelineBoard({
  jobOpeningId,
  onOpenCandidate,
}: {
  jobOpeningId: number;
  onOpenCandidate?: (application: JobApplication) => void;
}) {
  const queryClient = useQueryClient();
  const [dragging, setDragging] = useState<number | null>(null);
  const [hoverStage, setHoverStage] = useState<number | null>(null);
  const [error, setError] = useState('');

  const stagesQuery = useQuery({
    queryKey: ['hiring-stages'],
    queryFn: async () => (await recruitmentApi.stages()).data.data,
  });

  const applicationsQuery = useQuery({
    queryKey: ['pipeline', jobOpeningId],
    queryFn: async () =>
      (await recruitmentApi.applications({ job_opening_id: jobOpeningId, status: 'active' })).data,
  });

  const move = useMutation({
    mutationFn: ({ id, stageId }: { id: number; stageId: number }) =>
      recruitmentApi.moveApplication(id, stageId),
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['pipeline', jobOpeningId] });
      queryClient.invalidateQueries({ queryKey: ['opening', jobOpeningId] });
    },
    // The server refuses moves the board should never have offered — a decided
    // candidacy, a retired stage. Surfaced rather than swallowed, because the
    // card silently springing back is the worst possible feedback.
    onError: (err: any) => setError(err?.response?.data?.message || 'Could not move that candidate.'),
  });

  const stages = useMemo(
    () => (stagesQuery.data ?? []).filter((stage) => stage.is_active),
    [stagesQuery.data],
  );

  const byStage = useMemo(() => {
    const map = new Map<number, JobApplication[]>();
    (applicationsQuery.data?.data ?? []).forEach((application) => {
      const key = application.hiring_stage_id ?? -1;
      map.set(key, [...(map.get(key) ?? []), application]);
    });
    return map;
  }, [applicationsQuery.data]);

  if (stagesQuery.isLoading || applicationsQuery.isLoading) {
    return <PageLoadingState label="Loading pipeline..." />;
  }

  const drop = (stage: HiringStage) => {
    setHoverStage(null);
    if (dragging === null) return;
    move.mutate({ id: dragging, stageId: stage.id });
    setDragging(null);
  };

  return (
    <div className="space-y-3">
      {error ? (
        <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      ) : null}

      <div className="flex gap-3 overflow-x-auto pb-2">
        {stages.map((stage) => {
          const cards = byStage.get(stage.id) ?? [];

          return (
            <section
              key={stage.id}
              onDragOver={(event) => {
                event.preventDefault();
                setHoverStage(stage.id);
              }}
              onDragLeave={() => setHoverStage((current) => (current === stage.id ? null : current))}
              onDrop={() => drop(stage)}
              aria-label={`${stage.name}, ${cards.length} candidates`}
              className={`flex w-64 shrink-0 flex-col rounded-lg border p-2 transition ${
                hoverStage === stage.id
                  ? 'border-slate-900 bg-slate-50'
                  : 'border-slate-200 bg-slate-50/60'
              }`}
            >
              <header className="mb-2 flex items-center justify-between px-1">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
                  {stage.name}
                </span>
                <span className="rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-700 ring-1 ring-slate-200">
                  {cards.length}
                </span>
              </header>

              <div className="space-y-2">
                {cards.map((application) => (
                  <article
                    key={application.id}
                    draggable
                    onDragStart={() => setDragging(application.id)}
                    onDragEnd={() => setDragging(null)}
                    className={`rounded-md border border-slate-200 bg-white p-2 shadow-sm transition ${
                      dragging === application.id ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="flex items-start gap-1.5">
                      <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-grab text-slate-300" aria-hidden="true" />
                      <button
                        type="button"
                        onClick={() => onOpenCandidate?.(application)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="block truncate text-sm font-medium text-slate-950">
                          {application.candidate?.first_name} {application.candidate?.last_name ?? ''}
                        </span>
                        <span className="block truncate text-[11px] text-slate-500">
                          {application.candidate?.email}
                        </span>
                      </button>
                    </div>

                    {/*
                      * The keyboard path, and the one that actually gets used
                      * once somebody has more than a handful of candidates.
                      * Does exactly what a drop does.
                      */}
                    <label className="mt-1.5 block">
                      <span className="sr-only">
                        Move {application.candidate?.first_name} to another stage
                      </span>
                      <select
                        value={application.hiring_stage_id ?? ''}
                        onChange={(event) =>
                          move.mutate({ id: application.id, stageId: Number(event.target.value) })
                        }
                        className="w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-700"
                      >
                        {stages.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </article>
                ))}

                {cards.length === 0 ? (
                  <p className="rounded border border-dashed border-slate-200 px-2 py-4 text-center text-[11px] text-slate-500">
                    Nobody here
                  </p>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>

      {(applicationsQuery.data?.data ?? []).length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
          {/* Distinct from a stage being empty: nobody has applied at all. */}
          No live candidates for this role yet.
        </p>
      ) : null}
    </div>
  );
}
