import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDesktopBrowserTracking } from '@/hooks/useDesktopBrowserTracking';

function HookHarness({ userId }: { userId: number | null }) {
  const { state, createPairingCode } = useDesktopBrowserTracking(userId);

  return (
    <div>
      <div data-testid="local-url">{state.local_url || 'none'}</div>
      <div data-testid="connections">{state.connections.length}</div>
      <div data-testid="pairing">{state.pairing_code?.value || 'none'}</div>
      <button type="button" onClick={() => void createPairingCode('chrome')}>
        create pairing
      </button>
    </div>
  );
}

describe('useDesktopBrowserTracking', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    delete window.desktopTracker;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('filters browser tracking state to the signed-in user and refreshes when the user changes', async () => {
    const getBrowserTrackingState = vi.fn().mockResolvedValue({
      ready: true,
      local_url: 'http://127.0.0.1:43841',
      connections: [
        {
          browser_name: 'chrome',
          profile_key: 'Profile 7',
          extension_origin: 'chrome-extension://abc123',
          extension_version: '1.2.3',
          paired_at: '2026-04-21T12:00:00.000Z',
          last_seen_at: '2026-04-21T12:04:30.000Z',
          user_id: 7,
        },
      ],
      pairing_code: {
        value: 'PAIR-OLD',
        expires_at: '2026-04-21T12:05:00.000Z',
        user_id: 7,
      },
      last_event_at: '2026-04-21T12:04:30.000Z',
      last_error: null,
    });

    window.desktopTracker = {
      captureScreenshot: vi.fn(),
      getSystemIdleSeconds: vi.fn(),
      getActiveWindowContext: vi.fn(),
      revealWindow: vi.fn(),
      getBrowserTrackingState,
      onBrowserTrackingState: vi.fn(() => undefined),
    };

    const { rerender } = render(<HookHarness userId={42} />);

    await waitFor(() => {
      expect(screen.getByTestId('local-url')).toHaveTextContent('127.0.0.1:43841');
    });

    expect(screen.getByTestId('connections')).toHaveTextContent('0');
    expect(screen.getByTestId('pairing')).toHaveTextContent('none');

    rerender(<HookHarness userId={7} />);

    await waitFor(() => {
      expect(getBrowserTrackingState).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(screen.getByTestId('connections')).toHaveTextContent('1');
    });
    expect(screen.getByTestId('pairing')).toHaveTextContent('PAIR-OLD');
  });

  it('clears an expired pairing code after it ages out', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T12:00:00.000Z'));

    window.desktopTracker = {
      captureScreenshot: vi.fn(),
      getSystemIdleSeconds: vi.fn(),
      getActiveWindowContext: vi.fn(),
      revealWindow: vi.fn(),
      getBrowserTrackingState: vi.fn().mockResolvedValue({
        ready: true,
        local_url: 'http://127.0.0.1:43841',
        connections: [],
        pairing_code: {
          value: 'PAIR-LIVE',
          expires_at: '2026-04-21T12:01:00.000Z',
          user_id: 42,
        },
        last_event_at: null,
        last_error: null,
      }),
      onBrowserTrackingState: vi.fn(() => undefined),
    };

    render(<HookHarness userId={42} />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('pairing')).toHaveTextContent('PAIR-LIVE');

    await act(async () => {
      vi.setSystemTime(new Date('2026-04-21T12:01:01.000Z'));
      vi.advanceTimersByTime(61_001);
    });

    expect(screen.getByTestId('pairing')).toHaveTextContent('none');
  });

  it('ignores an in-flight pairing code response after the signed-in user changes', async () => {
    let resolvePairingCode;
    const createBrowserTrackingPairingCode = vi.fn().mockImplementation(
      () => new Promise((resolve) => {
        resolvePairingCode = resolve;
      })
    );

    window.desktopTracker = {
      captureScreenshot: vi.fn(),
      getSystemIdleSeconds: vi.fn(),
      getActiveWindowContext: vi.fn(),
      revealWindow: vi.fn(),
      getBrowserTrackingState: vi.fn().mockResolvedValue({
        ready: true,
        local_url: 'http://127.0.0.1:43841',
        connections: [],
        pairing_code: null,
        last_event_at: null,
        last_error: null,
      }),
      createBrowserTrackingPairingCode,
      onBrowserTrackingState: vi.fn(() => undefined),
    };

    const { rerender } = render(<HookHarness userId={42} />);

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      screen.getByRole('button', { name: /create pairing/i }).click();
    });

    rerender(<HookHarness userId={7} />);

    await act(async () => {
      resolvePairingCode?.({
        value: 'PAIR-42',
        expires_at: '2026-04-21T12:05:00.000Z',
      });
      await Promise.resolve();
    });

    expect(screen.getByTestId('pairing')).toHaveTextContent('none');
  });
});
