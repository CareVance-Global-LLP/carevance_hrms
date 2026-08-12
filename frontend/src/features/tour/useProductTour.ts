import { useCallback, useEffect, useRef } from 'react';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { buildTourSteps, presentSteps } from './tourSteps';
import { reportSilentError } from '@/lib/reportSilentError';

interface ProductTourOptions {
  /** Whether the plan grants payroll, which adds a step. */
  includesPayroll: boolean;
  /** True once the tour has been finished or skipped. */
  hasSeenTour: boolean;
  /** Whether it is time to consider auto-starting (data loaded, card mounted). */
  isReady: boolean;
  /** Persist that it has been seen. Called on finish *and* on skip. */
  onSeen: () => Promise<unknown>;
}

/**
 * The first-login walkthrough.
 *
 * Auto-starts once, for a workspace that has not seen it. Skipping counts as
 * seeing it — someone who closed the tour has made a decision, and reopening it
 * on their next login would be the same as not having listened. It stays
 * available from the setup card via `start()`.
 */
export function useProductTour({ includesPayroll, hasSeenTour, isReady, onSeen }: ProductTourOptions) {
  const autoStarted = useRef(false);

  const start = useCallback(() => {
    const steps = presentSteps(buildTourSteps({ includesPayroll }));
    if (steps.length === 0) {
      return;
    }

    const markSeen = () => {
      onSeen().catch((error) => reportSilentError('product tour: could not record that it was seen', error));
    };

    const instance = driver({
      steps,
      showProgress: true,
      allowClose: true,
      nextBtnText: 'Next',
      prevBtnText: 'Back',
      doneBtnText: 'Finish',
      // Fires on the close button, the overlay and Escape, as well as after the
      // final step — which is exactly the set of ways someone can be done with it.
      onDestroyed: markSeen,
    });

    instance.drive();
  }, [includesPayroll, onSeen]);

  useEffect(() => {
    if (!isReady || hasSeenTour || autoStarted.current) {
      return;
    }

    autoStarted.current = true;
    // One frame, so the dashboard cards the tour points at have laid out.
    const timer = window.setTimeout(start, 400);

    return () => window.clearTimeout(timer);
  }, [isReady, hasSeenTour, start]);

  return { start };
}
