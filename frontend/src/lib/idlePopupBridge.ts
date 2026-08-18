import { reportSilentError } from '@/lib/reportSilentError';

/**
 * The tracker's side of the native idle popup.
 *
 * The idle countdown was a React component mounted in Layout, which meant it
 * could only be seen while the CareVance window was on screen. For somebody who
 * has just walked away that is precisely when it is not: the window is behind a
 * browser, minimised, or on the other monitor. The first they knew of the stop
 * was that their timer had gone.
 *
 * The shell renders the popup now. This module is only the wire, and it is
 * deliberately the only thing that knows the popup might not be there.
 */

export type IdlePopupState =
  | { mode: 'warning'; secondsRemaining: number; idleSeconds: number }
  | { mode: 'stopped'; idleSeconds: number }
  | { mode: 'return'; idleSeconds: number; activityId: number };

/**
 * Whether this shell can render the popup natively.
 *
 * Tests the METHOD, not merely the presence of `desktopTracker`. The renderer
 * is served remotely and updates itself while the installed shell does not, so
 * somebody on an older build has the bridge object but no `showIdlePopup` —
 * and treating "is the desktop app" as "has the popup" would hide the in-app
 * countdown and put nothing in its place, leaving that person with no idle
 * warning at all.
 */
export const isNativeIdlePopupAvailable = (): boolean =>
  typeof window !== 'undefined' && typeof window.desktopTracker?.showIdlePopup === 'function';

/**
 * Push popup state to the shell, or `null` to take it off screen.
 *
 * @returns whether the native popup handled it. `false` means the caller is on
 *   the web or an old shell and the in-app components are still the UI.
 */
export const pushIdlePopupState = (state: IdlePopupState | null): boolean => {
  if (!isNativeIdlePopupAvailable()) return false;

  const bridge = window.desktopTracker;

  try {
    /*
     * Fire-and-forget with the rejection swallowed. This runs on every tick of
     * every idle stretch, so an unhandled rejection would print once a second
     * for as long as somebody is away — and a failed popup update is never a
     * reason to interrupt the tick that is still recording their time.
     */
    const result = state === null ? bridge?.hideIdlePopup?.() : bridge?.showIdlePopup?.(state);
    void Promise.resolve(result).catch((error) => reportSilentError('idle-popup-bridge', error));
  } catch (error) {
    reportSilentError('idle-popup-bridge', error);
  }

  return true;
};
