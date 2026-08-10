import { useMemo } from 'react';
import { AlertTriangle, Check, Laptop, RotateCcw, ShieldCheck, Undo2, Upload } from 'lucide-react';
import type { ChecklistItem, ChecklistOwnerKind } from '@/services/api';
import { formatDate } from '@/lib/dateTime';

const OWNER_LABEL: Record<ChecklistOwnerKind, string> = {
  hr: 'HR',
  manager: 'Manager',
  employee: 'Employee',
  it: 'IT',
  finance: 'Finance',
  buddy: 'Buddy',
};

/** Owners are ordered by when they typically act, not alphabetically. */
const OWNER_ORDER: ChecklistOwnerKind[] = ['hr', 'employee', 'it', 'manager', 'finance', 'buddy'];

const REQUIRES_ICON = {
  document: Upload,
  asset_return: Laptop,
  acknowledgement: ShieldCheck,
} as const;

export interface ChecklistPanelProps {
  items: ChecklistItem[];
  canEdit: boolean;
  busyItemId?: number | null;
  onComplete: (item: ChecklistItem) => void;
  onReopen: (item: ChecklistItem) => void;
  emptyMessage?: string;
}

/**
 * Grouped by who has to act, because that is how the work is actually divided —
 * a flat list makes each person hunt for their own rows.
 */
export default function ChecklistPanel({
  items,
  canEdit,
  busyItemId,
  onComplete,
  onReopen,
  emptyMessage = 'No checklist items yet.',
}: ChecklistPanelProps) {
  const groups = useMemo(() => {
    const byOwner = new Map<ChecklistOwnerKind, ChecklistItem[]>();
    items.forEach((item) => {
      const list = byOwner.get(item.owner_kind) ?? [];
      list.push(item);
      byOwner.set(item.owner_kind, list);
    });

    return OWNER_ORDER.filter((owner) => byOwner.has(owner)).map((owner) => ({
      owner,
      items: [...(byOwner.get(owner) ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    }));
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 px-6 py-10 text-center text-sm text-slate-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map(({ owner, items: ownerItems }) => {
        const done = ownerItems.filter((item) => item.status === 'done' || item.status === 'skipped').length;

        return (
          <section key={owner} className="rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
              <h4 className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                {OWNER_LABEL[owner]}
              </h4>
              <span className="text-[10px] font-bold tabular-nums text-slate-400">
                {done}/{ownerItems.length}
              </span>
            </div>

            <div className="divide-y divide-slate-100">
              {ownerItems.map((item) => {
                const settled = item.status === 'done' || item.status === 'skipped';
                const RequiresIcon =
                  item.requires !== 'none' ? REQUIRES_ICON[item.requires as keyof typeof REQUIRES_ICON] : null;
                const busy = busyItemId === item.id;

                return (
                  <div key={item.id} className="flex items-start gap-3 px-3 py-2.5">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={settled}
                      aria-label={settled ? `Reopen ${item.title}` : `Complete ${item.title}`}
                      disabled={!canEdit || busy}
                      onClick={() => (settled ? onReopen(item) : onComplete(item))}
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition disabled:opacity-50 ${
                        settled
                          ? 'border-success-500 bg-success-500 text-white'
                          : item.is_blocking
                            ? 'border-accent-400 bg-white hover:border-accent-500'
                            : 'border-slate-300 bg-white hover:border-blue-400'
                      }`}
                    >
                      {settled ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`text-[13px] font-semibold ${
                            settled ? 'text-slate-400 line-through' : 'text-slate-900'
                          }`}
                        >
                          {item.title}
                        </span>

                        {item.is_blocking && !settled ? (
                          <span className="rounded-full border border-accent-200 bg-accent-50 px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.06em] text-warning-800">
                            blocking
                          </span>
                        ) : null}

                        {RequiresIcon ? (
                          <span title={item.requires.replace('_', ' ')}>
                            <RequiresIcon className="h-3 w-3 text-slate-400" />
                          </span>
                        ) : null}
                      </div>

                      {item.description ? (
                        <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{item.description}</p>
                      ) : null}

                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-semibold">
                        {item.due_date ? (
                          <span
                            className={
                              item.is_overdue
                                ? 'flex items-center gap-1 text-warning-800'
                                : 'text-slate-400'
                            }
                          >
                            {item.is_overdue ? <AlertTriangle className="h-2.5 w-2.5" /> : null}
                            Due {formatDate(item.due_date)}
                          </span>
                        ) : null}
                        {item.owner?.name ? (
                          <span className="text-slate-400">· {item.owner.name}</span>
                        ) : (
                          <span className="text-slate-300">· unassigned</span>
                        )}
                      </div>
                    </div>

                    {settled && canEdit ? (
                      <button
                        type="button"
                        onClick={() => onReopen(item)}
                        disabled={busy}
                        aria-label={`Reopen ${item.title}`}
                        className="shrink-0 rounded-md p-1 text-slate-300 transition hover:bg-slate-100 hover:text-slate-600"
                      >
                        {busy ? <RotateCcw className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
