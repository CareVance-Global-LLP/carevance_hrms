import { RefreshCw } from 'lucide-react';
import type { LeaveCategoryBalance } from './leaveUtils';

/** SVG ring: remaining over quota, readable before any number is. */
function BalanceRing({ remaining, quota, color }: { remaining: number; quota: number; color: string }) {
  const radius = 19;
  const circumference = 2 * Math.PI * radius;
  const share = quota > 0 ? Math.max(0, Math.min(1, remaining / quota)) : 0;

  return (
    <span className="relative h-[46px] w-[46px] shrink-0">
      <svg width="46" height="46" className="-rotate-90">
        <circle cx="23" cy="23" r={radius} fill="none" stroke="#E4E8EB" strokeWidth="5" />
        <circle
          cx="23"
          cy="23"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - share)}
        />
      </svg>
      <b className="absolute inset-0 flex items-center justify-center text-[11px] font-bold tabular-nums tracking-[-0.02em] text-slate-900">
        {Number(remaining).toFixed(remaining % 1 === 0 ? 0 : 1)}
      </b>
    </span>
  );
}

export interface LeaveBalanceCardsProps {
  categories: LeaveCategoryBalance[];
  unpaidUsed: number;
  isLoading: boolean;
  onRefresh: () => void;
  colorOf: (code?: string | null) => string;
  /**
   * Open the ledger behind a card. Optional: TeamLeaveBalances renders these
   * same cards where there is nothing to open.
   */
  onExplain?: (code: string) => void;
}

/**
 * One card per policy category. Unpaid is deliberately dashed and last — it is
 * a debt counter, not an allowance, and rendering it like the others invites
 * reading it as "days you still have".
 */
export default function LeaveBalanceCards({
  categories,
  unpaidUsed,
  isLoading,
  onRefresh,
  colorOf,
  onExplain,
}: LeaveBalanceCardsProps) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">My balances</h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          aria-label="Refresh balances"
          className="rounded p-1 text-slate-500 transition hover:text-slate-700 disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {isLoading && categories.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-xs text-slate-500">
          Loading balances…
        </div>
      ) : categories.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-xs text-slate-500">
          No leave policy configured yet — unpaid leave is still available from “Request leave”.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {categories.map((category) => {
            const body = (
              <>
                <BalanceRing
                  remaining={Number(category.remaining || 0)}
                  quota={Number(category.annual_quota || 0)}
                  color={colorOf(category.code)}
                />
                <span className="min-w-0 text-left">
                  <span className="block truncate text-[13px] font-bold tracking-[-0.01em] text-slate-950">
                    {category.name}
                  </span>
                  <span className="block text-[11px] font-semibold tabular-nums text-slate-500">
                    of {Number(category.annual_quota || 0).toFixed(1)} · used {Number(category.used || 0).toFixed(1)}
                  </span>
                </span>
              </>
            );

            const shell = 'flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3';

            /*
             * A balance nobody can expand is one you end up arguing about. The
             * card becomes a button only where there is a ledger to open, so
             * nothing here promises a breakdown that does not exist.
             */
            return onExplain ? (
              <button
                key={category.code}
                type="button"
                onClick={() => onExplain(category.code)}
                aria-label={`How the ${category.name} balance was earned`}
                className={`${shell} text-left transition hover:border-slate-300 hover:shadow-sm`}
              >
                {body}
              </button>
            ) : (
              <div key={category.code} className={shell}>
                {body}
              </div>
            );
          })}

          <div className="flex items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3">
            <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 text-[13px] font-bold tabular-nums text-danger-700">
              {Number(unpaidUsed || 0).toFixed(unpaidUsed % 1 === 0 ? 0 : 1)}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-bold tracking-[-0.01em] text-slate-950">Unpaid used</span>
              <span className="block text-[10px] font-semibold text-slate-500">days this year</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Per-category bars for the team balance table — replaces the pipe-joined
 * string cell ("Casual: 4.0 | Sick: 2.5 | …") with something comparable down
 * a column.
 */
export function CategoryBars({
  categories,
  unpaidUsed,
  colorOf,
}: {
  categories: LeaveCategoryBalance[];
  unpaidUsed: number;
  colorOf: (code?: string | null) => string;
}) {
  if (!categories.length) {
    return <span className="text-xs text-slate-500">No policy</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {categories.map((category) => {
        const quota = Number(category.annual_quota || 0);
        const remaining = Number(category.remaining || 0);
        const share = quota > 0 ? Math.max(0, Math.min(1, remaining / quota)) : 0;
        const empty = remaining <= 0;
        return (
          <span key={category.code} className="min-w-[130px] flex-1">
            <span className="mb-1 flex items-baseline justify-between gap-2">
              <span className="truncate text-[12px] font-semibold text-slate-700">{category.name}</span>
              <span
                className={`font-mono text-[12px] font-bold tabular-nums ${
                  empty ? 'text-warning-800' : 'text-slate-800'
                }`}
              >
                {remaining.toFixed(1)}
                <span className="font-normal text-slate-500">/{quota.toFixed(1)}</span>
              </span>
            </span>
            <span className="block h-2.5 overflow-hidden rounded-full bg-slate-100">
              <span
                className="block h-full rounded-full"
                style={{ width: `${share * 100}%`, backgroundColor: colorOf(category.code) }}
              />
            </span>
          </span>
        );
      })}
      {unpaidUsed > 0 ? (
        <span className="shrink-0 rounded-full border border-danger-100 bg-danger-50 px-2.5 py-1 text-[11px] font-bold tabular-nums text-danger-700">
          {Number(unpaidUsed).toFixed(1)} unpaid
        </span>
      ) : null}
    </div>
  );
}
