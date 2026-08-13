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

/**
 * Capture cadence is jittered by +/-10% so screenshots are not perfectly
 * predictable, which means a period is somewhere in [0.9x, 1.1x]. Advancing by
 * the maximum guarantees exactly one tick fired: two would need 1.8x.
 */
const oneCapturePeriod = (intervalMs: number) => Math.ceil(intervalMs * 1.1);

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
    mocks.captureScreenshotMock.mockResolvedValue({ ok: true, dataUrl: 'data:image/png;base64,ZmFrZQ==' });
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
      getSystemLockState: vi.fn().mockResolvedValue({
        state: 'unlocked',
        locked: false,
        locked_at: null,
        recorded_at: new Date().toISOString(),
      }),
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

  it('does not auto-stop immediately on lock-screen — relies on idle auto-stop after 5 minutes', async () => {
    const idleSince = Date.now();
    mocks.getSystemIdleSecondsMock.mockImplementation(async () => Math.floor((Date.now() - idleSince) / 1000));

    render(<TrackerHarness />);

    await act(async () => {
      systemLockStateListeners[0]?.({
        state: 'locked',
        locked: true,
        locked_at: '2026-03-18T09:00:00.000Z',
        recorded_at: '2026-03-18T09:00:00.000Z',
      });
    });

    expect(mocks.stopMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });

    expect(mocks.stopMock).toHaveBeenCalledWith({
      timer_slot: 'primary',
      auto_stopped_for_idle: true,
      idle_seconds: 300,
      last_activity_at: '2026-03-18T09:00:00.000Z',
    });
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

  it('captures screenshots on the default 10 minute interval while the timer is running', async () => {
    mocks.captureScreenshotMock.mockResolvedValue({ ok: true, dataUrl: 'data:image/png;base64,ZmFrZQ==' });

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(oneCapturePeriod(10 * 60 * 1000));
    });

    // One immediate capture when the interval starts, plus one at the tick.
    expect(mocks.captureScreenshotMock).toHaveBeenCalledTimes(2);
    expect(mocks.uploadScreenshotMock).toHaveBeenCalledTimes(2);
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
    mocks.captureScreenshotMock.mockResolvedValue({ ok: true, dataUrl: 'data:image/png;base64,ZmFrZQ==' });

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(oneCapturePeriod(60 * 1000));
    });

    // Immediate capture on start + one at the 60s tick.
    expect(mocks.captureScreenshotMock).toHaveBeenCalledTimes(2);
    expect(mocks.uploadScreenshotMock).toHaveBeenCalledTimes(2);
  });

  it('prefers the server-resolved effective interval over the raw per-user setting', async () => {
    mocks.authUser = {
      ...mocks.authUser,
      settings: {
        // Stale cached override; the server-resolved value wins.
        monitoring_interval_minutes: 30,
      },
      effective_monitoring_interval_minutes: 1,
    };
    mocks.captureScreenshotMock.mockResolvedValue({ ok: true, dataUrl: 'data:image/png;base64,ZmFrZQ==' });

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(oneCapturePeriod(60 * 1000));
    });

    expect(mocks.captureScreenshotMock).toHaveBeenCalledTimes(2);
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
    mocks.captureScreenshotMock.mockResolvedValue({ ok: true, dataUrl: 'data:image/png;base64,ZmFrZQ==' });

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 1000);
    });

    // Only the immediate capture so far — the 5 min interval has not ticked yet.
    expect(mocks.captureScreenshotMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(oneCapturePeriod(5 * 60 * 1000) - 60 * 1000);
    });

    // Immediate capture + first 5 min tick.
    expect(mocks.captureScreenshotMock).toHaveBeenCalledTimes(2);
    expect(mocks.uploadScreenshotMock).toHaveBeenCalledTimes(2);
  });

  it('continues screenshot capture when the user is idle at the screenshot interval', async () => {
    const idleSince = Date.now();
    // A 1 minute interval keeps the whole window inside the idle auto-stop
    // threshold, so this test measures "capture continues while idle" and not
    // "the timer got auto-stopped for idle".
    mocks.authUser = {
      ...mocks.authUser,
      effective_monitoring_interval_minutes: 1,
    };
    mocks.captureScreenshotMock.mockResolvedValue({ ok: true, dataUrl: 'data:image/png;base64,ZmFrZQ==' });
    mocks.getSystemIdleSecondsMock.mockImplementation(async () => Math.floor((Date.now() - idleSince) / 1000));

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(oneCapturePeriod(60 * 1000));
    });

    // Immediate capture + one tick. Capture deliberately continues while idle.
    expect(mocks.captureScreenshotMock).toHaveBeenCalledTimes(2);
    expect(mocks.uploadScreenshotMock).toHaveBeenCalledTimes(2);
    expect(mocks.uploadScreenshotMock).toHaveBeenNthCalledWith(
      1,
      55,
      'data:image/png;base64,ZmFrZQ==',
      expect.stringMatching(/^capture-\d+\.png$/)
    );
  });

  it('clears and recreates the screenshot interval cleanly on remount without duplicating captures', async () => {
    mocks.captureScreenshotMock.mockResolvedValue({ ok: true, dataUrl: 'data:image/png;base64,ZmFrZQ==' });

    const firstRender = render(<TrackerHarness />);
    firstRender.unmount();

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(oneCapturePeriod(10 * 60 * 1000));
    });

    // After remount: a single immediate capture + one tick (no duplicate
    // interval left over from the unmounted render).
    expect(mocks.captureScreenshotMock).toHaveBeenCalledTimes(2);
    expect(mocks.uploadScreenshotMock).toHaveBeenCalledTimes(2);
  });

  it('recovers future screenshots when one screenshot capture call hangs', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let captureCallCount = 0;
    mocks.captureScreenshotMock.mockImplementation(() => {
      captureCallCount += 1;

      if (captureCallCount === 1) {
        return new Promise(() => {});
      }

      return Promise.resolve({ ok: true, dataUrl: 'data:image/png;base64,ZmFrZQ==' });
    });

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(oneCapturePeriod(10 * 60 * 1000));
    });

    // The immediate capture hangs but times out after 15s, releasing the
    // in-flight guard; the interval tick then captures and uploads
    // successfully. So two capture attempts and one successful upload.
    expect(mocks.captureScreenshotMock).toHaveBeenCalledTimes(2);
    expect(mocks.uploadScreenshotMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(oneCapturePeriod(10 * 60 * 1000));
    });

    // A further interval tick keeps capturing and uploading normally.
    expect(mocks.captureScreenshotMock).toHaveBeenCalledTimes(3);
    expect(mocks.uploadScreenshotMock).toHaveBeenCalledTimes(2);

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

  it('records a browser session with its captured URL when no extension is connected', async () => {
    /*
     * The behaviour that was missing entirely. Browsers used to be refused a
     * desktop session on the basis that the extension owns website sessions —
     * but the extension is optional, so with it absent browser time was
     * recorded as nothing at all. Measured on this install: 50 activity
     * sessions since 16 July, every one of them a transient system window.
     */
    render(<TrackerHarness />);

    await act(async () => {
      foregroundWindowListeners[0]?.({
        app: 'Google Chrome',
        title: 'chrome.tabs | API | Chrome for Developers',
        url: null,
        inferred_url: 'https://developer.chrome.com/docs/extensions/reference/api/tabs',
        inferred_url_source: 'document',
        inferred_url_confidence: 100,
        captured_at: '2026-04-21T09:00:00.000Z',
      });
    });

    expect(mocks.createActivitySessionMock).toHaveBeenCalledWith(expect.objectContaining({
      source: 'desktop',
      app_name: 'Google Chrome',
      url: 'https://developer.chrome.com/docs/extensions/reference/api/tabs',
      // Chrome's Document element is the real page URL, so it is exact.
      confidence: 100,
    }));
  });

  it('records only the host, at lower confidence, when the URL came from an address bar', async () => {
    // Edge and Brave can fall back to the address bar, which may still hold
    // text somebody typed and never submitted, so the path is not claimed.
    render(<TrackerHarness />);

    await act(async () => {
      foregroundWindowListeners[0]?.({
        app: 'Microsoft Edge',
        title: 'Example Domain',
        url: null,
        inferred_url: 'https://example.org',
        inferred_url_source: 'address_bar',
        inferred_url_confidence: 60,
        captured_at: '2026-04-21T09:00:00.000Z',
      });
    });

    expect(mocks.createActivitySessionMock).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://example.org',
      confidence: 60,
    }));
  });

  it('does not record the tracker own page as browsing', async () => {
    // CareVance viewed in a browser is the tracker looking at itself, not work.
    render(<TrackerHarness />);

    await act(async () => {
      foregroundWindowListeners[0]?.({
        app: 'Google Chrome',
        title: 'CareVance HRMS Workspace',
        url: null,
        inferred_url: 'http://localhost:5173/add-user',
        inferred_url_source: 'document',
        inferred_url_confidence: 100,
        captured_at: '2026-04-21T09:00:00.000Z',
      });
    });

    /*
     * Asserted against the URL rather than "never called": the harness's own
     * tick creates a Visual Studio Code session from its default active-window
     * context, so a blanket not.toHaveBeenCalled() would pass or fail for
     * reasons that have nothing to do with self-exclusion.
     */
    const recordedUrls = mocks.createActivitySessionMock.mock.calls.map(([payload]: [any]) => payload?.url);
    expect(recordedUrls).not.toContain('http://localhost:5173/add-user');
  });

  it('extends an active desktop app session while the same app stays focused', async () => {
    vi.setSystemTime(new Date('2026-04-21T09:00:00Z'));
    mocks.createActivitySessionMock.mockResolvedValueOnce({ data: { id: 1601 } });
    mocks.getActiveWindowContextMock.mockResolvedValue({
      app: 'Codex',
      title: 'Codex',
      url: null,
    });

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1 * 1000);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(59 * 1000);
    });

    expect(mocks.createActivitySessionMock).toHaveBeenCalledWith(expect.objectContaining({
      source: 'desktop',
      activity_kind: 'desktop_app',
      display_name: 'Codex',
      app_name: 'Codex',
      window_title: 'Codex',
    }));
    expect(mocks.updateActivitySessionMock).toHaveBeenCalledWith(1601, expect.objectContaining({
      ended_at: '2026-04-21T09:01:00.000Z',
      duration_seconds: 60,
    }));
    expect(mocks.createActivityMock).not.toHaveBeenCalled();
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

  it('closes a queued session with the switch-away time so a retry is not counted as still open', async () => {
    // Isolate this test from the tick's own polling: with no polled window,
    // only the explicit foreground events below drive desktop sessions.
    mocks.getActiveWindowContextMock.mockResolvedValue(null);
    // The create fails once (so the session queues) and the retry the tick
    // drains it with succeeds.
    mocks.createActivitySessionMock
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValue({ data: { id: 2001 } });

    render(<TrackerHarness />);
    await act(async () => {}); // let desktop device identity resolve

    await act(async () => {
      foregroundWindowListeners[0]?.({
        app: 'Notepad',
        title: 'notes.txt - Notepad',
        url: null,
        captured_at: '2026-04-21T10:00:00.000Z',
      });
    });

    // Switch away before the tick has a chance to retry. Without stamping
    // ended_at here, the queued row drains open and the server's
    // closeConflictingOpenSessions fabricates a duration against whatever
    // session starts next — double-counting the hour spent in Notepad.
    await act(async () => {
      foregroundWindowListeners[0]?.({
        app: 'Visual Studio Code',
        title: 'Tracking Work',
        url: null,
        captured_at: '2026-04-21T10:05:00.000Z',
      });
    });

    mocks.createActivitySessionMock.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(mocks.createActivitySessionMock).toHaveBeenCalledWith(expect.objectContaining({
      display_name: 'Notepad',
      started_at: '2026-04-21T10:00:00.000Z',
      ended_at: '2026-04-21T10:05:00.000Z',
    }));
  });

  it('adopts the server id on a successful drain, so a later close PATCHes the real end time instead of leaving the row at its seeded zero-length duration', async () => {
    // Drive this entirely through the tick's own polling, matching real
    // usage: the mount tick's create fails and queues while Notepad is
    // focused, the very next tick (1s later, well before the user has moved
    // on) drains and adopts the server id, Notepad stays focused for 5
    // minutes of ordinary extends, then the poll sees VS Code and closes it.
    const notepadWindow = { app: 'Notepad', title: 'notes.txt - Notepad', url: null };
    const vsCodeWindow = { app: 'Visual Studio Code', title: 'Tracking Work', url: null };
    mocks.getActiveWindowContextMock.mockResolvedValue(notepadWindow);
    // The mount tick's create fails and queues; every retry after that
    // (the drain, and the eventual VS Code create) succeeds.
    mocks.createActivitySessionMock
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValue({ data: { id: 3001 } });

    render(<TrackerHarness />);

    // The mount tick creates the Notepad session (fails, queues it); the
    // very next tick — one second later — drains the queue and adopts the
    // server id while Notepad is still the polled app.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    // Stay on Notepad for the rest of 5 minutes of ordinary polling/extends
    // (1s already elapsed above; one more tick below lands exactly on 5:00).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000 + 58 * 1000);
    });

    mocks.getActiveWindowContextMock.mockResolvedValue(vsCodeWindow);
    mocks.updateActivitySessionMock.mockClear();

    // The tick exactly 5 minutes after mount sees VS Code and closes Notepad.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    // The drained session must have adopted the id the server issued, so
    // closing it goes through the normal PATCH path with the real 5-minute
    // duration. Without adopting the id, sessionId stays null forever and
    // this session is stuck at the seeded zero-length ended_at — five
    // minutes of Notepad recorded as zero seconds, with no update call for
    // the real close to show for it.
    expect(mocks.updateActivitySessionMock).toHaveBeenCalledWith(3001, expect.objectContaining({
      duration_seconds: 300,
    }));
  });

  it('patches the real end time when the user switches away while the drained create is still in flight', async () => {
    const notepadWindow = { app: 'Notepad', title: 'notes.txt - Notepad', url: null };
    const vsCodeWindow = { app: 'Visual Studio Code', title: 'Tracking Work', url: null };
    mocks.getActiveWindowContextMock.mockResolvedValue(notepadWindow);

    let releaseDrainedCreate = () => {};
    mocks.createActivitySessionMock
      // Notepad's first create fails, so it queues.
      .mockRejectedValueOnce(new Error('network blip'))
      // The tick's retry hangs, leaving the request in flight across the
      // switch-away below.
      .mockImplementationOnce(() => new Promise((resolve) => {
        releaseDrainedCreate = () => resolve({ data: { id: 4001 } });
      }))
      // Anything after that (the VS Code session) succeeds normally.
      .mockResolvedValue({ data: { id: 4002 } });

    render(<TrackerHarness />);

    // The mount tick creates the Notepad session (fails, queues it); the next
    // tick drains it, and that create is still awaiting the server from here on.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mocks.createActivitySessionMock).toHaveBeenCalledTimes(2);

    // Five minutes of Notepad, all of it while that create is in flight.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });

    // The switch away closes the session: it stamps the real ended_at onto a
    // payload that was serialised and sent five minutes ago, and clears the
    // active ref — so the id-adoption branch can never fire for it.
    mocks.getActiveWindowContextMock.mockResolvedValue(vsCodeWindow);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    await act(async () => {
      releaseDrainedCreate();
      await vi.advanceTimersByTimeAsync(0);
    });

    // Without amending the row it keeps ended_at === started_at, and
    // ActivityFeedService::mapSession drops sessions where end <= start — so
    // five minutes of real work would vanish from the timeline entirely.
    const seededCreate = mocks.createActivitySessionMock.mock.calls[0][0];
    const patch = mocks.updateActivitySessionMock.mock.calls.find((call) => call[0] === 4001);
    expect(patch).toBeDefined();
    expect(Date.parse(String(patch?.[1]?.ended_at)))
      .toBeGreaterThan(Date.parse(String(seededCreate.started_at)));
  });

  it('does not adopt an id from an empty 2xx body, which would PATCH /activity-sessions/undefined', async () => {
    const notepadWindow = { app: 'Notepad', title: 'notes.txt - Notepad', url: null };
    const vsCodeWindow = { app: 'Visual Studio Code', title: 'Tracking Work', url: null };
    mocks.getActiveWindowContextMock.mockResolvedValue(notepadWindow);
    mocks.createActivitySessionMock
      .mockRejectedValueOnce(new Error('network blip'))
      // The retry is accepted but answers with no body — response.data.id is
      // undefined, which is not null, so every `sessionId === null` guard
      // downstream lets it through.
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValue({ data: { id: 5001 } });

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 1000);
    });

    mocks.getActiveWindowContextMock.mockResolvedValue(vsCodeWindow);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    const patchedIds = mocks.updateActivitySessionMock.mock.calls.map((call) => call[0]);
    expect(patchedIds.every((id) => Number.isFinite(id))).toBe(true);
  });

  it('reports dropped sessions once, so tracked time thrown away is not indistinguishable from time never worked', async () => {
    // No device_id means the server cannot recognise a replay, so the queue
    // refuses the session rather than risk double-counting it — a real loss
    // that must not be silent.
    mocks.getDesktopDeviceIdentityMock.mockResolvedValue({
      device_id: null,
      device_label: 'DESKTOP-ALPHA',
    });
    mocks.createActivitySessionMock.mockRejectedValue(new Error('network blip'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    const dropReports = warnSpy.mock.calls.filter(
      (call) => String(call[0]).includes('unsent activity session(s)')
    );

    expect(dropReports).toHaveLength(1);
    expect(String(dropReports[0][0])).toContain('no_device_id=1');

    warnSpy.mockRestore();
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

  it('extends an active exact browser session when the same tab sends a heartbeat', async () => {
    mocks.createActivitySessionMock.mockResolvedValueOnce({ data: { id: 1151 } });
    mocks.getActiveWindowContextMock.mockResolvedValue(null);

    render(<TrackerHarness />);

    await act(async () => {
      browserTrackingListeners[0]?.({
        kind: 'tab-focused',
        browser_name: 'chrome',
        profile_key: 'profile-a',
        tab_id: 91,
        window_id: 5,
        url: 'https://www.linkedin.com/feed/',
        title: 'Feed | LinkedIn',
        recorded_at: '2026-04-21T11:28:54.000Z',
      });
    });

    await act(async () => {
      browserTrackingListeners[0]?.({
        kind: 'heartbeat',
        browser_name: 'chrome',
        profile_key: 'profile-a',
        tab_id: 91,
        window_id: 5,
        url: 'https://www.linkedin.com/feed/',
        title: 'Feed | LinkedIn',
        recorded_at: '2026-04-21T11:29:24.000Z',
      });
    });

    expect(mocks.createActivitySessionMock).toHaveBeenCalledTimes(1);
    expect(mocks.updateActivitySessionMock).toHaveBeenCalledWith(1151, expect.objectContaining({
      ended_at: '2026-04-21T11:29:24.000Z',
      duration_seconds: 30,
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

  // ── Part 3: idle boundary coverage ────────────────────────────────────────
  // Business rule: <3min not counted, 3min..<5min counted but not auto-stopped,
  // 5min continuous auto-stops. Boundary conditions are where off-by-one bugs
  // hide, so each threshold edge is asserted explicitly.
  it('does NOT count idle at exactly 2:59 (below the 3 minute track threshold)', async () => {
    const idleSince = Date.now();
    mocks.getSystemIdleSecondsMock.mockImplementation(async () => Math.floor((Date.now() - idleSince) / 1000));

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 59 * 1000);
    });

    expect(mocks.createActivityMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'idle' }));
    expect(mocks.stopMock).not.toHaveBeenCalled();
    expect(mocks.deleteActivityMock).not.toHaveBeenCalled();
  });

  it('DOES count idle at exactly 3:00 (at the track threshold) but does NOT auto-stop', async () => {
    const idleSince = Date.now();
    mocks.getSystemIdleSecondsMock.mockImplementation(async () => Math.floor((Date.now() - idleSince) / 1000));

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
    });

    expect(
      mocks.createActivityMock.mock.calls.some(([payload]) => payload?.type === 'idle')
    ).toBe(true);
    expect(mocks.stopMock).not.toHaveBeenCalled();
  });

  it('counts idle at 4:59 with a resume and does NOT auto-stop', async () => {
    let idleSince = Date.now();
    mocks.getSystemIdleSecondsMock.mockImplementation(async () => Math.floor((Date.now() - idleSince) / 1000));

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000 + 59 * 1000);
    });

    expect(
      mocks.createActivityMock.mock.calls.some(([payload]) => payload?.type === 'idle')
    ).toBe(true);
    expect(mocks.stopMock).not.toHaveBeenCalled();

    // Resume activity; the idle window should be rewound and the timer kept.
    await act(async () => {
      idleSince = Date.now();
      window.dispatchEvent(new Event('keydown'));
      await vi.advanceTimersByTimeAsync(5 * 1000);
    });

    expect(mocks.stopMock).not.toHaveBeenCalled();
  });

  it('auto-stops the timer at exactly 5:00 of continuous idle', async () => {
    const idleSince = Date.now();
    mocks.getSystemIdleSecondsMock.mockImplementation(async () => Math.floor((Date.now() - idleSince) / 1000));

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });

    expect(mocks.stopMock).toHaveBeenCalledWith({
      timer_slot: 'primary',
      auto_stopped_for_idle: true,
      idle_seconds: 300,
      last_activity_at: '2026-03-18T09:00:00.000Z',
    });
  });
});
