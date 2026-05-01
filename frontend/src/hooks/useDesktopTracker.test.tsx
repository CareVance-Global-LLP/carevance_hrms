import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DESKTOP_TIMER_IDLE_STOP_EVENT } from '@/lib/desktopTimerSession';
import { idleTrackThresholdSeconds } from '@/lib/runtimeConfig';
import { useDesktopTracker } from '@/hooks/useDesktopTracker';

const mocks = vi.hoisted(() => ({
  activeMock: vi.fn(),
  stopMock: vi.fn(),
  createActivityMock: vi.fn(),
  updateActivityMock: vi.fn(),
  deleteActivityMock: vi.fn(),
  createActivitySessionMock: vi.fn(),
  updateActivitySessionMock: vi.fn(),
  syncBrowserTrackingConnectionsMock: vi.fn(),
  uploadScreenshotMock: vi.fn(),
  captureScreenshotMock: vi.fn(),
  getSystemIdleSecondsMock: vi.fn(),
  getActiveWindowContextMock: vi.fn(),
  revealWindowMock: vi.fn(),
  getDesktopDeviceIdentityMock: vi.fn(),
  authUser: {
    id: 1,
    name: 'Employee User',
    email: 'employee@example.com',
    role: 'employee',
    organization_id: 1,
    is_active: true,
    created_at: '',
    updated_at: '',
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mocks.authUser,
    isAuthenticated: true,
  }),
}));

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return {
    ...actual,
    timeEntryApi: {
      ...actual.timeEntryApi,
      active: mocks.activeMock,
      stop: mocks.stopMock,
    },
    activityApi: {
      ...actual.activityApi,
      create: mocks.createActivityMock,
      update: mocks.updateActivityMock,
      delete: mocks.deleteActivityMock,
    },
    activitySessionApi: {
      create: mocks.createActivitySessionMock,
      update: mocks.updateActivitySessionMock,
    },
    browserTrackingConnectionApi: {
      sync: mocks.syncBrowserTrackingConnectionsMock,
    },
    screenshotApi: {
      ...actual.screenshotApi,
      upload: mocks.uploadScreenshotMock,
    },
  };
});

function TrackerHarness() {
  useDesktopTracker();
  return null;
}

let foregroundWindowListeners: Array<(payload: {
  app: string | null;
  title: string | null;
  url: string | null;
  captured_at?: string;
}) => void> = [];
let systemLockStateListeners: Array<(payload: DesktopSystemLockState) => void> = [];
let browserTrackingStateListeners: Array<(payload: {
  ready: boolean;
  local_url?: string | null;
  connections: Array<{
    browser_name: string;
    profile_key: string;
    extension_origin?: string | null;
    last_seen_at?: string | null;
    extension_version?: string | null;
    paired_at?: string | null;
    user_id?: number | null;
  }>;
  pairing_code?: unknown;
  last_event_at?: string | null;
  last_error?: string | null;
}) => void> = [];
let browserTrackingListeners: Array<(payload: {
  kind: string;
  browser_name: string;
  profile_key: string;
  tab_id?: number | null;
  window_id?: number | null;
  url?: string | null;
  title?: string | null;
  recorded_at: string;
}) => void> = [];

