import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import type { DepartmentTeamForwardTarget } from '@/services/api';

export type EscalationEntry = {
  from_user_id?: number | null;
  to_user_id?: number;
  to_level?: string;
  note?: string | null;
  by_user_id?: number;
  at?: string;
};

export type EscalatableRequest = {
  id: number;
  status: string;
  escalated_to?: { id: number; name: string } | null;
  escalation_history?: EscalationEntry[] | null;
};

export function RequestEscalateControl({
  item,
  onTransfer,
  disabled,
  forwardTargetLoader,
}: {
  item: EscalatableRequest;
  onTransfer: (note?: string, toUserId?: number) => Promise<void> | void;
  disabled?: boolean;
  forwardTargetLoader?: () => Promise<DepartmentTeamForwardTarget[]>;
}) {
  const [busy, setBusy] = useState(false);
  const [targets, setTargets] = useState<DepartmentTeamForwardTarget[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<number | ''>('');

  useEffect(() => {
    let active = true;
    if (item.status === 'pending' && forwardTargetLoader) {
      forwardTargetLoader()
        .then((list) => {
          if (active) setTargets(list);
        })
        .catch(() => {
          if (active) setTargets([]);
        });
    }
    return () => {
      active = false;
    };
  }, [item.status, item.id, forwardTargetLoader]);

  if (item.status !== 'pending') {
    return item.escalated_to ? (
      <p className="mt-1 text-xs font-medium text-indigo-700">
        Escalated to: {item.escalated_to.name}
      </p>
    ) : null;
  }

  const handleForward = async (toUserId?: number) => {
    const note = window.prompt('Optionally add a note for the next approver (e.g. "Manager is unavailable"):');
    if (note === null) return;
    try {
      setBusy(true);
      await onTransfer(note || undefined, toUserId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      {item.escalated_to ? (
        <p className="text-xs font-medium text-indigo-700">Escalated to: {item.escalated_to.name}</p>
      ) : null}

      {targets.length > 0 ? (
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600">
            Forward to (department team manager or upper hierarchy):
          </label>
          <select
            value={selectedTarget}
            onChange={(e) => setSelectedTarget(e.target.value ? Number(e.target.value) : '')}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-300/25"
          >
            <option value="">Select a person to forward to…</option>
            {targets.map((t) => {
              const context = t.team_names.length > 0
                ? `Team: ${t.team_names.join(', ')}`
                : t.source === 'reporting_manager'
                  ? 'Reporting manager'
                  : t.hierarchy_level <= 10
                    ? 'Admin'
                    : 'Upper hierarchy';
              return (
                <option key={t.id} value={t.id}>
                  {t.name} ({context})
                </option>
              );
            })}
          </select>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || disabled || selectedTarget === ''}
            onClick={() => handleForward(Number(selectedTarget))}
          >
            {busy ? 'Forwarding…' : 'Forward to selected person'}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-slate-500">No higher-up is available to forward this request to.</p>
      )}

      {Array.isArray(item.escalation_history) && item.escalation_history.length > 0 ? (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer">Escalation history ({item.escalation_history.length})</summary>
          <ul className="mt-1 list-disc pl-4">
            {item.escalation_history.map((entry, idx) => (
              <li key={idx}>
                {entry.to_level ? entry.to_level : 'Higher level'}
                {entry.note ? ` — ${entry.note}` : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
