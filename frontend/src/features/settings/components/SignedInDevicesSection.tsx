import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LifeBuoy, Monitor, MonitorSmartphone, Smartphone } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import StatusBadge from '@/components/ui/StatusBadge';
import { useAuth } from '@/contexts/AuthContext';
import { authApi, type SignedInSession } from '@/services/api';
import SettingRow from './SettingRow';
import { brandLabel } from '@/config/brand';

/**
 * Every device currently signed in to your own account.
 *
 * THIS ANSWERS ONE QUESTION: "is anyone else on my account?" Until this
 * existed the screen could only describe the browser you were reading it in,
 * read client-side from `navigator.userAgent` — which can never mention a
 * second machine, because a second machine is exactly what it cannot see.
 *
 * NOTHING HERE IS INVENTED. The device label is parsed by the server from the
 * user agent it stored at sign-in and reads "Unknown device" when the agent
 * said nothing; the address is shown as itself rather than resolved to a city,
 * because turning an IP into a place means handing our users' addresses to a
 * third party every time somebody opens a settings screen.
 *
 * A FAILED LOAD IS NOT AN EMPTY LIST. "No other devices" and "we could not
 * check" are opposite answers to the question being asked, and rendering the
 * second as the first is the one outcome worse than showing nothing at all.
 * The failure path says so and falls back to the client-side description of
 * this browser — which is exactly what this block showed before.
 */

/**
 * Whole words, not "2m". This row is read once, in a moment of mild suspicion,
 * by somebody who is not skimming a dashboard.
 *
 * Accurate to the minute and no better: the server records activity at most
 * once a minute on purpose (an unthrottled write on every authenticated
 * request was the first thing to saturate the primary), so "just now" covers
 * everything under two minutes rather than pretending to a precision the
 * stored value does not have.
 */
export const formatLastActive = (iso: string | null): string => {
  if (!iso) return 'Not used since signing in';

  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Last active unknown';

  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 120) return 'Active just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;

  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
};

/**
 * Picked from the label the server already produced, never from a second guess
 * at the user agent. A support session gets its own icon because it is not a
 * device the account holder owns.
 */
const iconFor = (device: string): LucideIcon => {
  if (/support access/i.test(device)) return LifeBuoy;
  if (/iphone|ipad|ios|android/i.test(device)) return Smartphone;
  return Monitor;
};

const describeWhere = (session: SignedInSession): string => {
  const parts = [session.ip ? `IP ${session.ip}` : 'Address not recorded', formatLastActive(session.last_used_at)];
  return parts.join(' · ');
};

/**
 * How many rows are shown before the list has to be asked for.
 *
 * Not a styling choice. A seven-day token lifetime and one token per sign-in
 * leave real accounts holding dozens of live sessions — one production account
 * holds 163 — and a card that renders every one of them answers "is anyone
 * else on my account" with a wall the reader gives up on. Five is more devices
 * than most people own; the rest are one click away and can all be signed out
 * at once.
 */
const COLLAPSED_ROWS = 5;

/**
 * This device first, then the server's order (most recently used).
 *
 * Only so that collapsing the list can never hide the row the reader is
 * standing in — "which of these is me" is the first thing they need answered,
 * and a current session sorted below the fold makes every other row ambiguous.
 */
const currentFirst = (sessions: SignedInSession[]): SignedInSession[] => [
  ...sessions.filter((session) => session.is_current),
  ...sessions.filter((session) => !session.is_current),
];

