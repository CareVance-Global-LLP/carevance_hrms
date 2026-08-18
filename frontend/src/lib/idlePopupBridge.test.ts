import { describe, expect, it, vi, afterEach } from 'vitest';
import { isNativeIdlePopupAvailable, pushIdlePopupState } from './idlePopupBridge';

const setBridge = (bridge: unknown) => {
  Object.defineProperty(window, 'desktopTracker', {
    value: bridge,
    configurable: true,
    writable: true,
  });
};

afterEach(() => {
  setBridge(undefined);
  vi.restoreAllMocks();
});

describe('isNativeIdlePopupAvailable', () => {
  it('is false in a plain browser, so the in-app countdown still renders', () => {
    setBridge(undefined);

    expect(isNativeIdlePopupAvailable()).toBe(false);
  });

  it('is false on a desktop build that predates the popup', () => {
    /*
     * The renderer is served remotely and updates itself; the installed shell
     * does not. Somebody on an older build has `desktopTracker` but no
     * `showIdlePopup`, and treating "is the desktop shell" as "has the popup"
     * would hide the in-app warning and put nothing in its place — leaving that
     * person with no idle warning at all.
     */
    setBridge({ getSystemIdleSeconds: () => Promise.resolve(0) });

    expect(isNativeIdlePopupAvailable()).toBe(false);
  });

  it('is true once the shell exposes the popup', () => {
    setBridge({ showIdlePopup: vi.fn(), hideIdlePopup: vi.fn() });

    expect(isNativeIdlePopupAvailable()).toBe(true);
  });
});

describe('pushIdlePopupState', () => {
  it('sends the countdown state to the shell', () => {
    const showIdlePopup = vi.fn().mockResolvedValue(true);
    setBridge({ showIdlePopup, hideIdlePopup: vi.fn() });

    const handled = pushIdlePopupState({ mode: 'warning', secondsRemaining: 42, idleSeconds: 258 });

    expect(handled).toBe(true);
    expect(showIdlePopup).toHaveBeenCalledWith({
      mode: 'warning',
      secondsRemaining: 42,
      idleSeconds: 258,
    });
  });

  it('hides the popup when the person comes back', () => {
    const hideIdlePopup = vi.fn().mockResolvedValue(true);
    setBridge({ showIdlePopup: vi.fn(), hideIdlePopup });

    const handled = pushIdlePopupState(null);

    expect(handled).toBe(true);
    expect(hideIdlePopup).toHaveBeenCalled();
  });

  it('reports it did nothing in a browser, so the caller keeps the in-app path', () => {
    setBridge(undefined);

    expect(pushIdlePopupState({ mode: 'warning', secondsRemaining: 5, idleSeconds: 295 })).toBe(false);
  });

  it('survives a shell that rejects, rather than breaking the tracker tick', async () => {
    const showIdlePopup = vi.fn().mockRejectedValue(new Error('ipc gone'));
    setBridge({ showIdlePopup, hideIdlePopup: vi.fn() });

    expect(() =>
      pushIdlePopupState({ mode: 'warning', secondsRemaining: 5, idleSeconds: 295 })
    ).not.toThrow();

    // The rejection is swallowed deliberately; an unhandled one would surface as
    // a console error on every second of every idle stretch.
    await Promise.resolve();
  });
});