describe('useDesktopTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T09:00:00Z'));
    sessionStorage.clear();
    localStorage.clear();

    mocks.authUser = {
      id: 1,
      name: 'Employee User',
      email: 'employee@example.com',
      role: 'employee',
      organization_id: 1,
      is_active: true,
      created_at: '',
      updated_at: '',
    };

    mocks.activeMock.mockResolvedValue({
      data: {
        id: 55,
        user_id: 1,
        start_time: '2026-03-18T09:00:00Z',
        duration: 0,
        timer_slot: 'primary',
      },
    });
    mocks.stopMock.mockResolvedValue({ data: null });
    let nextActivityId = 501;
    let nextActivitySessionId = 801;
    mocks.createActivityMock.mockImplementation(async () => ({ data: { id: nextActivityId += 1 } }));
    mocks.updateActivityMock.mockResolvedValue({ data: { id: 501 } });
    mocks.deleteActivityMock.mockResolvedValue({ data: { message: 'Activity deleted successfully' } });
    mocks.createActivitySessionMock.mockImplementation(async () => ({ data: { id: nextActivitySessionId += 1 } }));
    mocks.updateActivitySessionMock.mockResolvedValue({ data: { id: 801 } });
    mocks.syncBrowserTrackingConnectionsMock.mockResolvedValue({ data: { data: [] } });
    mocks.uploadScreenshotMock.mockResolvedValue({ data: { id: 1 } });
    mocks.captureScreenshotMock.mockResolvedValue(null);
    mocks.getSystemIdleSecondsMock.mockResolvedValue(0);
    mocks.getActiveWindowContextMock.mockResolvedValue({
      app: 'Visual Studio Code',
      title: 'Tracking Work',
      url: null,
    });
    mocks.revealWindowMock.mockResolvedValue(true);
    mocks.getDesktopDeviceIdentityMock.mockResolvedValue({
      device_id: 'desktop-alpha',
      device_label: 'DESKTOP-ALPHA',
    });
    foregroundWindowListeners = [];
    systemLockStateListeners = [];
    browserTrackingStateListeners = [];
    browserTrackingListeners = [];

    window.desktopTracker = {
      captureScreenshot: mocks.captureScreenshotMock,
      getSystemIdleSeconds: mocks.getSystemIdleSecondsMock,
      getActiveWindowContext: mocks.getActiveWindowContextMock,
      revealWindow: mocks.revealWindowMock,
      getDesktopDeviceIdentity: mocks.getDesktopDeviceIdentityMock,
      getBrowserTrackingState: vi.fn().mockResolvedValue({
        ready: true,
        local_url: 'http://127.0.0.1:38941',
        connections: [],
        pairing_code: null,
        last_event_at: null,
      }),
      onForegroundWindowChange: (callback) => {
        foregroundWindowListeners.push(callback);
        return () => {
          foregroundWindowListeners = foregroundWindowListeners.filter((listener) => listener !== callback);
        };
      },
      getSystemLockState: vi.fn().mockResolvedValue({
        state: 'unlocked',
        locked: false,
        locked_at: null,
        recorded_at: new Date().toISOString(),
      }),
      onSystemLockState: (callback) => {
        systemLockStateListeners.push(callback);
        return () => {
          systemLockStateListeners = systemLockStateListeners.filter((listener) => listener !== callback);
        };
      },
      onBrowserTrackingState: (callback) => {
        browserTrackingStateListeners.push(callback);
        return () => {
          browserTrackingStateListeners = browserTrackingStateListeners.filter((listener) => listener !== callback);
        };
      },
      onBrowserTrackingEvent: (callback) => {
        browserTrackingListeners.push(callback);
        return () => {
          browserTrackingListeners = browserTrackingListeners.filter((listener) => listener !== callback);
        };
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete window.desktopTracker;
  });

  it('stops the running timer after 5 minutes of idle time and raises the dashboard event', async () => {
    const idleSince = Date.now();
    mocks.getSystemIdleSecondsMock.mockImplementation(async () => Math.floor((Date.now() - idleSince) / 1000));
    const idleStopListener = vi.fn();
    window.addEventListener(DESKTOP_TIMER_IDLE_STOP_EVENT, idleStopListener as EventListener);

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });

    expect(mocks.deleteActivityMock).not.toHaveBeenCalled();
    expect(mocks.createActivityMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'idle',
      duration: 180,
    }));
    expect(
      mocks.updateActivityMock.mock.calls.some(([, payload]) => payload?.duration === 300)
    ).toBe(true);
    expect(mocks.stopMock).toHaveBeenCalledWith({
      timer_slot: 'primary',
      auto_stopped_for_idle: true,
      idle_seconds: 300,
      last_activity_at: '2026-03-18T09:00:00.000Z',
    });
    expect(sessionStorage.getItem('desktop_timer_auto_start_suppressed:1')).toBe('1');
    expect(sessionStorage.getItem('desktop_timer_idle_auto_stop_notice:1')).toBe(
      'You were idle for 5 minutes, so your timer was stopped.'
    );
    expect(idleStopListener).toHaveBeenCalledTimes(1);
    expect(mocks.revealWindowMock).toHaveBeenCalledTimes(1);

    window.removeEventListener(DESKTOP_TIMER_IDLE_STOP_EVENT, idleStopListener as EventListener);
  });

  it('does not stop the timer when recent real activity resets the continuous idle countdown', async () => {
    let lastSystemActivityAt = Date.now();
    mocks.getSystemIdleSecondsMock.mockImplementation(async () => Math.floor((Date.now() - lastSystemActivityAt) / 1000));
    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000 + 55 * 1000);
    });

    await act(async () => {
      lastSystemActivityAt = Date.now();
      window.dispatchEvent(new Event('scroll'));
      await vi.advanceTimersByTimeAsync(10 * 1000);
    });

    expect(mocks.stopMock).not.toHaveBeenCalled();
  });

  it('still auto-stops after 5 minutes when page events fire during true system idle', async () => {
    const idleSince = Date.now();
    mocks.getSystemIdleSecondsMock.mockImplementation(async () => Math.floor((Date.now() - idleSince) / 1000));

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000 + 55 * 1000);
    });

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(10 * 1000);
    });

    expect(mocks.stopMock).toHaveBeenCalledWith({
      timer_slot: 'primary',
      auto_stopped_for_idle: true,
      idle_seconds: 300,
      last_activity_at: '2026-03-18T09:00:00.000Z',
    });
  });

  it('auto-stops from the lock-screen signal even when system idle seconds are not advancing', async () => {
    mocks.getSystemIdleSecondsMock.mockResolvedValue(0);
    render(<TrackerHarness />);

    await act(async () => {
      systemLockStateListeners[0]?.({
        state: 'locked',
        locked: true,
        locked_at: '2026-03-18T09:00:00.000Z',
        recorded_at: '2026-03-18T09:00:00.000Z',
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });

    expect(mocks.stopMock).toHaveBeenCalledWith({
      timer_slot: 'primary',
      auto_stopped_for_idle: true,
      idle_seconds: 300,
      last_activity_at: '2026-03-18T09:00:00.000Z',
    });
    expect(mocks.createActivityMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'idle',
      name: 'System Idle - Locked Screen',
    }));
  });

  it('uses the 1 second idle guard so auto-stop does not wait for the next 5 second activity tick', async () => {
    const idleSince = Date.now() - 2000;
    mocks.getSystemIdleSecondsMock.mockImplementation(async () => Math.floor((Date.now() - idleSince) / 1000));

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000 + 57 * 1000);
    });

    expect(mocks.stopMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(
      mocks.updateActivityMock.mock.calls.some(([, payload]) => payload?.duration === 300)
    ).toBe(true);
    expect(mocks.stopMock).toHaveBeenCalledWith({
      timer_slot: 'primary',
      auto_stopped_for_idle: true,
      idle_seconds: 300,
      last_activity_at: '2026-03-18T08:59:58.000Z',
    });
  });

  it('backs off idle auto-stop retries when backend returns 409 with retry_after_seconds', async () => {
    const idleSince = Date.now();
    mocks.getSystemIdleSecondsMock.mockImplementation(async () => Math.floor((Date.now() - idleSince) / 1000));
    mocks.stopMock
      .mockRejectedValueOnce({
        response: {
          status: 409,
          data: {
            retry_after_seconds: 20,
          },
        },
      })
      .mockResolvedValue({ data: null });

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });

    expect(mocks.stopMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 1000);
    });

    expect(mocks.stopMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 1000);
    });

    expect(mocks.stopMock).toHaveBeenCalledTimes(2);
  });

  it('captures screenshots on the single 3 minute interval while the timer is running', async () => {
    mocks.captureScreenshotMock.mockResolvedValue('data:image/png;base64,ZmFrZQ==');

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
    });

    expect(mocks.captureScreenshotMock).toHaveBeenCalledTimes(1);
    expect(mocks.uploadScreenshotMock).toHaveBeenCalledTimes(1);
    expect(mocks.uploadScreenshotMock).toHaveBeenNthCalledWith(
      1,
      55,
      'data:image/png;base64,ZmFrZQ==',
      expect.stringMatching(/^capture-\d+\.png$/)
    );
  });

  it('uses the invited user monitoring interval for screenshot captures', async () => {
    mocks.authUser = {
      ...mocks.authUser,
      settings: {
        monitoring_interval_minutes: 1,
      },
    };
    mocks.captureScreenshotMock.mockResolvedValue('data:image/png;base64,ZmFrZQ==');

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 1000);
    });

    expect(mocks.captureScreenshotMock).toHaveBeenCalledTimes(1);
    expect(mocks.uploadScreenshotMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a separate 5 minute screenshot interval for another invited user', async () => {
    mocks.authUser = {
      ...mocks.authUser,
      id: 2,
      email: 'employee-two@example.com',
      settings: {
        monitoring_interval_minutes: 5,
      },
    };
    mocks.captureScreenshotMock.mockResolvedValue('data:image/png;base64,ZmFrZQ==');

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 1000);
    });

    expect(mocks.captureScreenshotMock).toHaveBeenCalledTimes(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    });

    expect(mocks.captureScreenshotMock).toHaveBeenCalledTimes(1);
    expect(mocks.uploadScreenshotMock).toHaveBeenCalledTimes(1);
  });

  it('continues screenshot capture when the user is idle at the screenshot interval', async () => {
    const idleSince = Date.now();
    mocks.captureScreenshotMock.mockResolvedValue('data:image/png;base64,ZmFrZQ==');
    mocks.getSystemIdleSecondsMock.mockImplementation(async () => Math.floor((Date.now() - idleSince) / 1000));

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
    });

    expect(mocks.captureScreenshotMock).toHaveBeenCalledTimes(1);
    expect(mocks.uploadScreenshotMock).toHaveBeenCalledTimes(1);
    expect(mocks.uploadScreenshotMock).toHaveBeenNthCalledWith(
      1,
      55,
      'data:image/png;base64,ZmFrZQ==',
      expect.stringMatching(/^capture-\d+\.png$/)
    );
  });

  it('clears and recreates the screenshot interval cleanly on remount without duplicating captures', async () => {
    mocks.captureScreenshotMock.mockResolvedValue('data:image/png;base64,ZmFrZQ==');

    const firstRender = render(<TrackerHarness />);
    firstRender.unmount();

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
    });

    expect(mocks.captureScreenshotMock).toHaveBeenCalledTimes(1);
    expect(mocks.uploadScreenshotMock).toHaveBeenCalledTimes(1);
  });

  it('recovers future screenshots when one screenshot capture call hangs', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let captureCallCount = 0;
    mocks.captureScreenshotMock.mockImplementation(() => {
      captureCallCount += 1;

      if (captureCallCount === 1) {
        return new Promise(() => {});
      }

      return Promise.resolve('data:image/png;base64,ZmFrZQ==');
    });

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
    });

    expect(mocks.captureScreenshotMock).toHaveBeenCalledTimes(1);
    expect(mocks.uploadScreenshotMock).toHaveBeenCalledTimes(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 1000);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
    });

    expect(mocks.captureScreenshotMock).toHaveBeenCalledTimes(2);
    expect(mocks.uploadScreenshotMock).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });

  it('tracks browser activity duration from system-wide input even when the app window is not focused', async () => {
    mocks.getActiveWindowContextMock.mockResolvedValue({
      app: 'Google Chrome',
      title: 'Instagram - Google Chrome',
      url: null,
    });
    mocks.getSystemIdleSecondsMock.mockResolvedValue(0);

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1 * 1000);
    });

    expect(mocks.createActivityMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'url',
      name: 'Instagram',
      duration: 1,
    }));
  });

  it('starts a desktop activity session when a non-browser foreground-window change event arrives', async () => {
    render(<TrackerHarness />);

    await act(async () => {
      foregroundWindowListeners[0]?.({
        app: 'Visual Studio Code',
        title: 'Tracking Work',
        url: null,
        captured_at: '2026-04-21T09:00:00.000Z',
      });
    });

    expect(mocks.createActivitySessionMock).toHaveBeenCalledWith(expect.objectContaining({
      display_name: 'Visual Studio Code',
      app_name: 'Visual Studio Code',
      window_title: 'Tracking Work',
      started_at: '2026-04-21T09:00:00.000Z',
    }));
  });

  it('switches to a new desktop app during polling recovery even when a desktop session is already active', async () => {
    mocks.getActiveWindowContextMock
      .mockResolvedValueOnce({
        app: 'Visual Studio Code',
        title: 'Tracking Work',
        url: null,
      })
      .mockResolvedValueOnce({
        app: 'Notepad',
        title: 'notes.txt - Notepad',
        url: null,
      });

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 1000);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 1000);
    });

    expect(mocks.createActivitySessionMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      display_name: 'Visual Studio Code',
      app_name: 'Visual Studio Code',
    }));
    expect(mocks.updateActivitySessionMock).toHaveBeenCalledWith(802, expect.objectContaining({
      ended_at: expect.any(String),
      duration_seconds: expect.any(Number),
    }));
    expect(mocks.createActivitySessionMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      display_name: 'Notepad',
      app_name: 'Notepad',
      window_title: 'notes.txt - Notepad',
    }));
  });

  it('prefers the explorer window title for file explorer foreground sessions', async () => {
    render(<TrackerHarness />);

    await act(async () => {
      foregroundWindowListeners[0]?.({
        app: 'Windows Explorer',
        title: 'This PC',
        url: null,
        captured_at: '2026-04-22T11:14:04.000Z',
      });
    });

    expect(mocks.createActivitySessionMock).toHaveBeenCalledWith(expect.objectContaining({
      display_name: 'This PC',
      app_name: 'Windows Explorer',
      window_title: 'This PC',
    }));
  });

  it('does not create a desktop app session when the foreground browser window is the CareVance localhost app', async () => {
    render(<TrackerHarness />);
    await act(async () => {});
    mocks.createActivitySessionMock.mockClear();

    await act(async () => {
      foregroundWindowListeners[0]?.({
        app: 'Brave',
        title: 'CareVance HRMS Workspace',
        url: 'http://localhost:5173/reports/timeline',
        captured_at: '2026-04-22T11:14:28.000Z',
      });
    });

    expect(mocks.createActivitySessionMock).not.toHaveBeenCalled();
  });

  it('closes the active desktop activity session when focus switches to a browser window', async () => {
    mocks.createActivitySessionMock.mockResolvedValueOnce({ data: { id: 901 } });

    render(<TrackerHarness />);

    await act(async () => {
      foregroundWindowListeners[0]?.({
        app: 'Visual Studio Code',
        title: 'Tracking Work',
        url: null,
        captured_at: '2026-04-21T09:00:00.000Z',
      });
    });

    await act(async () => {
      foregroundWindowListeners[0]?.({
        app: 'Google Chrome',
        title: 'GitHub - Google Chrome',
        url: 'https://github.com/openai/codex',
        captured_at: '2026-04-21T09:07:00.000Z',
      });
    });

    expect(mocks.updateActivitySessionMock).toHaveBeenCalledWith(901, expect.objectContaining({
      ended_at: '2026-04-21T09:07:00.000Z',
      duration_seconds: 420,
    }));
  });

  it('flushes active desktop and browser sessions immediately when logout requests a tracker flush', async () => {
    mocks.createActivitySessionMock
      .mockResolvedValueOnce({ data: { id: 1501 } })
      .mockResolvedValueOnce({ data: { id: 1502 } });

    render(<TrackerHarness />);

    await act(async () => {
      foregroundWindowListeners[0]?.({
        app: 'Visual Studio Code',
        title: 'Tracking Work',
        url: null,
        captured_at: '2026-04-21T09:00:00.000Z',
      });
    });

    await act(async () => {
      browserTrackingListeners[0]?.({
        kind: 'tab-focused',
        browser_name: 'chrome',
        profile_key: 'profile-a',
        tab_id: 91,
        window_id: 5,
        url: 'https://example.com',
        title: 'Example',
        recorded_at: '2026-04-21T09:00:05.000Z',
      });
    });

    const flushDetail: { promise?: Promise<void> } = {};

    await act(async () => {
      window.dispatchEvent(new CustomEvent('desktop-tracker:flush', { detail: flushDetail }));
      await flushDetail.promise;
    });

    expect(mocks.updateActivitySessionMock).toHaveBeenCalledWith(1502, expect.objectContaining({
      ended_at: expect.any(String),
      duration_seconds: expect.any(Number),
    }));
  });

  it('reuses the last reliable external context when active window lookup temporarily falls back to the app shell', async () => {
    document.title = 'CareVance HRMS Workspace';
    mocks.getActiveWindowContextMock
      .mockResolvedValueOnce({
        app: 'Google Chrome',
        title: 'GitHub - Google Chrome',
        url: null,
      })
      .mockResolvedValueOnce({
        app: 'CareVance',
        title: 'CareVance HRMS Workspace',
        url: null,
      });

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 1000);
    });

    expect(mocks.createActivityMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'url',
      name: 'GitHub',
      duration: 1,
    }));
    expect(mocks.createActivityMock).not.toHaveBeenCalledWith(expect.objectContaining({
      name: 'CareVance HRMS Workspace',
    }));
  });

  it('does not create misleading self-tracker activity rows before a reliable external context exists', async () => {
    document.title = 'CareVance HRMS Workspace';
    mocks.getActiveWindowContextMock.mockResolvedValue(null);

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 1000);
    });

    expect(mocks.createActivityMock).not.toHaveBeenCalledWith(expect.objectContaining({
      name: 'CareVance HRMS Workspace',
    }));
  });

  it('caps buffered self-shell time so the next resolved website is not heavily inflated', async () => {
    document.title = 'CareVance HRMS Workspace';
    mocks.getActiveWindowContextMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        app: 'Google Chrome',
        title: 'ChatGPT - Google Chrome',
        url: null,
      });

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 1000);
    });

    expect(mocks.createActivityMock).not.toHaveBeenCalledWith(expect.objectContaining({
      name: 'CareVance HRMS Workspace',
    }));
    expect(
      mocks.createActivityMock.mock.calls.some(
        ([payload]) => payload?.type === 'url' && payload?.name === 'ChatGPT' && Number(payload?.duration ?? 0) <= 2,
      ),
    ).toBe(true);
  });

  it('reuses the last reliable website context when the browser briefly reports a generic new tab', async () => {
    mocks.getActiveWindowContextMock
      .mockResolvedValueOnce({
        app: 'Google Chrome',
        title: 'YouTube - Google Chrome',
        url: null,
      })
      .mockResolvedValueOnce({
        app: 'Google Chrome',
        title: 'New Tab - Google Chrome',
        url: null,
      });

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 1000);
    });

    expect(mocks.createActivityMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'url',
      name: 'YouTube',
      duration: 1,
    }));
    expect(mocks.createActivityMock).not.toHaveBeenCalledWith(expect.objectContaining({
      name: 'New Tab',
    }));
  });

  it('stops reusing the last website context after the generic browser fallback window expires', async () => {
    mocks.getActiveWindowContextMock
      .mockResolvedValueOnce({
        app: 'Google Chrome',
        title: 'Instagram - Google Chrome',
        url: null,
      })
      .mockResolvedValue({
        app: 'Google Chrome',
        title: 'New Tab - Google Chrome',
        url: null,
      });

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 1000);
    });

    const trackedDurations = mocks.updateActivityMock.mock.calls
      .map(([, payload]) => Number(payload?.duration ?? 0))
      .filter((duration) => Number.isFinite(duration));

    expect(mocks.createActivityMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'url',
      name: 'Instagram',
      duration: 1,
    }));
    expect(Math.max(...trackedDurations)).toBe(2);
    expect(trackedDurations).not.toContain(3);
    expect(mocks.createActivityMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'url',
      name: 'browser activity',
      duration: 1,
    }));
  });

  it('stops reusing the active desktop app segment after the self-shell fallback window expires', async () => {
    document.title = 'CareVance HRMS Workspace';
    mocks.getActiveWindowContextMock
      .mockResolvedValueOnce({
        app: 'Codex',
        title: 'Codex',
        url: null,
      })
      .mockResolvedValue({
        app: 'CareVance',
        title: 'CareVance HRMS Workspace',
        url: null,
      });

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 1000);
    });

    expect(mocks.createActivitySessionMock).toHaveBeenCalledWith(expect.objectContaining({
      display_name: 'Codex',
      app_name: 'Codex',
      window_title: 'Codex',
    }));
    expect(mocks.createActivityMock).not.toHaveBeenCalled();
    expect(mocks.createActivityMock).not.toHaveBeenCalledWith(expect.objectContaining({
      name: 'CareVance HRMS Workspace',
    }));
  });

  it('opens an exact website session from browser extension events and closes it on url change', async () => {
    mocks.createActivitySessionMock
      .mockResolvedValueOnce({ data: { id: 1101 } })
      .mockResolvedValueOnce({ data: { id: 1102 } });

    render(<TrackerHarness />);

    await act(async () => {
      browserTrackingListeners[0]?.({
        kind: 'tab-focused',
        browser_name: 'chrome',
        profile_key: 'profile-a',
        tab_id: 91,
        window_id: 5,
        url: 'https://gemini.google.com/app',
        title: 'Gemini',
        recorded_at: '2026-04-21T11:28:54.000Z',
      });
    });

    expect(mocks.createActivitySessionMock).toHaveBeenCalledWith(expect.objectContaining({
      source: 'browser_extension',
      activity_kind: 'website',
      tool_type: 'website',
      display_name: 'Gemini',
      app_name: 'chrome',
      url: 'https://gemini.google.com/app',
      started_at: '2026-04-21T11:28:54.000Z',
      metadata: expect.objectContaining({
        profile_key: 'profile-a',
        tab_id: 91,
        window_id: 5,
      }),
    }));

    await act(async () => {
      browserTrackingListeners[0]?.({
        kind: 'tab-updated',
        browser_name: 'chrome',
        profile_key: 'profile-a',
        tab_id: 91,
        window_id: 5,
        url: 'https://chat.openai.com/',
        title: 'ChatGPT',
        recorded_at: '2026-04-21T11:29:05.000Z',
      });
    });

    expect(mocks.updateActivitySessionMock).toHaveBeenCalledWith(1101, expect.objectContaining({
      ended_at: '2026-04-21T11:29:05.000Z',
      duration_seconds: 11,
    }));
    expect(mocks.createActivitySessionMock).toHaveBeenLastCalledWith(expect.objectContaining({
      source: 'browser_extension',
      activity_kind: 'website',
      tool_type: 'website',
      display_name: 'ChatGPT',
      app_name: 'chrome',
      url: 'https://chat.openai.com/',
      started_at: '2026-04-21T11:29:05.000Z',
    }));
  });

  it('tracks exact browser events coming from the CareVance localhost app itself', async () => {
    render(<TrackerHarness />);
    mocks.createActivitySessionMock.mockClear();

    await act(async () => {
      browserTrackingListeners[0]?.({
        kind: 'tab-focused',
        browser_name: 'chrome',
        profile_key: 'profile-a',
        tab_id: 91,
        window_id: 5,
        url: 'http://localhost:5173/reports/timeline',
        title: 'CareVance HRMS Workspace',
        recorded_at: '2026-04-22T11:14:28.000Z',
      });
    });

    expect(mocks.createActivitySessionMock).toHaveBeenCalledWith(expect.objectContaining({
      source: 'browser_extension',
      activity_kind: 'website',
      tool_type: 'website',
      display_name: 'CareVance HRMS Workspace',
      app_name: 'chrome',
      url: 'http://localhost:5173/reports/timeline',
    }));
  });

  it('closes the active exact browser session on browser focus loss', async () => {
    mocks.createActivitySessionMock.mockResolvedValueOnce({ data: { id: 1201 } });

    render(<TrackerHarness />);

    await act(async () => {
      browserTrackingListeners[0]?.({
        kind: 'tab-focused',
        browser_name: 'chrome',
        profile_key: 'profile-a',
        tab_id: 91,
        window_id: 5,
        url: 'https://gemini.google.com/app',
        title: 'Gemini',
        recorded_at: '2026-04-21T11:28:54.000Z',
      });
    });

    await act(async () => {
      browserTrackingListeners[0]?.({
        kind: 'window-blurred',
        browser_name: 'chrome',
        profile_key: 'profile-a',
        window_id: 5,
        recorded_at: '2026-04-21T11:29:10.000Z',
      });
    });

    expect(mocks.updateActivitySessionMock).toHaveBeenCalledWith(1201, expect.objectContaining({
      ended_at: '2026-04-21T11:29:10.000Z',
      duration_seconds: 16,
    }));
  });

  it('closes the active exact browser session when the user becomes idle', async () => {
    mocks.createActivitySessionMock.mockResolvedValueOnce({ data: { id: 1301 } });
    mocks.getActiveWindowContextMock.mockResolvedValue({
      app: 'Google Chrome',
      title: 'Gemini - Google Chrome',
      url: null,
    });

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 1000);
    });

    const lastSystemActivityAt = Date.now();
    mocks.getSystemIdleSecondsMock.mockImplementation(async () => Math.floor((Date.now() - lastSystemActivityAt) / 1000));

    await act(async () => {
      browserTrackingListeners[0]?.({
        kind: 'tab-focused',
        browser_name: 'chrome',
        profile_key: 'profile-a',
        tab_id: 91,
        window_id: 5,
        url: 'https://gemini.google.com/app',
        title: 'Gemini',
        recorded_at: new Date(lastSystemActivityAt).toISOString(),
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(idleTrackThresholdSeconds * 1000);
    });

    expect(mocks.updateActivitySessionMock).toHaveBeenCalledWith(1301, expect.objectContaining({
      ended_at: new Date(lastSystemActivityAt).toISOString(),
      duration_seconds: 0,
    }));
  });

  it('does not create legacy sampled browser rows while exact browser tracking is healthy', async () => {
    render(<TrackerHarness />);

    await act(async () => {
      browserTrackingListeners[0]?.({
        kind: 'tab-focused',
        browser_name: 'chrome',
        profile_key: 'profile-a',
        tab_id: 91,
        window_id: 5,
        url: 'https://gemini.google.com/app',
        title: 'Gemini',
        recorded_at: '2026-04-21T11:28:54.000Z',
      });
    });

    mocks.createActivityMock.mockClear();
    mocks.updateActivityMock.mockClear();
    mocks.getActiveWindowContextMock.mockResolvedValue({
      app: 'Google Chrome',
      title: 'Gemini - Google Chrome',
      url: null,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 1000);
    });

    expect(mocks.createActivityMock).not.toHaveBeenCalled();
    expect(mocks.updateActivityMock).not.toHaveBeenCalled();
  });

  it('keeps legacy sampled browser tracking for unsupported browsers even when Chromium exact tracking is healthy', async () => {
    window.desktopTracker = {
      ...window.desktopTracker,
      getDesktopDeviceIdentity: mocks.getDesktopDeviceIdentityMock,
      getBrowserTrackingState: vi.fn().mockResolvedValue({
        ready: true,
        local_url: 'http://127.0.0.1:38941',
        connections: [
          {
            browser_name: 'chrome',
            profile_key: 'profile-a',
            last_seen_at: '2026-03-18T09:00:00.000Z',
          },
        ],
        pairing_code: null,
        last_event_at: '2026-03-18T09:00:00.000Z',
      }),
    };
    mocks.getActiveWindowContextMock.mockResolvedValue({
      app: 'Mozilla Firefox',
      title: 'YouTube - Mozilla Firefox',
      url: null,
    });

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1 * 1000);
    });

    expect(mocks.createActivityMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'url',
      name: 'YouTube',
      duration: 1,
    }));
  });

  it('syncs browser tracking health to the backend with desktop identity metadata', async () => {
    render(<TrackerHarness />);

    await act(async () => {
      browserTrackingStateListeners[0]?.({
        ready: true,
        local_url: 'http://127.0.0.1:38941',
        connections: [
          {
            browser_name: 'chrome',
            profile_key: 'profile-a',
            extension_origin: 'chrome-extension://tracking',
            extension_version: '0.1.0',
            paired_at: '2026-04-21T11:20:00.000Z',
            last_seen_at: '2026-04-21T11:28:54.000Z',
          },
        ],
        pairing_code: null,
        last_event_at: '2026-04-21T11:28:54.000Z',
        last_error: null,
      });
      await vi.advanceTimersByTimeAsync(5 * 1000);
    });

    expect(mocks.syncBrowserTrackingConnectionsMock).toHaveBeenCalledWith({
      device_id: 'desktop-alpha',
      device_label: 'DESKTOP-ALPHA',
      ready: true,
      last_error: null,
      last_event_at: '2026-04-21T11:28:54.000Z',
      connections: [
        {
          browser_name: 'chrome',
          profile_key: 'profile-a',
          extension_origin: 'chrome-extension://tracking',
          extension_version: '0.1.0',
          paired_at: '2026-04-21T11:20:00.000Z',
          last_seen_at: '2026-04-21T11:28:54.000Z',
        },
      ],
    });
  });

  it('closes the active exact browser session when browser tracking health degrades', async () => {
    mocks.createActivitySessionMock.mockResolvedValueOnce({ data: { id: 1401 } });

    render(<TrackerHarness />);

    await act(async () => {
      browserTrackingListeners[0]?.({
        kind: 'tab-focused',
        browser_name: 'chrome',
        profile_key: 'profile-a',
        tab_id: 91,
        window_id: 5,
        url: 'https://gemini.google.com/app',
        title: 'Gemini',
        recorded_at: '2026-04-21T11:28:54.000Z',
      });
    });

    await act(async () => {
      browserTrackingStateListeners[0]?.({
        ready: true,
        local_url: 'http://127.0.0.1:38941',
        connections: [],
        pairing_code: null,
        last_event_at: '2026-04-21T11:29:10.000Z',
        last_error: null,
      });
    });

    expect(mocks.updateActivitySessionMock).toHaveBeenCalledWith(1401, expect.objectContaining({
      ended_at: '2026-04-21T11:29:10.000Z',
      duration_seconds: 16,
    }));
  });
});
