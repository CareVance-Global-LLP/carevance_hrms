import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DesktopBrowserTrackingPanel from '@/components/desktop/DesktopBrowserTrackingPanel';
import { renderWithProviders } from '@/test/renderWithProviders';

const authState = vi.hoisted(() => ({
  value: {
    user: {
      id: 42,
      name: 'Employee',
      email: 'employee@example.com',
      role: 'employee',
      organization_id: 1,
      is_active: true,
      created_at: '',
      updated_at: '',
    },
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authState.value,
}));

describe('DesktopBrowserTrackingPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete window.desktopTracker;
  });

  it('shows browser connection status, generates a Chrome pairing code for the current user, and unsubscribes on unmount', async () => {
    let browserTrackingListener: ((state: BrowserTrackingState) => void) | undefined;
    const unsubscribe = vi.fn();
    const openBrowserTrackingGuide = vi.fn().mockResolvedValue(true);
    const openBrowserTrackingInstall = vi.fn().mockResolvedValue(true);
    const openBrowserTrackingOptions = vi.fn().mockResolvedValue(true);
    const createBrowserTrackingPairingCode = vi.fn().mockResolvedValue({
      value: 'PAIR-1234',
      expires_at: '2026-05-21T12:05:00.000Z',
    });

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
      openBrowserTrackingInstall,
      openBrowserTrackingOptions,
      openBrowserTrackingGuide,
      createBrowserTrackingPairingCode,
      onBrowserTrackingState: vi.fn((callback) => {
        browserTrackingListener = callback;
        return unsubscribe;
      }),
      clearBrowserTrackingStateListeners: vi.fn(),
    };

    const { unmount } = renderWithProviders(<DesktopBrowserTrackingPanel />);

    expect((await screen.findAllByText(/extension not connected yet/i)).length).toBeGreaterThan(0);
    expect(screen.getByText(/127.0.0.1:43841/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /install in chrome/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /install in edge/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open local extension folder/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /install in chrome/i }));

    expect(openBrowserTrackingInstall).toHaveBeenCalledWith({
      browser_name: 'chrome',
    });

    await userEvent.click(screen.getByRole('button', { name: /open local extension folder/i }));

    expect(openBrowserTrackingGuide).toHaveBeenCalledWith({
      browser_name: 'chrome',
    });

    await userEvent.click(screen.getByRole('button', { name: /generate pairing code/i }));

    await waitFor(() => {
      expect(createBrowserTrackingPairingCode).toHaveBeenCalledWith({
        browser_name: 'chrome',
        user_id: 42,
      });
    });

    browserTrackingListener?.({
      ready: true,
      local_url: 'http://127.0.0.1:43841',
      connections: [],
      pairing_code: {
        value: 'PAIR-1234',
        expires_at: '2026-05-21T12:05:00.000Z',
        user_id: 42,
      },
      last_event_at: null,
      last_error: null,
    });

    await waitFor(() => {
      expect(screen.getByText(/PAIR-1234/i)).toBeInTheDocument();
      expect(screen.getByText(/expires/i)).toBeInTheDocument();
    });

    browserTrackingListener?.({
      ready: true,
      local_url: 'http://127.0.0.1:43841',
      connections: [
        {
          browser_name: 'chrome',
          profile_key: 'Profile 1',
          extension_origin: 'chrome-extension://abc123',
          extension_version: '1.2.3',
          paired_at: '2026-04-21T12:00:00.000Z',
          last_seen_at: '2026-04-21T12:04:30.000Z',
          user_id: 42,
        },
      ],
      pairing_code: {
        value: 'PAIR-1234',
        expires_at: '2026-05-21T12:05:00.000Z',
      },
      last_event_at: '2026-04-21T12:04:30.000Z',
      last_error: null,
    });

    expect((await screen.findAllByText(/chrome connected/i)).length).toBeGreaterThan(0);
    expect(screen.getByText(/profile 1/i)).toBeInTheDocument();
    expect(screen.getByText(/1.2.3/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /reconnect \/ manage extension/i }));

    expect(openBrowserTrackingOptions).toHaveBeenCalledWith({
      extension_origin: 'chrome-extension://abc123',
    });

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
