import { useCallback, useEffect, useState } from 'react';
import { LifeBuoy, ShieldQuestion } from 'lucide-react';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { authApi, type BreakGlassSession } from '@/services/api';
import { reportSilentError } from '@/lib/reportSilentError';
import SettingsCard from './SettingsCard';

const formatWhen = (iso: string | null): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const toneFor = (session: BreakGlassSession): 'success' | 'warning' | 'neutral' | 'info' => {
  if (session.is_usable) return 'warning';
  if (session.status === 'pending') return 'info';
  return 'neutral';
};

/**
 * Support access to this organisation, decided by this organisation.
 *
 * Everything here is the customer's side of break-glass: what CareVance
 * support has asked for, why, and whether it was allowed. The endpoint this
 * replaced granted unlimited, non-expiring access with no request, no reason
 * and no record — so the most important thing this screen does is exist.
 */
export default function BreakGlassSection() {
  const { show } = useToast();
  const [sessions, setSessions] = useState<BreakGlassSession[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSessions(await authApi.breakGlassSessions());
    } catch (error) {
      reportSilentError('settings.breakGlass.list', error);
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = async (id: number, action: 'approve' | 'reject' | 'revoke') => {
    setBusyId(id);
    try {
      if (action === 'approve') await authApi.breakGlassApprove(id);
      if (action === 'reject') await authApi.breakGlassReject(id);
      if (action === 'revoke') await authApi.breakGlassRevoke(id);

      show({
        kind: 'success',
        message:
          action === 'approve'
            ? 'Access granted. It ends automatically at the time shown.'
            : action === 'reject'
              ? 'Request declined.'
              : 'Access ended. Any active session token has been destroyed.',
      });
      await refresh();
    } catch (error: any) {
      show({ kind: 'error', message: error?.response?.data?.message || 'That did not go through.' });
    } finally {
      setBusyId(null);
    }
  };

  if (sessions === null) {
    return (
      <SettingsCard title="CareVance support access">
        <p className="text-xs text-slate-500">Checking…</p>
      </SettingsCard>
    );
  }

  const pending = sessions.filter((session) => session.status === 'pending');
  const active = sessions.filter((session) => session.is_usable);
  const past = sessions.filter((session) => session.status !== 'pending' && !session.is_usable).slice(0, 10);

  return (
    <SettingsCard
      title="CareVance support access"
      description="Support can only enter your account when you allow it, for a stated reason, and never for more than an hour. Everything done during a session is recorded against it in your audit log."
      aside={
        active.length > 0
          ? <StatusBadge tone="warning">{active.length} active</StatusBadge>
          : pending.length > 0
            ? <StatusBadge tone="info">{pending.length} waiting</StatusBadge>
            : <StatusBadge tone="success">No access</StatusBadge>
      }
    >
      {sessions.length === 0 && (
        <p className="text-xs leading-5 text-slate-600">
          Nobody at CareVance has ever requested access to this organisation.
        </p>
      )}

      {[...pending, ...active, ...past].map((session) => {
        const isPending = session.status === 'pending';

        return (
          <div
            key={session.id}
            className="flex flex-wrap items-start gap-3 border-t border-slate-200 py-3 first:border-t-0 first:pt-0"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-surface-sunken text-slate-600">
              {isPending ? <ShieldQuestion className="h-4 w-4" /> : <LifeBuoy className="h-4 w-4" />}
            </span>

            <div className="min-w-[12rem] flex-1">
              <p className="text-sm font-medium text-slate-900">
                {session.requested_by.name || 'A CareVance engineer'} &rarr;{' '}
                {session.target_user.name || 'an employee account'}
              </p>

              {/* The stated reason is the whole basis for a decision, so it is
                  shown in full rather than truncated into a tooltip. */}
              <p className="mt-1 rounded-md border border-slate-200 bg-surface-sunken px-2 py-1.5 text-xs leading-5 text-slate-700">
                &ldquo;{session.reason}&rdquo;
              </p>

              <p className="mt-1.5 text-xs text-slate-500">
                Requested {formatWhen(session.requested_at)}
                {session.is_usable && ` · ends in ${session.remaining_minutes} min`}
                {!session.is_usable && session.unusable_reason && ` · ${session.unusable_reason}`}
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {isPending && (
                <>
                  <Button
                    size="sm"
                    onClick={() => void act(session.id, 'approve')}
                    loading={busyId === session.id}
                    disabled={busyId !== null}
                  >
                    Allow for 1 hour
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void act(session.id, 'reject')}
                    disabled={busyId !== null}
                  >
                    Decline
                  </Button>
                </>
              )}

              {session.is_usable && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => void act(session.id, 'revoke')}
                  loading={busyId === session.id}
                  disabled={busyId !== null}
                >
                  End now
                </Button>
              )}

              {!isPending && !session.is_usable && (
                <StatusBadge tone={toneFor(session)}>{session.status}</StatusBadge>
              )}
            </div>
          </div>
        );
      })}
    </SettingsCard>
  );
}
