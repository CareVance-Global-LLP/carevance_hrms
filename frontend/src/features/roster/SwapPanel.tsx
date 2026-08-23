import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight } from 'lucide-react';
import { rosterApi } from '@/services/api';
import type { ShiftSwapRequest, SwapStatus } from '@/types';
import Button from '@/components/ui/Button';

/**
 * Swap requests: mine, and the ones waiting on me.
 *
 * A SWAP NEEDS THREE PARTIES AND THE UI SAYS SO. The counterparty agrees and a
 * manager approves — one person cannot give away a shift, and two people cannot
 * rewrite the site's cover between them. The status labels name which of the
 * two a request is waiting on, because "pending" alone leaves everybody
 * assuming somebody else is holding it up.
 *
 * NOTHING HAS MOVED YET. A pending swap changes no rota, and the panel says so
 * rather than showing a trade that has not happened.
 */
const STATUS_LABEL: Record<SwapStatus, string> = {
  pending_counterparty: 'Waiting on the other person',
  pending_approval: 'Waiting on a manager',
  approved: 'Swapped',
  declined: 'Declined',
  cancelled: 'Withdrawn',
};

export default function SwapPanel({ canManage, currentUserId }: { canManage: boolean; currentUserId?: number }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');

  const query = useQuery({
    queryKey: ['roster-swaps'],
    queryFn: async () => (await rosterApi.swaps()).data,
  });

  const respond = useMutation({
    mutationFn: (payload: { id: number; action: 'accept' | 'decline' | 'cancel' | 'approve'; reason?: string }) =>
      rosterApi.respondToSwap(payload.id, payload.action, payload.reason),
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['roster-swaps'] });
      // The rota only changes on approval, so it is refetched then too.
      queryClient.invalidateQueries({ queryKey: ['roster'] });
    },
    onError: (err: any) => setError(err?.response?.data?.message || 'Could not do that.'),
  });

  const swaps = query.data?.data ?? [];

  if (query.isLoading) {
    return <p className="py-3 text-center text-xs text-slate-500">Loading swaps…</p>;
  }

  return (
    <div className="space-y-2">
      <h2 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
        <ArrowLeftRight className="h-3.5 w-3.5" /> Shift swaps
      </h2>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      ) : null}

      {swaps.length === 0 ? (
        <p className="rounded border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500">
          No swap requests.
        </p>
      ) : (
        <ul className="space-y-2">
          {swaps.map((swap: ShiftSwapRequest) => {
            const waitingOnMe = swap.status === 'pending_counterparty' && swap.requested_with === currentUserId;
            const mine = swap.requested_by === currentUserId;

            return (
              <li key={swap.id} className="rounded border border-slate-200 bg-white p-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-950">
                    {swap.requester?.name ?? 'Someone'} ↔ {swap.counterparty?.name ?? 'someone'}
                  </span>
                  {swap.requester_day ? (
                    <span className="text-slate-600">
                      {swap.requester_day.roster_date} ↔ {swap.counterparty_day?.roster_date}
                    </span>
                  ) : null}
                  <span
                    className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      swap.status === 'approved'
                        ? 'bg-emerald-50 text-emerald-700'
                        : swap.status === 'declined' || swap.status === 'cancelled'
                          ? 'bg-slate-100 text-slate-600'
                          : 'bg-amber-50 text-amber-800'
                    }`}
                  >
                    {/* Names which of the three parties is holding it up. */}
                    {STATUS_LABEL[swap.status]}
                  </span>
                </div>

                {swap.reason ? <p className="mt-0.5 text-slate-600">{swap.reason}</p> : null}
                {swap.decline_reason ? (
                  <p className="mt-0.5 text-slate-600">
                    <span className="font-medium">Reason:</span> {swap.decline_reason}
                  </p>
                ) : null}

                {swap.status === 'pending_counterparty' || swap.status === 'pending_approval' ? (
                  <p className="mt-0.5 text-[10px] text-slate-500">
                    {/* Said plainly: a pending swap has changed no rota. */}
                    Nothing has changed on the rota yet.
                  </p>
                ) : null}

                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {waitingOnMe ? (
                    <>
                      <Button size="sm" onClick={() => respond.mutate({ id: swap.id, action: 'accept' })}>
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          const reason = window.prompt('Why not?');
                          if (reason) respond.mutate({ id: swap.id, action: 'decline', reason });
                        }}
                      >
                        Decline
                      </Button>
                    </>
                  ) : null}

                  {canManage && swap.status === 'pending_approval' ? (
                    <>
                      <Button size="sm" onClick={() => respond.mutate({ id: swap.id, action: 'approve' })}>
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          const reason = window.prompt('Why not?');
                          if (reason) respond.mutate({ id: swap.id, action: 'decline', reason });
                        }}
                      >
                        Refuse
                      </Button>
                    </>
                  ) : null}

                  {mine && (swap.status === 'pending_counterparty' || swap.status === 'pending_approval') ? (
                    <Button size="sm" variant="ghost" onClick={() => respond.mutate({ id: swap.id, action: 'cancel' })}>
                      Withdraw
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
