import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { activityApi, timeEntryApi } from '@/services/api';
import { reportSilentError } from '@/lib/reportSilentError';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { resolveTrackerPolicy } from '@/lib/trackerPolicy';
import {
  DESKTOP_TIMER_IDLE_RETURN_EVENT,
  emitDesktopIdleResolved,
  type DesktopTimerIdleReturnDetail,
} from '@/lib/desktopTimerSession';
import { isNativeIdlePopupAvailable } from '@/lib/idlePopupBridge';

/**
 * "You were away — what was that?"
 *
 * The tracker used to answer this on the person's behalf: past the threshold it
 * stopped the timer, rewound the tail off the entry and sent an email. Someone
 * reading a spec, on a call or at a whiteboard simply lost the time.
 *
 * Every comparable product asks instead, and neither Hubstaff nor Time Doctor
 * deducts idle from worked hours without an answer. Discard leads because that
 * is the industry default and the conservative choice, but it is a choice the
 * person makes rather than one made for them.
 *
 * An organization may take that choice away in either direction — always keep,
 * or never keep — which is Hubstaff's model too. Under those policies the
 * server has already resolved the span by the time this component hears about
 * it, so there is nothing to ask; this only reports what happened. It does
 * still report it. Someone's timesheet changed, and finding that out by
 * noticing the number is wrong is how people stop trusting a tracker.
 */

const formatIdle = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  if (minutes < 1) return `${total} seconds`;
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0
    ? `${hours}h ${rest}m`
    : `${hours} hour${hours === 1 ? '' : 's'}`;
};

