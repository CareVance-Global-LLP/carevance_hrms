import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import Button from '@/components/ui/Button';
import { FieldLabel, TextareaInput } from '@/components/ui/FormField';
import { PageLoadingState } from '@/components/ui/PageState';
import { bgvApi } from '@/services/api';
import type { BackgroundCheck, BgvItem, BgvItemStatus } from '@/types';

/**
 * Background verification, as a worklist.
 *
 * A DISCREPANCY IS NOT A REJECTION, and the screen never offers one. A name
 * spelled differently on a certificate and a fabricated employer are both
 * discrepancies; the product's job is to put the comparison in front of a
 * person, not to decide. There is no "reject candidate" button here on purpose.
 *
 * A DISCREPANCY NEEDS BOTH SIDES. The form asks for what was claimed and what
 * was found, and will not submit one without the other — an accusation with no
 * comparison behind it is one the person cannot answer.
 *
 * ADVERSE ACTION IS SURFACED, NOT LEFT TO MEMORY. Forgetting to tell somebody
 * about a finding that counts against them is the failure that matters here, so
 * the check says so in words until it has been done.
 */
const STATUS_LABEL: Record<BgvItemStatus, string> = {
  pending: 'Not started',
  in_progress: 'In progress',
  clear: 'Clear',
  discrepancy: 'Discrepancy',
  insufficient: 'Could not verify',
  skipped: 'Skipped',
};

const TYPE_LABEL: Record<string, string> = {
  identity: 'Identity',
  address: 'Address',
  education: 'Education',
  employment: 'Employment',
  criminal: 'Criminal record',
  reference: 'Reference',
  credit: 'Credit',
};

