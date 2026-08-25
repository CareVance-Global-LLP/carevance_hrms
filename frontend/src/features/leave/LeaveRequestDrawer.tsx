import { useEffect, useMemo, useState } from 'react';
import Button from '@/components/ui/Button';
import SlideOver from '@/features/employees/SlideOver';
import {
  isWorkingDay,
  toISODate,
  workingDaysBetween,
  type LeaveCategoryBalance,
} from './leaveUtils';

export interface LeaveRequestPayload {
  start_date: string;
  end_date: string;
  leave_type: 'full_day' | 'half_day';
  leave_category: string;
  reason?: string;
}

export interface LeaveRequestDrawerProps {
  open: boolean;
  onClose: () => void;
  categories: LeaveCategoryBalance[];
  holidayDates: ReadonlySet<string>;
  submitting: boolean;
  onSubmit: (payload: LeaveRequestPayload) => Promise<boolean>;
}

/**
 * The request form, priced before it is sent.
 *
 * The old form collected dates and let the server break the news afterwards.
 * This one counts the working days (weekends and known holidays excluded),
 * shows the balance before → after, and refuses an overdraft with a concrete
 * suggestion instead of a rejection later. The server's `consumed_breakdown`
 * remains authoritative — this is the estimate the approved amount has always
 * matched.
 */
export default function LeaveRequestDrawer({
  open,
  onClose,
  categories,
  holidayDates,
  submitting,
  onSubmit,
}: LeaveRequestDrawerProps) {
  const today = toISODate(new Date());
  const [leaveType, setLeaveType] = useState<'full_day' | 'half_day'>('full_day');
  const [category, setCategory] = useState('');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState('');

  // Fresh form per opening; a drawer that remembers last month's dates invites
  // accidental resubmission of them.
  useEffect(() => {
    if (!open) return;
    setLeaveType('full_day');
    setCategory(categories[0]?.code ? String(categories[0].code).toLowerCase() : 'unpaid');
    setFrom(today);
    setTo(today);
    setReason('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const effectiveTo = leaveType === 'half_day' ? from : to;

  const cost = useMemo(() => {
    if (leaveType === 'half_day') {
      return isWorkingDay(from, holidayDates)
        ? { days: 0.5, skippedWeekend: 0, skippedHoliday: 0 }
        : { days: 0, skippedWeekend: 1, skippedHoliday: 0 };
    }
    return workingDaysBetween(from, effectiveTo, holidayDates);
  }, [leaveType, from, effectiveTo, holidayDates]);

  const selected = categories.find(
    (candidate) => String(candidate.code || '').toLowerCase() === category
  );
  const remaining = category === 'unpaid' ? Infinity : Number(selected?.remaining ?? 0);
  const after = remaining - cost.days;
  const overdraft = category !== 'unpaid' && after < 0;
  const reasonRequired = category !== 'birthday';
  const reasonMissing = reasonRequired && !reason.trim();
  const skippedTotal = cost.skippedWeekend + cost.skippedHoliday;

  const blocked = submitting || cost.days === 0 || overdraft || reasonMissing;

  const handleSubmit = async () => {
    const ok = await onSubmit({
      start_date: from,
      end_date: effectiveTo,
      leave_type: leaveType,
      leave_category: category,
      reason: reason.trim() || undefined,
    });
    if (ok) onClose();
  };

  return (
    <SlideOver
      open={open}
      title="Request leave"
      subtitle="Priced before you send it"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void handleSubmit()} loading={submitting} disabled={blocked}>
            Submit request
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-xs font-bold text-slate-700">Day type</p>
          <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Day type">
            {([
              { key: 'full_day', label: 'Full day' },
              { key: 'half_day', label: 'Half day' },
            ] as const).map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={leaveType === option.key}
                onClick={() => setLeaveType(option.key)}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  leaveType === option.key
                    ? 'bg-white text-slate-950 shadow-card'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {leaveType === 'half_day' ? (
            <p className="mt-1.5 text-[11px] text-warning-800">
              Half day reduces that day's target to half of normal working hours.
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="leave-category" className="mb-1.5 block text-xs font-bold text-slate-700">
            Category
          </label>
          <select
            id="leave-category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:outline-none"
          >
            {categories.map((candidate) => (
              <option key={candidate.code} value={String(candidate.code || '').toLowerCase()}>
                {candidate.name} — {Number(candidate.remaining || 0).toFixed(1)} remaining
              </option>
            ))}
            <option value="unpaid">Unpaid leave</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="leave-from" className="mb-1.5 block text-xs font-bold text-slate-700">
              {leaveType === 'half_day' ? 'Date' : 'From'}
            </label>
            <input
              id="leave-from"
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                if (leaveType === 'half_day' || event.target.value > to) setTo(event.target.value);
              }}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="leave-to" className="mb-1.5 block text-xs font-bold text-slate-700">
              To
            </label>
            <input
              id="leave-to"
              type="date"
              value={effectiveTo}
              min={from}
              disabled={leaveType === 'half_day'}
              onChange={(event) => setTo(event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500"
            />
          </div>
        </div>

        <div>
          <label htmlFor="leave-reason" className="mb-1.5 block text-xs font-bold text-slate-700">
            Reason{reasonRequired ? '' : ' (optional)'}
          </label>
          <textarea
            id="leave-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder="Why are you taking leave?"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-500 focus:border-blue-400 focus:outline-none"
          />
        </div>

        {/* The price. */}
        <div className={`overflow-hidden rounded-xl border ${overdraft ? 'border-danger-100' : 'border-slate-200'}`}>
          <div className="flex justify-between border-b border-slate-100 px-3.5 py-2 text-xs text-slate-600">
            <span>Working days</span>
            <b className="tabular-nums">
              {cost.days}
              {skippedTotal > 0 ? (
                <span className="ml-1 font-normal text-slate-500">
                  ({cost.skippedWeekend > 0 ? `${cost.skippedWeekend} weekend` : ''}
                  {cost.skippedWeekend > 0 && cost.skippedHoliday > 0 ? ' + ' : ''}
                  {cost.skippedHoliday > 0 ? `${cost.skippedHoliday} holiday` : ''} skipped)
                </span>
              ) : null}
            </b>
          </div>

          <div className={`flex justify-between px-3.5 py-2 text-xs ${overdraft ? 'bg-danger-50' : 'bg-blue-50'}`}>
            <span className="text-slate-600">{category === 'unpaid' ? 'Unpaid days added' : `${selected?.name ?? 'Balance'}`}</span>
            <b className="tabular-nums text-slate-900">
              {category === 'unpaid'
                ? `+${cost.days}`
                : `${remaining.toFixed(1)} → ${Math.max(0, after).toFixed(1)}`}
            </b>
          </div>

          {overdraft ? (
            <p className="px-3.5 py-2 text-[11px] text-danger-700">
              Only {remaining.toFixed(1)} left — switch to Unpaid for the remaining{' '}
              {Math.abs(after).toFixed(1)} day{Math.abs(after) === 1 ? '' : 's'}, or shorten the range.
            </p>
          ) : null}
          {cost.days === 0 ? (
            <p className="px-3.5 py-2 text-[11px] text-warning-800">
              No working days in this range — it is all weekend or holiday.
            </p>
          ) : null}

          <p className="border-t border-slate-100 px-3.5 py-1.5 text-[10px] text-slate-500">
            Estimate — the final deduction is computed at submit.
          </p>
        </div>

        {reasonMissing ? (
          <p className="text-[11px] text-slate-500">A reason is required before you can submit.</p>
        ) : null}
      </div>
    </SlideOver>
  );
}
