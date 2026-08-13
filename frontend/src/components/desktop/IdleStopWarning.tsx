import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import {
  DESKTOP_TIMER_IDLE_WARNING_EVENT,
  type DesktopTimerIdleWarningDetail,
} from '@/lib/desktopTimerSession';

/**
 * "Your timer is about to stop."
 *
 * The timer used to stop with no warning: the first someone knew was that it
 * was gone, and in an organization set to discard idle time, so were the
 * minutes. Time Doctor shows a 60-second countdown before it times out, and
 * this is the same idea.
 *
 * Deliberately NOT a modal, unlike the return prompt. That one asks a question
 * and needs an answer; this one is information, and the person may well be
 * mid-call with the correct response being to ignore it and let the timer
 * stop. Trapping focus or blacking out the screen over a notice would be worse
 * than the silence it replaces.
 *
 * The "I'm still working" button needs no cancel logic, which is the nicest
 * part: the OS idle timer is the source of truth, and clicking the button is
 * itself input. `powerMonitor.getSystemIdleTime()` resets, the next tick sees
 * a person who is no longer idle, and the warning clears through the same path
 * as any other return. There is no second mechanism to keep in step, and no
 * way for the button to disagree with the tracker.
 */
export default function IdleStopWarning() {
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);

  useEffect(() => {
    const onWarning = (event: Event) => {
      const detail = (event as CustomEvent<DesktopTimerIdleWarningDetail>).detail;
      setSecondsRemaining(detail?.secondsRemaining ?? null);
    };

    window.addEventListener(DESKTOP_TIMER_IDLE_WARNING_EVENT, onWarning);
    return () => window.removeEventListener(DESKTOP_TIMER_IDLE_WARNING_EVENT, onWarning);
  }, []);

  if (secondsRemaining === null) return null;

  return (
    <div
      /*
       * `polite`, not `alert`. A screen reader interrupting whatever someone is
       * doing to announce a countdown they may not care about is the audible
       * version of the modal this deliberately is not.
       */
      role="status"
      aria-live="polite"
      data-idle-stop-warning=""
      className="fixed bottom-5 left-1/2 z-[190] w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-amber-200 bg-white p-4 shadow-xl"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50">
          <Clock className="h-4 w-4 text-amber-600" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">
            {secondsRemaining > 0
              ? `Your timer stops in ${secondsRemaining} second${secondsRemaining === 1 ? '' : 's'}`
              : 'Stopping your timer…'}
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            We have not seen any keyboard or mouse activity for a while. Move the mouse or press a
            key to keep it running.
          </p>
        </div>
      </div>

      <button
        type="button"
        // No onClick handler on purpose — see the note above. The click is the
        // input that clears this.
        className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
      >
        I&rsquo;m still working
      </button>
    </div>
  );
}