export default function SignedInDevicesSection({ fallbackDeviceLabel }: { fallbackDeviceLabel: string }) {
  const queryClient = useQueryClient();
  const { logout } = useAuth();
  /*
   * Not window.confirm, for the same reason ScimTokensSection refuses it: a
   * native OS dialog on a destructive action cannot be themed and fires on the
   * button a buyer is most likely to press while watching.
   */
  const [signingOut, setSigningOut] = useState<SignedInSession | null>(null);
  const [signingOutOthers, setSigningOutOthers] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');

  /*
   * "4 minutes ago" is computed while rendering, so left alone it is frozen at
   * whatever the clock said when the pane opened. On the one screen whose job
   * is to say whether a device is in use RIGHT NOW, a stopped clock is the
   * worst kind of stale: somebody comes back an hour later and reads "Active
   * just now" about a session that went quiet before they made coffee.
   *
   * Once a minute, matching the server's own activity granularity — a faster
   * tick would claim precision the stored value does not have.
   */
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setClockTick((tick) => tick + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const query = useQuery({
    queryKey: ['auth-sessions'],
    queryFn: () => authApi.sessions(),
  });

  const revoke = useMutation({
    mutationFn: (id: number) => authApi.revokeSession(id),
    onSuccess: (result) => {
      setError('');
      /*
       * A backstop. This device is signed out through the ordinary logout path
       * below rather than through here, but if the server says the row it just
       * deleted was ours anyway, this tab is holding a token that no longer
       * exists — clear it now instead of letting the next request discover it
       * as a 401 that looks like a crash.
       */
      if (result.was_current_session) {
        void logout();
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ['auth-sessions'] });
    },
    onError: (err: any) =>
      setError(err?.response?.data?.message || 'Could not sign that device out. Nothing has changed.'),
  });

  const revokeOthers = useMutation({
    mutationFn: () => authApi.revokeOtherSessions(),
    onSuccess: () => {
      setError('');
      setExpanded(false);
      void queryClient.invalidateQueries({ queryKey: ['auth-sessions'] });
    },
    onError: (err: any) =>
      setError(err?.response?.data?.message || 'Could not sign the other devices out. Nothing has changed.'),
  });

  const sessions = currentFirst(query.data?.data ?? []);
  const activeDevices = query.data?.active_device_count ?? 0;
  const windowMinutes = query.data?.concurrent_window_minutes ?? 15;
  const totalCount = query.data?.total_count ?? sessions.length;
  const visibleSessions = expanded ? sessions : sessions.slice(0, COLLAPSED_ROWS);
  const hiddenCount = sessions.length - visibleSessions.length;
  // The server caps what it sends; this is what it could not fit. Saying so is
  // the difference between a short list and a list that is quietly lying.
  const notListedCount = Math.max(0, totalCount - sessions.length);

  if (query.isLoading) {
    return <p className="text-xs text-slate-500">Checking…</p>;
  }

  if (query.isError) {
    return (
      <>
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {/* Never a silent empty list — see the note at the top of this file. */}
          We could not read your other devices just now. This does not mean there are none; try again in a moment.
        </p>
        <SettingRow
          icon={Monitor}
          title={fallbackDeviceLabel}
          description="The browser you are reading this in."
          control={<StatusBadge tone="success">This device</StatusBadge>}
        />
      </>
    );
  }

  return (
    <>
      {/*
        The answer to the actual question, said plainly and NOT as an alarm.
        Two devices is what a laptop and a phone look like, and a red banner
        over a normal state is how people learn to ignore the one that matters.
      */}
      {query.data?.concurrent_use ? (
        <div
          className="mb-3 flex items-start gap-2.5 rounded-lg border border-slate-200 bg-surface-sunken px-3 py-2.5"
          data-testid="concurrent-devices-banner"
        >
          <MonitorSmartphone className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
          <p className="text-xs leading-5 text-slate-700">
            <span className="font-medium text-slate-900">
              {activeDevices} devices have used this account in the last {windowMinutes} minutes.
            </span>{' '}
            That is normal if one of them is your phone. If you do not recognise one below, sign it out and change
            your password.
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {/* The list always holds at least the session reading it, so an empty one
          means the server answered with something we did not expect — say that
          rather than render a card with a hole in it. */}
      {sessions.length === 0 ? (
        <p className="text-xs leading-5 text-slate-600">No signed-in devices were returned for your account.</p>
      ) : null}

      {visibleSessions.map((session) => (
        <SettingRow
          key={session.id}
          icon={iconFor(session.device)}
          title={session.device}
          description={describeWhere(session)}
          control={
            <>
              {session.is_current ? <StatusBadge tone="success">This device</StatusBadge> : null}
              <Button
                variant={session.is_current ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setSigningOut(session)}
                disabled={revoke.isPending}
                /* A column of buttons all announced as "Sign out" is unusable
                   without sight of the row they sit in. */
                aria-label={`Sign out ${session.device}`}
              >
                Sign out
              </Button>
            </>
          }
        />
      ))}

      {/*
        The two things a long list needs, and neither is decoration: a way to
        see the rest of it, and a way to end all of it. Without the second, an
        account carrying dozens of sessions can only be cleaned up one
        confirmation at a time — which nobody finishes, so the list stays
        unreadable and the screen stops answering its question.
      */}
      {sessions.length > 1 || notListedCount > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
          <div className="text-xs leading-5 text-slate-600">
            {hiddenCount > 0 ? (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="rounded font-medium text-slate-900 underline underline-offset-2 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              >
                Show {hiddenCount} more {hiddenCount === 1 ? 'device' : 'devices'}
              </button>
            ) : null}
            {hiddenCount === 0 && expanded && sessions.length > COLLAPSED_ROWS ? (
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="rounded font-medium text-slate-900 underline underline-offset-2 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              >
                Show fewer
              </button>
            ) : null}
            {notListedCount > 0 ? (
              <span className="block">
                {sessions.length} of {totalCount} sessions shown, most recently used first. Signing out everywhere
                else clears the rest.
              </span>
            ) : null}
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setSigningOutOthers(true)}
            loading={revokeOthers.isPending}
            disabled={revokeOthers.isPending}
          >
            Sign out everywhere else
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        isOpen={signingOutOthers}
        title="Sign out every other device?"
        message="This device stays signed in. Every other session on your account ends the next time it contacts ${brandLabel}, usually within a few seconds — including any you cannot see here. If you think somebody else has your password, change it as well."
        confirmLabel="Sign out the others"
        tone="danger"
        isLoading={revokeOthers.isPending}
        onConfirm={() => {
          revokeOthers.mutate();
          setSigningOutOthers(false);
        }}
        onClose={() => setSigningOutOthers(false)}
      />

      <ConfirmDialog
        isOpen={signingOut !== null}
        title={signingOut?.is_current ? 'Sign out on this device?' : 'Sign out that device?'}
        message={
          signingOut
            ? signingOut.is_current
              ? 'You will be returned to the sign-in screen here. Your other devices stay signed in.'
              : `${signingOut.device} will be signed out the next time it contacts ${brandLabel}, usually within a few seconds. Anyone using it will have to sign in again. If you did not recognise it, change your password as well.`
            : ''
        }
        confirmLabel="Sign out"
        tone="danger"
        isLoading={revoke.isPending}
        onConfirm={() => {
          /*
           * Signing out THIS device keeps going through the same logout() it
           * always has — it flushes the desktop tracker and stops a running
           * timer before it drops the token, and deleting the row from under
           * that would lose whatever had not been sent yet.
           */
          if (signingOut?.is_current) void logout();
          else if (signingOut) revoke.mutate(signingOut.id);
          setSigningOut(null);
        }}
        onClose={() => setSigningOut(null)}
      />
    </>
  );
}