export default function BackgroundChecksPage() {
  const [selected, setSelected] = useState<number | null>(null);

  const listQuery = useQuery({
    queryKey: ['bgv-checks'],
    queryFn: async () => (await bgvApi.list()).data,
  });

  if (listQuery.isLoading) {
    return <PageLoadingState label="Loading checks..." />;
  }

  const checks = listQuery.data?.data ?? [];

  return (
    <div className="space-y-4 p-4">
      <PageHeader
        title="Background verification"
        description="What was checked, what came back, and what still needs a person to look at it."
      />

      {checks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          {/* Consent first, always — the server refuses a check without it. */}
          No checks yet. A verification starts from a candidate's recorded consent.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
          <ul className="space-y-2">
            {checks.map((check) => (
              <li key={check.id}>
                <button
                  type="button"
                  onClick={() => setSelected(check.id)}
                  aria-pressed={selected === check.id}
                  className={`w-full rounded-lg border p-2 text-left transition ${
                    selected === check.id ? 'border-slate-900 bg-white' : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm">
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-950">
                      {check.candidate
                        ? `${check.candidate.first_name} ${check.candidate.last_name ?? ''}`.trim()
                        : check.subject?.name ?? 'Somebody'}
                    </span>
                    <OutcomeBadge check={check} />
                  </span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">
                    {(check.items ?? []).length} checks · {check.status.replace('_', ' ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div>
            {selected === null ? (
              <p className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
                Choose somebody to see what was checked.
              </p>
            ) : (
              <CheckDetail id={selected} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Never a pass/fail badge. */
function OutcomeBadge({ check }: { check: BackgroundCheck }) {
  if (!check.outcome) {
    return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">Running</span>;
  }

  const tone =
    check.outcome === 'clear'
      ? 'bg-emerald-50 text-emerald-700'
      : check.outcome === 'discrepancy'
        ? 'bg-amber-50 text-amber-800'
        : 'bg-slate-100 text-slate-600';

  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>
      {check.outcome === 'insufficient' ? 'Could not verify' : check.outcome}
    </span>
  );
}

function CheckDetail({ id }: { id: number }) {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const [error, setError] = useState('');
  const [recording, setRecording] = useState<number | null>(null);

  const query = useQuery({
    queryKey: ['bgv-check', id],
    queryFn: async () => (await bgvApi.show(id)).data,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['bgv-check', id] });
    queryClient.invalidateQueries({ queryKey: ['bgv-checks'] });
  };

  const record = useMutation({
    mutationFn: (payload: { itemId: number; status: BgvItemStatus; claimed?: string; verified?: string; notes?: string }) =>
      bgvApi.recordItem(payload.itemId, payload),
    onSuccess: () => {
      setRecording(null);
      setError('');
      invalidate();
    },
    onError: (err: any) => setError(err?.response?.data?.message || 'Could not record that.'),
  });

  const notify = useMutation({
    mutationFn: () => bgvApi.notify(id),
    onSuccess: () => {
      setError('');
      invalidate();
    },
    onError: (err: any) => setError(err?.response?.data?.message || 'Could not record that.'),
  });

  const respond = useMutation({
    mutationFn: (response: string) => bgvApi.recordResponse(id, response),
    onSuccess: () => {
      setError('');
      invalidate();
    },
    onError: (err: any) => setError(err?.response?.data?.message || 'Could not record that.'),
  });

  if (query.isLoading) {
    return <PageLoadingState label="Loading..." />;
  }

  const check = query.data?.data;
  const needsNotice = query.data?.needs_adverse_action_notice ?? false;

  if (!check) return null;

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {check.consent ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
          <p className="font-medium text-slate-900">
            Consent given by {check.consent.consented_name}
            {check.consent.withdrawn_at ? ' — since withdrawn' : ''}
          </p>
          <p className="mt-0.5 text-slate-600">
            {/* What they agreed to, verbatim. Never widened after the fact. */}
            Covers: {check.consent.scope.map((type) => TYPE_LABEL[type] ?? type).join(', ')}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {new Date(check.consent.consented_at).toLocaleString()}
            {check.consent.ip_address ? ` · from ${check.consent.ip_address}` : ''}
          </p>
        </div>
      ) : null}

      {needsNotice ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="flex items-start gap-2 text-sm font-medium text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            This person has not been told about the finding
          </p>
          <p className="mt-1 text-xs text-amber-800">
            {/* Forgetting is the failure that matters, so it is said in words
                until it has been done. */}
            A finding that could count against somebody has to reach them, and they are entitled to reply before it is
            acted on.
          </p>
          <Button className="mt-2" size="sm" onClick={() => notify.mutate()} disabled={notify.isPending}>
            {notify.isPending ? 'Recording…' : 'I have told them'}
          </Button>
        </div>
      ) : null}

      {check.notified_at && !check.responded_at ? (
        <form
          className="rounded-lg border border-slate-200 bg-white p-3"
          onSubmit={(event) => {
            event.preventDefault();
            const value = String(new FormData(event.currentTarget).get('response') || '');
            if (value.trim()) respond.mutate(value);
          }}
        >
          <FieldLabel htmlFor={`${fieldId}-response`}>What did they say?</FieldLabel>
          <TextareaInput id={`${fieldId}-response`} name="response" rows={2} />
          <Button className="mt-2" size="sm" type="submit" disabled={respond.isPending}>
            Record their reply
          </Button>
        </form>
      ) : null}

      {check.candidate_response ? (
        <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
          <span className="font-medium">They replied:</span> {check.candidate_response}
        </p>
      ) : null}

      <ul className="space-y-2">
        {(check.items ?? []).map((item) => (
          <li key={item.id} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-slate-950">{TYPE_LABEL[item.type] ?? item.type}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  item.status === 'clear'
                    ? 'bg-emerald-50 text-emerald-700'
                    : item.status === 'discrepancy'
                      ? 'bg-amber-50 text-amber-800'
                      : 'bg-slate-100 text-slate-600'
                }`}
              >
                {STATUS_LABEL[item.status]}
              </span>
              {item.status === 'pending' || item.status === 'in_progress' ? (
                <Button
                  className="ml-auto"
                  variant="secondary"
                  size="sm"
                  onClick={() => setRecording(recording === item.id ? null : item.id)}
                >
                  Record result
                </Button>
              ) : null}
            </div>

            {item.claimed || item.verified ? (
              <dl className="mt-1.5 grid gap-1 text-xs sm:grid-cols-2">
                {/* Side by side, because "you said 2019, the university says
                    2018" is the sentence a discrepancy has to produce. */}
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-slate-500">They said</dt>
                  <dd className="text-slate-900">{item.claimed || '—'}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-slate-500">We found</dt>
                  <dd className="text-slate-900">{item.verified || '—'}</dd>
                </div>
              </dl>
            ) : null}

            {item.notes ? <p className="mt-1 text-xs text-slate-600">{item.notes}</p> : null}

            {recording === item.id ? <ResultForm item={item} onSubmit={record.mutate} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Recording one result.
 *
 * The claimed/found fields become required the moment somebody picks
 * "discrepancy", mirroring the server. Asking for them at the point of the
 * finding is the only time anybody actually has them to hand.
 */
function ResultForm({
  item,
  onSubmit,
}: {
  item: BgvItem;
  onSubmit: (payload: { itemId: number; status: BgvItemStatus; claimed?: string; verified?: string; notes?: string }) => void;
}) {
  const fieldId = useId();
  const [status, setStatus] = useState<BgvItemStatus>('clear');

  const needsBothSides = status === 'discrepancy';

  return (
    <form
      className="mt-2 space-y-2 border-t border-slate-100 pt-2"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onSubmit({
          itemId: item.id,
          status,
          claimed: String(form.get('claimed') || '') || undefined,
          verified: String(form.get('verified') || '') || undefined,
          notes: String(form.get('notes') || '') || undefined,
        });
      }}
    >
      <div>
        <FieldLabel htmlFor={`${fieldId}-status`}>Result</FieldLabel>
        <select
          id={`${fieldId}-status`}
          value={status}
          onChange={(event) => setStatus(event.target.value as BgvItemStatus)}
          className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
        >
          <option value="clear">Clear</option>
          <option value="discrepancy">Discrepancy</option>
          <option value="insufficient">Could not verify</option>
          <option value="skipped">Skipped</option>
        </select>
        {needsBothSides ? (
          <p className="mt-1 text-[11px] text-slate-500">
            {/* Stated, so it does not arrive as a refusal. */}
            A discrepancy needs both sides. The person it is about is entitled to see the comparison.
          </p>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor={`${fieldId}-claimed`}>They said</FieldLabel>
          <TextareaInput id={`${fieldId}-claimed`} name="claimed" rows={2} required={needsBothSides} />
        </div>
        <div>
          <FieldLabel htmlFor={`${fieldId}-verified`}>We found</FieldLabel>
          <TextareaInput id={`${fieldId}-verified`} name="verified" rows={2} required={needsBothSides} />
        </div>
      </div>

      <div>
        <FieldLabel htmlFor={`${fieldId}-notes`}>Notes</FieldLabel>
        <TextareaInput id={`${fieldId}-notes`} name="notes" rows={2} />
      </div>

      <Button type="submit" size="sm">Save result</Button>
    </form>
  );
}
