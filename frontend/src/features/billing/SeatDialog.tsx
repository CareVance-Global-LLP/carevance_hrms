import { useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import { FieldLabel } from '@/components/ui/FormField';
import { billingApi } from '@/services/api';
import { formatMoney } from './renewalState';

interface SeatDialogProps {
  mode: 'add' | 'reduce';
  usedSeats: number;
  maxSeats: number;
  /** Server-computed floor. Never below the people already in the workspace. */
  minAllowed: number;
  pricePerSeat: number;
  billingCycle: 'monthly' | 'yearly';
  planLabel: string;
  onClose: () => void;
  onAdded: () => void;
  onReduced: () => void;
}

/**
 * Both seat changes in one dialog, working in absolute totals.
 *
 * The old Add Seats modal computed its total from a cap held in auth context,
 * which could be stale — an admin adding one seat to a workspace of 86 people
 * asked the server for a total of 6. The floor here comes from the API rather
 * than from a hardcoded 10/50 that could drift from the server's own rule.
 */
export default function SeatDialog({
  mode,
  usedSeats,
  maxSeats,
  minAllowed,
  pricePerSeat,
  billingCycle,
  planLabel,
  onClose,
  onAdded,
  onReduced,
}: SeatDialogProps) {
  const isAdd = mode === 'add';

  // Opening "add" on an over-cap workspace starts at the number that fixes it.
  const initialTotal = isAdd ? Math.max(maxSeats + 1, usedSeats) : Math.max(minAllowed, maxSeats - 1);
  const [total, setTotal] = useState(initialTotal);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');

  const months = billingCycle === 'yearly' ? 12 : 1;
  const delta = total - maxSeats;
  const cost = Math.max(0, delta) * pricePerSeat * months;

  const floor = isAdd ? Math.max(maxSeats + 1, usedSeats) : minAllowed;
  const ceiling = isAdd ? 9999 : Math.max(minAllowed, maxSeats - 1);
  const isValid = isAdd ? total > maxSeats && total >= usedSeats : total >= minAllowed && total < maxSeats;

  const submit = async () => {
    setIsProcessing(true);
    setError('');
    try {
      if (isAdd) {
        await billingApi.addSeats({ seats: total, billing_cycle: billingCycle });
        onAdded();
      } else {
        await billingApi.reduceSeats(total);
        onReduced();
      }
    } catch (e: any) {
      setError(e?.response?.data?.message || `Failed to ${isAdd ? 'add' : 'reduce'} seats. Please try again.`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isAdd ? 'Add seats' : 'Reduce seats'}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-surface-raised p-6 shadow-modal"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-950">
              {isAdd ? 'Add seats' : 'Reduce seats'}
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              {isAdd
                ? `Raise the cap on your ${planLabel} plan. You are charged for the rest of this billing period.`
                : 'Takes effect at the next renewal. No refund is issued for the seats you give up.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-slate-600 transition hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <dl className="mt-5 space-y-2 rounded-xl border border-slate-200 bg-surface-sunken p-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-600">People in the workspace</dt>
            <dd className="font-semibold tabular-nums text-slate-900">{usedSeats}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-600">Seats today</dt>
            <dd className="font-semibold tabular-nums text-slate-900">{maxSeats}</dd>
          </div>
        </dl>

        <div className="mt-5">
          <FieldLabel>New seat total</FieldLabel>
          <div className="flex items-center gap-4">
            <button
              type="button"
              aria-label="Decrease"
              disabled={total <= floor}
              onClick={() => setTotal((current) => Math.max(floor, current - 1))}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 text-slate-600 transition hover:border-blue-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Minus className="h-4 w-4" />
            </button>
            <input
              type="number"
              value={total}
              min={floor}
              max={ceiling}
              aria-label="New seat total"
              onChange={(event) => setTotal(Number(event.target.value) || 0)}
              className="min-h-11 w-24 rounded-lg border border-border-strong bg-surface-card text-center text-xl font-semibold tabular-nums text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-300/30"
            />
            <button
              type="button"
              aria-label="Increase"
              disabled={total >= ceiling}
              onClick={() => setTotal((current) => Math.min(ceiling, current + 1))}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 text-slate-600 transition hover:border-blue-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-600">
            {isAdd
              ? `At least ${floor} — you cannot have fewer seats than people.`
              : `At least ${minAllowed}${minAllowed === usedSeats ? ', because that is how many people are in the workspace' : ' on this plan'}.`}
          </p>
        </div>

        {isAdd ? (
          <dl className="mt-5 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-600">Seats added</dt>
              <dd className="font-semibold tabular-nums text-slate-900">{Math.max(0, delta)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-600">Price per seat</dt>
              <dd className="font-semibold tabular-nums text-slate-900">₹{pricePerSeat} / month</dd>
            </div>
            <div className="mt-3 flex items-center justify-between rounded-xl bg-surface-inverse px-4 py-3 text-on-inverse">
              <span className="text-sm font-semibold">Total due now</span>
              <span className="text-lg font-bold tabular-nums">{formatMoney(cost)}</span>
            </div>
            <p className="text-xs text-slate-600">
              {Math.max(0, delta)} seat{delta === 1 ? '' : 's'} × ₹{pricePerSeat} × {months} month{months === 1 ? '' : 's'}
            </p>
          </dl>
        ) : (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs leading-5 text-amber-800">
              <span className="font-semibold">No refund.</span> The reduction applies at your next renewal; you keep
              all {maxSeats} seats until then.
            </p>
          </div>
        )}

        {error ? <p className="mt-4 text-center text-xs text-red-600">{error}</p> : null}

        <div className="mt-6 flex gap-3">
          <Button variant="secondary" className="flex-1 justify-center" onClick={onClose} disabled={isProcessing}>
            Cancel
          </Button>
          <Button
            className="flex-1 justify-center"
            onClick={submit}
            disabled={!isValid || isProcessing}
            loading={isProcessing}
          >
            {isAdd ? 'Proceed to payment' : 'Schedule reduction'}
          </Button>
        </div>
      </div>
    </div>
  );
}
