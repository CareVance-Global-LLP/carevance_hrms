import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, FileText } from 'lucide-react';
import { recruitmentApi, userApi } from '@/services/api';
import type { JobOffer, OfferStatus } from '@/types';
import Button from '@/components/ui/Button';
import { FieldLabel, TextInput } from '@/components/ui/FormField';

/**
 * The offer on one candidacy, and the chain behind it.
 *
 * WHO WAS ASKED IS SHOWN, NOT JUST WHO ANSWERED. The approval chain is a record
 * of who was put in front of this decision, and "nobody ever asked finance" is
 * exactly the thing an audit looks for — so pending approvers are listed as
 * pending rather than omitted until they respond.
 *
 * THE SIGNING LINK IS SHOWN ONCE. It is the candidate's only credential and is
 * stored hashed, so nobody — including whoever generated it — can retrieve it
 * afterwards. The UI says so at the moment it matters rather than leaving
 * somebody to discover it.
 */
const STATUS_LABEL: Record<OfferStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Waiting for approval',
  approved: 'Approved, not sent',
  sent: 'With the candidate',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  expired: 'Expired',
};

export default function OfferPanel({ applicationId }: { applicationId: number }) {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState('');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);

  const offersQuery = useQuery({
    queryKey: ['offers', applicationId],
    queryFn: async () => (await recruitmentApi.offers()).data,
  });

  const approversQuery = useQuery({
    queryKey: ['offer-approver-options'],
    queryFn: async () => (await userApi.getAll({ simple: 1 })).data,
    enabled: true,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['offers', applicationId] });

  const run = <T,>(fn: () => Promise<T>) =>
    fn()
      .then(() => {
        setError('');
        invalidate();
      })
      .catch((err: any) => setError(err?.response?.data?.message || 'That did not work.'));

  const draft = useMutation({
    mutationFn: (payload: Record<string, unknown>) => recruitmentApi.draftOffer(payload),
    onSuccess: () => {
      setDrafting(false);
      setError('');
      invalidate();
    },
    onError: (err: any) => setError(err?.response?.data?.message || 'Could not draft that offer.'),
  });

  // The list endpoint is organization-wide, so it is narrowed here to this
  // candidacy rather than adding a filter the server does not need.
  const offers = (offersQuery.data?.data ?? []).filter(
    (offer: JobOffer) => offer.job_application_id === applicationId,
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Offer</h3>
        {offers.length === 0 ? (
          <Button className="ml-auto" variant="secondary" size="sm" onClick={() => setDrafting(true)}>
            Draft an offer
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      ) : null}

      {link ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2">
          <p className="text-[11px] font-medium text-emerald-900">
            {/* Said at the moment it matters. Stored hashed, so nobody can
                retrieve it afterwards. */}
            Send this to the candidate. It cannot be shown again.
          </p>
          <div className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded border border-emerald-200 bg-white px-2 py-1 text-[10px]">
              {link}
            </code>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                } catch {
                  // Clipboard access can be refused; the link is on screen and
                  // selectable either way.
                  setCopied(false);
                }
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      ) : null}

      {drafting ? (
        <form
          className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            draft.mutate({
              job_application_id: applicationId,
              designation: String(form.get('designation')),
              annual_ctc: Number(form.get('annual_ctc')),
              proposed_joining_date: String(form.get('proposed_joining_date') || '') || null,
            });
          }}
        >
          <div>
            <FieldLabel htmlFor={`${fieldId}-title`}>Designation</FieldLabel>
            <TextInput id={`${fieldId}-title`} name="designation" required />
          </div>
          <div>
            <FieldLabel htmlFor={`${fieldId}-ctc`}>Annual CTC</FieldLabel>
            <TextInput id={`${fieldId}-ctc`} name="annual_ctc" type="number" min="1" required />
          </div>
          <div>
            <FieldLabel htmlFor={`${fieldId}-join`}>Proposed start</FieldLabel>
            <TextInput id={`${fieldId}-join`} name="proposed_joining_date" type="date" />
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" size="sm" disabled={draft.isPending}>
              {draft.isPending ? 'Saving…' : 'Save draft'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDrafting(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {offers.map((offer: JobOffer) => (
        <div key={offer.id} className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <FileText className="h-3.5 w-3.5 text-slate-500" />
            <span className="font-medium text-slate-950">{offer.designation}</span>
            <span className="tabular-nums text-slate-700">
              ₹ {new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number(offer.annual_ctc))}
            </span>
            <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
              {STATUS_LABEL[offer.status]}
            </span>
          </div>

          {offer.approvals && offer.approvals.length > 0 ? (
            <ul className="mt-2 space-y-0.5">
              {offer.approvals.map((approval) => (
                <li key={approval.id} className="text-[11px]">
                  <span className="text-slate-900">{approval.approver?.name ?? 'Approver'}</span>
                  {' · '}
                  {/* Pending approvers are listed, not omitted. "Nobody ever
                      asked finance" is what an audit looks for. */}
                  <span
                    className={
                      approval.status === 'approved'
                        ? 'text-emerald-700'
                        : approval.status === 'rejected'
                          ? 'text-red-700'
                          : 'text-slate-500'
                    }
                  >
                    {approval.status}
                  </span>
                  {approval.note ? <span className="block text-slate-600">{approval.note}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}

          {offer.decline_reason ? (
            <p className="mt-1 text-[11px] text-slate-600">
              <span className="font-medium">Reason:</span> {offer.decline_reason}
            </p>
          ) : null}

          <div className="mt-2 flex flex-wrap gap-2">
            {offer.status === 'draft' ? (
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const ids = new FormData(event.currentTarget).getAll('approver_ids').map(Number).filter(Boolean);
                  run(() => recruitmentApi.submitOffer(offer.id, ids));
                }}
              >
                <div>
                  <FieldLabel htmlFor={`${fieldId}-approvers-${offer.id}`}>Approvers</FieldLabel>
                  <select
                    id={`${fieldId}-approvers-${offer.id}`}
                    name="approver_ids"
                    multiple
                    size={3}
                    className="rounded-lg border border-slate-300 p-1 text-[11px]"
                  >
                    {(approversQuery.data ?? []).map((person: any) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-slate-500">
                    {/* The server refuses an empty chain, and the reason is
                        worth saying rather than discovering. */}
                    At least one. An offer with nobody to approve it cannot be sent.
                  </p>
                </div>
                <Button type="submit" size="sm">Send for approval</Button>
              </form>
            ) : null}

            {offer.status === 'pending_approval' ? (
              <>
                <Button size="sm" onClick={() => run(() => recruitmentApi.decideOffer(offer.id, true))}>
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const note = window.prompt('Why are you refusing it?');
                    if (note) run(() => recruitmentApi.decideOffer(offer.id, false, note));
                  }}
                >
                  Refuse
                </Button>
              </>
            ) : null}

            {offer.status === 'approved' ? (
              <Button size="sm" onClick={() => run(() => recruitmentApi.sendOffer(offer.id))}>
                Send to candidate
              </Button>
            ) : null}

            {offer.status === 'sent' ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  try {
                    const response = await recruitmentApi.issueSigningLink(offer.id);
                    setLink(response.data.data.url);
                    setCopied(false);
                    setError('');
                  } catch (err: any) {
                    setError(err?.response?.data?.message || 'Could not create a signing link.');
                  }
                }}
              >
                Get signing link
              </Button>
            ) : null}

            {['draft', 'pending_approval', 'approved', 'sent'].includes(offer.status) ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const reason = window.prompt('Why are you withdrawing it?');
                  if (reason) run(() => recruitmentApi.withdrawOffer(offer.id, reason));
                }}
              >
                Withdraw
              </Button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
