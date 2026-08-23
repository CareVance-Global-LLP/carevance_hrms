import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Plus, UserPlus } from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import Button from '@/components/ui/Button';
import { FieldLabel, SelectInput, TextInput } from '@/components/ui/FormField';
import { PageLoadingState } from '@/components/ui/PageState';
import { recruitmentApi } from '@/services/api';
import type { JobApplication, JobOpening } from '@/types';
import PipelineBoard from '@/features/recruitment/PipelineBoard';
import CandidateDrawer from '@/features/recruitment/CandidateDrawer';

/**
 * Hiring: the openings, and the pipeline behind whichever one is selected.
 *
 * One screen rather than a list page and a detail page, because a recruiter's
 * whole job is moving between "which roles are open" and "who is in this one",
 * and a full navigation between those two loses the board's scroll position
 * every time.
 */
const STATUS_LABEL: Record<JobOpening['status'], string> = {
  draft: 'Draft',
  open: 'Open',
  on_hold: 'On hold',
  closed: 'Closed',
  filled: 'Filled',
};

export default function RecruitmentPage() {
  const queryClient = useQueryClient();
  const fieldId = useId();

  const [selected, setSelected] = useState<number | null>(null);
  const [drawerApplication, setDrawerApplication] = useState<JobApplication | null>(null);
  const [creating, setCreating] = useState(false);
  const [addingCandidate, setAddingCandidate] = useState(false);
  const [error, setError] = useState('');

  const openingsQuery = useQuery({
    queryKey: ['openings'],
    queryFn: async () => (await recruitmentApi.openings()).data,
  });

  const openings = openingsQuery.data?.data ?? [];
  const activeId = selected ?? openings[0]?.id ?? null;

  const detailQuery = useQuery({
    queryKey: ['opening', activeId],
    queryFn: async () => (await recruitmentApi.opening(activeId!)).data,
    enabled: activeId !== null,
  });

  const createOpening = useMutation({
    mutationFn: (payload: Partial<JobOpening>) => recruitmentApi.createOpening(payload),
    onSuccess: (response) => {
      setCreating(false);
      setError('');
      setSelected(response.data.data.id);
      queryClient.invalidateQueries({ queryKey: ['openings'] });
    },
    onError: (err: any) => setError(err?.response?.data?.message || 'Could not create that opening.'),
  });

  const addCandidate = useMutation({
    mutationFn: async (payload: { first_name: string; last_name: string; email: string }) => {
      const candidate = await recruitmentApi.createCandidate(payload);
      // Created and applied in one step. A candidate with no candidacy is a
      // row nobody looks at again, and two separate actions is how that
      // happens.
      return recruitmentApi.apply(activeId!, candidate.data.data.id);
    },
    onSuccess: () => {
      setAddingCandidate(false);
      setError('');
      queryClient.invalidateQueries({ queryKey: ['pipeline', activeId] });
      queryClient.invalidateQueries({ queryKey: ['opening', activeId] });
    },
    onError: (err: any) => setError(err?.response?.data?.message || 'Could not add that candidate.'),
  });

  if (openingsQuery.isLoading) {
    return <PageLoadingState label="Loading hiring..." />;
  }

  return (
    <div className="space-y-4 p-4">
      <PageHeader
        title="Hiring"
        description="Open roles, the people in the running for them, and where each of them has got to."
        actions={
          <Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            New opening
          </Button>
        }
      />

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {creating ? (
        <form
          className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            createOpening.mutate({
              title: String(form.get('title')),
              openings_count: Number(form.get('openings_count')) || 1,
              // Created open rather than draft: a requisition somebody just
              // typed a title into is one they intend to fill, and a draft that
              // silently accepts no applications is a confusing first
              // experience.
              status: 'open',
            });
          }}
        >
          <div className="sm:col-span-2">
            <FieldLabel htmlFor={`${fieldId}-title`}>Role</FieldLabel>
            <TextInput id={`${fieldId}-title`} name="title" placeholder="Backend Engineer" required />
          </div>
          <div>
            <FieldLabel htmlFor={`${fieldId}-count`}>How many</FieldLabel>
            <TextInput id={`${fieldId}-count`} name="openings_count" type="number" min="1" defaultValue="1" />
          </div>
          <div className="flex gap-2 sm:col-span-3">
            <Button type="submit" disabled={createOpening.isPending}>
              {createOpening.isPending ? 'Creating...' : 'Create opening'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {openings.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          No openings yet. Create one to start a pipeline.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {openings.map((opening) => (
              <button
                key={opening.id}
                type="button"
                onClick={() => setSelected(opening.id)}
                aria-pressed={opening.id === activeId}
                className={`rounded-lg border px-3 py-2 text-left transition ${
                  opening.id === activeId
                    ? 'border-slate-900 bg-white shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Briefcase className="h-3.5 w-3.5 text-slate-500" />
                  <span className="text-sm font-medium text-slate-950">{opening.title}</span>
                  <span className="font-mono text-[10px] text-slate-500">{opening.code}</span>
                </span>
                <span className="mt-0.5 block text-[11px] text-slate-500">
                  {STATUS_LABEL[opening.status]} · {opening.active_applications_count ?? 0} in play
                  {(opening.hired_count ?? 0) > 0 ? ` · ${opening.hired_count} hired` : ''}
                </span>
              </button>
            ))}
          </div>

          {activeId !== null ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                {detailQuery.data ? (
                  <p className="text-xs text-slate-600">
                    {/* The number a hiring manager actually asks for. */}
                    <span className="font-semibold tabular-nums text-slate-900">
                      {detailQuery.data.remaining_openings}
                    </span>{' '}
                    still to hire
                  </p>
                ) : null}

                <Button
                  className="ml-auto"
                  variant="secondary"
                  size="sm"
                  iconLeft={<UserPlus className="h-3.5 w-3.5" />}
                  onClick={() => setAddingCandidate(true)}
                >
                  Add candidate
                </Button>
              </div>

              {addingCandidate ? (
                <form
                  className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    addCandidate.mutate({
                      first_name: String(form.get('first_name')),
                      last_name: String(form.get('last_name') ?? ''),
                      email: String(form.get('email')),
                    });
                  }}
                >
                  <div>
                    <FieldLabel htmlFor={`${fieldId}-first`}>First name</FieldLabel>
                    <TextInput id={`${fieldId}-first`} name="first_name" required />
                  </div>
                  <div>
                    <FieldLabel htmlFor={`${fieldId}-last`}>Last name</FieldLabel>
                    <TextInput id={`${fieldId}-last`} name="last_name" />
                  </div>
                  <div className="sm:col-span-2">
                    <FieldLabel htmlFor={`${fieldId}-email`}>Email</FieldLabel>
                    <TextInput id={`${fieldId}-email`} name="email" type="email" required />
                  </div>
                  <div className="flex gap-2 sm:col-span-4">
                    <Button type="submit" disabled={addCandidate.isPending}>
                      {addCandidate.isPending ? 'Adding...' : 'Add to pipeline'}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setAddingCandidate(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : null}

              <PipelineBoard jobOpeningId={activeId} onOpenCandidate={setDrawerApplication} />
            </div>
          ) : null}
        </>
      )}

      <CandidateDrawer application={drawerApplication} onClose={() => setDrawerApplication(null)} />
    </div>
  );
}