export default function IdleReturnPrompt() {
  const [prompt, setPrompt] = useState<DesktopTimerIdleReturnDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const discardRef = useRef<HTMLButtonElement | null>(null);
  const { user } = useAuth();
  const toast = useToast();

  const idlePolicy = resolveTrackerPolicy(user).idle_resolution_policy;

  /*
   * Held in a ref so the listener below can stay mounted once. Reading the
   * policy from the closure instead would pin it to whatever it was when the
   * component mounted, and this component never remounts during a session.
   */
  const idlePolicyRef = useRef(idlePolicy);
  useEffect(() => {
    idlePolicyRef.current = idlePolicy;
  }, [idlePolicy]);

  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  /**
   * The idle span the native popup is currently asking about.
   *
   * A ref rather than state because nothing renders from it — the popup is the
   * UI — and because the IPC listener below is mounted once and would otherwise
   * close over a stale value.
   */
  const nativePendingRef = useRef<DesktopTimerIdleReturnDetail | null>(null);

  useEffect(() => {
    const onIdleReturn = (event: Event) => {
      const detail = (event as CustomEvent<DesktopTimerIdleReturnDetail>).detail;
      if (!detail?.activityId) return;

      const policy = idlePolicyRef.current;
      if (policy !== 'prompt') {
        // The server resolved this when it recorded the span, so asking now
        // would offer a choice that no longer exists. Say what happened.
        const label = formatIdle(detail.idleSeconds);
        toastRef.current.show({
          kind: 'info',
          message: policy === 'never_keep'
            ? `${label} away from the keyboard was removed from your timesheet — your organization does not count idle time.`
            : `${label} away from the keyboard was kept on your timesheet — your organization counts idle time as work.`,
        });
        return;
      }

      /*
       * On a shell that can show it, the question is asked by the native popup
       * instead — a modal inside the app window is invisible to somebody who
       * has been away from that window, which is everybody this asks. The
       * answer still comes back through `resolveIdle`; only the surface moved.
       *
       * The toast branch above deliberately stays in-app under either shell:
       * it reports a decision already made rather than asking for one, so it
       * can wait until the person next looks at the app.
       */
      if (isNativeIdlePopupAvailable()) {
        // Remembered, not rendered: the answer arrives over IPC and has to be
        // attributed to this span.
        nativePendingRef.current = detail;
        return;
      }

      // One question at a time. A second idle span while this is open would
      // otherwise replace the first and leave it silently unanswered.
      setPrompt((current) => current ?? detail);
    };

    window.addEventListener(DESKTOP_TIMER_IDLE_RETURN_EVENT, onIdleReturn);
    return () => window.removeEventListener(DESKTOP_TIMER_IDLE_RETURN_EVENT, onIdleReturn);
  }, []);

  /**
   * Answers given in the native popup.
   *
   * Routed through the same `resolveIdle` call as the in-app buttons, on
   * purpose: the popup reports which button was pressed and nothing more, so
   * there is no second copy of what keeping or discarding means.
   */
  useEffect(() => {
    const bridge = window.desktopTracker;
    if (typeof bridge?.onIdlePopupAction !== 'function') return;

    const dispose = bridge.onIdlePopupAction((payload) => {
      const action = payload?.action;
      if (action !== 'keep' && action !== 'discard') return;

      const pending = nativePendingRef.current;
      // Cleared before the await, so a duplicate delivery of the same click
      // cannot resolve the span twice. The server is idempotent on this too,
      // but a second discard that raced the first would still be a wasted
      // request against a person's timesheet.
      nativePendingRef.current = null;
      if (!pending?.activityId) return;

      void (async () => {
        const outcome = action === 'keep' ? 'kept' : 'discarded';
        try {
          await activityApi.resolveIdle(pending.activityId, outcome);
          // The server's worked total has just moved. Tell the dashboard, which
          // otherwise keeps counting past a discarded stretch until a reload.
          if (user?.id) {
            emitDesktopIdleResolved({
              userId: user.id,
              activityId: pending.activityId,
              outcome: outcome === 'kept' ? 'kept' : 'discarded',
            });
          }
        } catch (error) {
          reportSilentError('idle-return-prompt-native', error);
        } finally {
          void window.desktopTracker?.hideIdlePopup?.();
        }
      })();
    });

    return () => {
      if (typeof dispose === 'function') dispose();
    };
    // user.id is a dependency because the resolved-event carries it; with an
    // empty list the handler would capture the null user from the first render
    // and the dashboard would never hear about a popup answer.
  }, [user?.id]);

  // Focus the safe option, so Enter takes the conservative path.
  useEffect(() => {
    if (prompt) discardRef.current?.focus();
  }, [prompt]);

  const resolve = useCallback(
    async (action: 'kept' | 'discarded', stopTimer = false) => {
      if (!prompt || busy) return;
      setBusy(action + (stopTimer ? '-stop' : ''));

      try {
        await activityApi.resolveIdle(prompt.activityId, action);
        if (stopTimer) {
          await timeEntryApi.stop({ timer_slot: 'primary' });
        }
        // See the native path above: the countdown has to re-read worked time
        // now, not at the next reload.
        if (user?.id) {
          emitDesktopIdleResolved({ userId: user.id, activityId: prompt.activityId, outcome: action });
        }
      } catch (error) {
        // Never trap someone behind a dialog they cannot dismiss. The idle row
        // stays unresolved and the server keeps its own record either way.
        reportSilentError('idle-return-prompt', error);
      } finally {
        setBusy(null);
        setPrompt(null);
      }
    },
    [prompt, busy, user?.id]
  );

  if (!prompt) return null;

  const idleLabel = formatIdle(prompt.idleSeconds);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="idle-return-title"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50">
            <Clock className="h-4.5 w-4.5 text-amber-600" aria-hidden="true" />
          </span>
          <div>
            <h2 id="idle-return-title" className="text-lg font-semibold text-slate-900">
              You were away for {idleLabel}
            </h2>
            <p className="mt-1.5 text-sm text-slate-600">
              Your timer kept running. Was that time work — a call, reading, or a meeting away
              from the keyboard?
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2">
          <button
            ref={discardRef}
            type="button"
            onClick={() => resolve('discarded')}
            disabled={Boolean(busy)}
            className="w-full rounded-lg bg-surface-inverse px-4 py-2.5 text-sm font-semibold text-on-inverse transition hover:bg-surface-inverse/90 disabled:opacity-60"
          >
            {busy === 'discarded' ? 'Removing…' : `Remove ${idleLabel} from my timesheet`}
          </button>
          <button
            type="button"
            onClick={() => resolve('kept')}
            disabled={Boolean(busy)}
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:opacity-60"
          >
            {busy === 'kept' ? 'Keeping…' : 'I was working — keep it'}
          </button>
          {prompt.timerRunning && (
            <button
              type="button"
              onClick={() => resolve('discarded', true)}
              disabled={Boolean(busy)}
              className="w-full rounded-lg px-4 py-2 text-sm font-medium text-slate-500 transition hover:text-slate-900 disabled:opacity-60"
            >
              {busy === 'discarded-stop' ? 'Stopping…' : 'Remove it and stop my timer'}
            </button>
          )}
        </div>

        <p className="mt-4 text-xs text-slate-500">
          Whatever you choose is recorded against this period, and you can see it later under
          My&nbsp;Activity.
        </p>
      </div>
    </div>
  );
}
