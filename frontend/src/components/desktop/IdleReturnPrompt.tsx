import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { activityApi, timeEntryApi } from '@/services/api';
import { reportSilentError } from '@/lib/reportSilentError';
import {
  DESKTOP_TIMER_IDLE_RETURN_EVENT,
  type DesktopTimerIdleReturnDetail,
} from '@/lib/desktopTimerSession';

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

  useEffect(() => {
    const onIdleReturn = (event: Event) => {
      const detail = (event as CustomEvent<DesktopTimerIdleReturnDetail>).detail;
      if (!detail?.activityId) return;
      // One question at a time. A second idle span while this is open would
      // otherwise replace the first and leave it silently unanswered.
      setPrompt((current) => current ?? detail);
    };

    window.addEventListener(DESKTOP_TIMER_IDLE_RETURN_EVENT, onIdleReturn);
    return () => window.removeEventListener(DESKTOP_TIMER_IDLE_RETURN_EVENT, onIdleReturn);
  }, []);

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
      } catch (error) {
        // Never trap someone behind a dialog they cannot dismiss. The idle row
        // stays unresolved and the server keeps its own record either way.
        reportSilentError('idle-return-prompt', error);
      } finally {
        setBusy(null);
        setPrompt(null);
      }
    },
    [prompt, busy]
  );

  if (!prompt) return null;

  const idleLabel = formatIdle(prompt.idleSeconds);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
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
            className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
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
