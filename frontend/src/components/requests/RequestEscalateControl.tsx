import { useState } from 'react';
import Button from '@/components/ui/Button';

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
}: {
  item: EscalatableRequest;
  onTransfer: (note?: string) => Promise<void> | void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  if (item.status !== 'pending') {
    return item.escalated_to ? (
      <p className="mt-1 text-xs font-medium text-indigo-700">
        Escalated to: {item.escalated_to.name}
      </p>
    ) : null;
  }

  const handleTransfer = async () => {
    const note = window.prompt('Optionally add a note for the next approver (e.g. "Manager is unavailable"):');
    if (note === null) return;
    try {
      setBusy(true);
      await onTransfer(note || undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-1">
      {item.escalated_to ? (
        <p className="text-xs font-medium text-indigo-700">Escalated to: {item.escalated_to.name}</p>
      ) : null}
      <div>
        <Button onClick={handleTransfer} disabled={busy || disabled} size="sm" variant="outline">
          {busy ? 'Transferring…' : 'Transfer / Escalate'}
        </Button>
      </div>
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
