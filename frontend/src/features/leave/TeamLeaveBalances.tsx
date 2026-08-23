import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, RefreshCw, Search, X } from 'lucide-react';
import { CategoryBars } from './LeaveBalanceCards';

const GROUPS_STORAGE_KEY = 'leave.teamGroups';

const initialsOf = (value: string): string => {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

/** Any category run dry is what a manager scans this list for. */
const hasExhaustedCategory = (row: any): boolean =>
  ((row?.balance?.categories || []) as any[]).some(
    (category) => Number(category?.remaining ?? 1) <= 0
  );

export interface TeamLeaveBalancesProps {
  rows: ReadonlyArray<any>;
  isLoading: boolean;
  onRefresh: () => void;
  colorOf: (code?: string | null) => string;
}

/**
 * Team balances, without the headcount scroll.
 *
 * The previous table rendered one row per person unconditionally — the same
 * disease the attendance roster had, and at the same ~85-person scale. Groups
 * collapse to a one-line summary per department; the number a manager actually
 * scans for (someone with a category at zero) is on the summary line, so the
 * default view answers the question without opening anything.
 */
export default function TeamLeaveBalances({ rows, isLoading, onRefresh, colorOf }: TeamLeaveBalancesProps) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = JSON.parse(window.localStorage.getItem(GROUPS_STORAGE_KEY) || '[]');
      return new Set(Array.isArray(stored) ? stored.filter((v) => typeof v === 'string') : []);
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    window.localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(Array.from(expanded)));
  }, [expanded]);

  const needle = query.trim().toLowerCase();
  const forceOpen = needle !== '';

  const groups = useMemo(() => {
    const matches = (row: any) =>
      !needle ||
      [row?.user?.name, row?.user?.email]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle);

    const byDept = new Map<string, any[]>();
    rows.forEach((row) => {
      const dept = String(row?.user?.department || '').trim() || 'No department';
      byDept.set(dept, [...(byDept.get(dept) ?? []), row]);
    });

    return Array.from(byDept.entries())
      .sort(([a], [b]) => (a === 'No department' ? 1 : b === 'No department' ? -1 : a.localeCompare(b)))
      .map(([name, members]) => ({
        name,
        total: members.length,
        exhausted: members.filter(hasExhaustedCategory).length,
        visible: members
          .filter(matches)
          .sort((a, b) => String(a?.user?.name || '').localeCompare(String(b?.user?.name || ''))),
      }))
      .filter((group) => group.visible.length > 0 || !needle);
  }, [rows, needle]);

  const toggleGroup = (name: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Team leave balances</h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          aria-label="Refresh team balances"
          className="rounded p-1 text-slate-500 transition hover:text-slate-700 disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
        </button>

        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search team member"
            aria-label="Search team balances"
            className="w-52 rounded-lg border border-slate-200 bg-white py-1.5 pl-9 pr-8 text-xs text-slate-800 placeholder:text-slate-500 focus:border-blue-400 focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-500 hover:text-slate-700"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-xs text-slate-500">
          No employees are mapped to your leave approval scope yet.
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-xs text-slate-500">
          Nobody matches “{query}”.
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => {
            const open = forceOpen || expanded.has(group.name);
            return (
              <section key={group.name} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => toggleGroup(group.name)}
                  className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition hover:bg-slate-50"
                >
                  {open ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  )}
                  <span className="text-[13px] font-bold tracking-[-0.015em] text-slate-950">{group.name}</span>
                  <span className="text-[10px] font-semibold tabular-nums text-slate-500">
                    {forceOpen ? `${group.visible.length} of ${group.total}` : group.total}
                  </span>

                  {group.exhausted > 0 ? (
                    <span className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-warning-800">
                      <AlertTriangle className="h-3 w-3" />
                      {group.exhausted} with a category at zero
                    </span>
                  ) : (
                    <span className="ml-auto text-[10px] font-semibold text-slate-500">all categories in credit</span>
                  )}
                </button>

                {open ? (
                  <div className="border-t border-slate-100">
                    {group.visible.map((row) => (
                      <div
                        key={row.user?.id}
                        className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-slate-100 px-4 py-3 last:border-b-0"
                      >
                        <div className="flex min-w-[220px] flex-1 items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600">
                            {initialsOf(row.user?.name || '?')}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-semibold text-slate-950">
                              {row.user?.name || 'Unknown'}
                            </span>
                            <span className="block truncate text-[11px] text-slate-500">
                              {row.user?.email || '—'}
                              {row.user?.reporting_manager?.name ? ` · reports to ${row.user.reporting_manager.name}` : ''}
                            </span>
                          </span>
                        </div>

                        <div className="min-w-[320px] flex-[2]">
                          <CategoryBars
                            categories={(row.balance?.categories || []) as any[]}
                            unpaidUsed={Number(row.balance?.unpaid?.used || 0)}
                            colorOf={colorOf}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
