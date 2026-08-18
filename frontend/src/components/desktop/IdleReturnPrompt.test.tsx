import { render, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import IdleReturnPrompt from './IdleReturnPrompt';
import {
  DESKTOP_TIMER_IDLE_RETURN_EVENT,
  type DesktopTimerIdleReturnDetail,
} from '@/lib/desktopTimerSession';

const mocks = vi.hoisted(() => ({
  resolveIdle: vi.fn(),
  stop: vi.fn(),
  idlePolicy: 'prompt' as string,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 7, name: 'A', role: 'employee' }, isAuthenticated: true }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ show: vi.fn() }),
}));

vi.mock('@/lib/trackerPolicy', () => ({
  resolveTrackerPolicy: () => ({ idle_resolution_policy: mocks.idlePolicy }),
}));

vi.mock('@/services/api', () => ({
  activityApi: { resolveIdle: mocks.resolveIdle },
  timeEntryApi: { stop: mocks.stop },
}));

/** The action callbacks the shell has registered, so a test can fire one. */
let popupActionListeners: Array<(payload: { action: string }) => void> = [];

const setNativeShell = () => {
  popupActionListeners = [];
  Object.defineProperty(window, 'desktopTracker', {
    configurable: true,
    writable: true,
    value: {
      showIdlePopup: vi.fn().mockResolvedValue(true),
      hideIdlePopup: vi.fn().mockResolvedValue(true),
      onIdlePopupAction: (callback: (payload: { action: string }) => void) => {
        popupActionListeners.push(callback);
        return () => {
          popupActionListeners = popupActionListeners.filter((entry) => entry !== callback);
        };
      },
    },
  });
};

const emitReturn = (detail: Partial<DesktopTimerIdleReturnDetail> = {}) => {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(DESKTOP_TIMER_IDLE_RETURN_EVENT, {
        detail: { userId: 7, activityId: 4242, idleSeconds: 720, timerRunning: true, ...detail },
      })
    );
  });
};

const firePopupAction = (action: string) => {
  act(() => {
    popupActionListeners.forEach((listener) => listener({ action }));
  });
};

beforeEach(() => {
  mocks.resolveIdle.mockReset().mockResolvedValue({ data: {} });
  mocks.stop.mockReset().mockResolvedValue({ data: {} });
  mocks.idlePolicy = 'prompt';
});

afterEach(() => {
  Object.defineProperty(window, 'desktopTracker', {
    configurable: true,
    writable: true,
    value: undefined,
  });
  document.body.innerHTML = '';
});

describe('IdleReturnPrompt on a shell with the native popup', () => {
  it('does not also open the in-app modal', () => {
    setNativeShell();
    render(<IdleReturnPrompt />);

    emitReturn();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('records "keep" answered in the popup against the right idle span', async () => {
    setNativeShell();
    render(<IdleReturnPrompt />);

    emitReturn({ activityId: 4242 });
    firePopupAction('keep');

    await waitFor(() => expect(mocks.resolveIdle).toHaveBeenCalledWith(4242, 'kept'));
  });

  it('records "discard" answered in the popup', async () => {
    setNativeShell();
    render(<IdleReturnPrompt />);

    emitReturn({ activityId: 88 });
    firePopupAction('discard');

    await waitFor(() => expect(mocks.resolveIdle).toHaveBeenCalledWith(88, 'discarded'));
  });

  it('takes the popup off screen once the answer is recorded', async () => {
    setNativeShell();
    render(<IdleReturnPrompt />);

    emitReturn();
    firePopupAction('keep');

    await waitFor(() =>
      expect(window.desktopTracker?.hideIdlePopup).toHaveBeenCalled()
    );
  });

  it('ignores a stray action when no idle span is waiting on an answer', async () => {
    setNativeShell();
    render(<IdleReturnPrompt />);

    // A dismiss of the "timer stopped" notice carries no activity to resolve.
    firePopupAction('dismiss');

    await Promise.resolve();
    expect(mocks.resolveIdle).not.toHaveBeenCalled();
  });

  it('answers only once when the shell delivers a duplicate click', async () => {
    setNativeShell();
    render(<IdleReturnPrompt />);

    emitReturn({ activityId: 51 });
    firePopupAction('keep');
    firePopupAction('keep');

    await waitFor(() => expect(mocks.resolveIdle).toHaveBeenCalledTimes(1));
  });
});

describe('IdleReturnPrompt without a native popup', () => {
  it('still opens the in-app modal on the web', () => {
    render(<IdleReturnPrompt />);

    emitReturn();

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
