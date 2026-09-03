import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DESKTOP_TIMER_IDLE_STOP_EVENT } from '@/lib/desktopTimerSession';
import { idleTrackThresholdSeconds } from '@/lib/runtimeConfig';
import { resolveDesktopSessionSignature, useDesktopTracker } from '@/hooks/useDesktopTracker';

const mocks = vi.hoisted(() => ({
  activeMock: vi.fn(),
  stopMock: vi.fn(),
  createActivityMock: vi.fn(),
  updateActivityMock: vi.fn(),
  deleteActivityMock: vi.fn(),
  createActivitySessionMock: vi.fn(),
  updateActivitySessionMock: vi.fn(),
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

  /*
   * A timer cannot have been idle for longer than it has existed.
   *
   * `powerMonitor.getSystemIdleTime()` measures the MACHINE, not the timer, and
   * it keeps counting while no timer is running at all. Somebody who leaves
   * their desk, comes back and starts a timer therefore starts one whose OS
   * idle clock is already minutes old — and every threshold downstream is
   * evaluated against that inherited age rather than against the timer's own.
   *
   * Observed in production on 2 Sep 2026: one entry stopped with
   * `last_activity_at` equal to its own `start_time` — zero seconds tracked,
   * 343 discarded — and people were told "You were idle for 15 minutes" five
   * minutes into a timer.
   *
   * Every other idle test in this file mocks the idle clock as starting when
   * the timer starts (`idleSince = Date.now()`), which is precisely why this
   * class of bug was invisible to the suite.
   */
  it('does not auto-stop a young timer because the MACHINE was idle before it started', async () => {
    const machineIdleSince = Date.now() - (10 * 60 * 1000);
    mocks.getSystemIdleSecondsMock.mockImplementation(
      async () => Math.floor((Date.now() - machineIdleSince) / 1000)
    );

    render(<TrackerHarness />);

    // Two minutes into a timer that started `now`. The OS reports twelve
    // minutes of idle; the timer's own idle can be at most two.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    });

    expect(mocks.stopMock).not.toHaveBeenCalled();
  });

  it('never reports a last_activity_at earlier than the timer start', async () => {
    const machineIdleSince = Date.now() - (10 * 60 * 1000);
    mocks.getSystemIdleSecondsMock.mockImplementation(
      async () => Math.floor((Date.now() - machineIdleSince) / 1000)
    );

    render(<TrackerHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    });

    /*
     * Stopping here is correct — by now the timer has genuinely been idle for
     * its whole life. What it must never do is claim activity ceased before the
     * timer existed: that timestamp is what the rewind moves `end_time` back
     * to, so a backdated one deletes time the entry never contained.
     */
    const startedAtMs = Date.parse('2026-03-18T09:00:00Z');
    expect(mocks.stopMock).toHaveBeenCalled();
    for (const [payload] of mocks.stopMock.mock.calls) {
      if (!payload?.last_activity_at) continue;
      expect(Date.parse(payload.last_activity_at)).toBeGreaterThanOrEqual(startedAtMs);
    }
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
    /*
     * The 2 second head start is what makes idle reach the threshold at 4:58
     * elapsed — a moment the 5 second activity tick does not land on — which is
     * the whole point of the test.
     *
     * The timer must therefore start 2 seconds early too. Previously only the
     * idle clock did, so the case under test was a machine idle from BEFORE the
     * timer existed, and the assertion below pinned a `last_activity_at` two
     * seconds earlier than `start_time`. That is not a thing the tracker may
     * report: it is the timestamp the stop rewinds `end_time` to, so a
     * backdated one deletes time the entry never contained. Starting both
     * clocks together keeps the 4:58 timing and drops the backdating.
     */
    const startedAt = '2026-03-18T08:59:58Z';
    mocks.activeMock.mockResolvedValue({
      data: {
        id: 55,
        user_id: 1,
        start_time: startedAt,
        duration: 0,
        timer_slot: 'primary',
      },
    });
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
      /*
       * Typed as a website, not an app. Reports name the tool from the domain
       * but take its type from here, so stamping desktop_app/software inverted
       * the two categories: wikipedia.org was listed as an application and
       * dropped from the Websites filter, while "google chrome" — the browser
       * itself — turned up under Websites.
       */
      activity_kind: 'website',
      tool_type: 'website',
    }));
  });

  describe('session identity for a browser', () => {
    /*
     * The "durations are wrong" report, tested on the function that decides it.
     *
     * In a browser the window title tracks page STATE, not identity — unread
     * counts, loading placeholders, notification badges — and it used to be
     * part of the session signature, so every flicker closed one session and
     * opened another. Measured in the timeline on 19 Aug 2026: one continuous
     * stretch of Gmail on `mail.google.com/mail/u/0/#inbox` stored as four
     * sessions of 2s, 1s, 1s and 3s, differing only by the title going
     * "Inbox (3) …" -> "Gmail" -> "Inbox (4) …" as mail arrived. Durations were
     * not so much under-counted as shredded, each shard too short to read as
     * real work.
     */
    const gmail = (title: string) => ({
      app: 'Google Chrome',
      title,
      url: null,
      inferred_url: 'https://mail.google.com/mail/u/0/#inbox',
      inferred_url_source: 'document' as const,
      inferred_url_confidence: 100,
      captured_at: '2026-04-21T09:00:00.000Z',
    });

    it('is unchanged while the title churns on one page', () => {
      const first = resolveDesktopSessionSignature(gmail('Inbox (3) - someone@gmail.com - Gmail'));

      expect(resolveDesktopSessionSignature(gmail('Gmail'))).toBe(first);
      expect(resolveDesktopSessionSignature(gmail('Inbox (4) - someone@gmail.com - Gmail'))).toBe(first);
    });

    it('changes when the browser actually navigates', () => {
      // Dropping the title has to leave something strictly more precise behind,
      // or two genuinely different pages would merge into one row.
      const inbox = resolveDesktopSessionSignature(gmail('Gmail'));
      const sent = resolveDesktopSessionSignature({
        ...gmail('Gmail'),
        inferred_url: 'https://mail.google.com/mail/u/0/#sent',
      });

      expect(sent).not.toBe(inbox);
    });

    it('still separates non-browser windows by title', () => {
      // Outside a browser the title is the only thing distinguishing one piece
      // of work from another, so it stays part of the identity there.
      const base = {
        app: 'Visual Studio Code',
        url: null,
        inferred_url: null,
        captured_at: '2026-04-21T09:00:00.000Z',
      };

      expect(resolveDesktopSessionSignature({ ...base, title: 'a.ts - project' }))
        .not.toBe(resolveDesktopSessionSignature({ ...base, title: 'b.ts - project' }));
    });

    it('still separates browser windows by title when no URL could be read', () => {
      // A browser on a blank tab has no URL to be identified by, so the title
      // is all there is and must keep working.
      const base = {
        app: 'Google Chrome',
        url: null,
        inferred_url: null,
        captured_at: '2026-04-21T09:00:00.000Z',
      };

      expect(resolveDesktopSessionSignature({ ...base, title: 'New Tab' }))
        .not.toBe(resolveDesktopSessionSignature({ ...base, title: 'Settings' }));
    });
  });

  it('opens no further sessions while a browser title churns on one page', async () => {
    // The same rule end to end. Counted after the session is established, so
    // the harness settling on its active time entry cannot be mistaken for the
    // fragmentation this guards against.
    render(<TrackerHarness />);

    const gmailCreates = () => mocks.createActivitySessionMock.mock.calls
      .map(([payload]: [any]) => payload)
      .filter((payload) => String(payload?.url || '').includes('mail.google.com'));

    const fire = async (title: string, second: number) => {
      await act(async () => {
        foregroundWindowListeners[0]?.({
          app: 'Google Chrome',
          title,
          url: null,
          inferred_url: 'https://mail.google.com/mail/u/0/#inbox',
          inferred_url_source: 'document',
          inferred_url_confidence: 100,
          captured_at: `2026-04-21T09:00:0${second}.000Z`,
        });
      });
    };

    await fire('Inbox (3) - someone@gmail.com - Gmail', 0);
    await fire('Gmail', 1);
    const established = gmailCreates().length;

    await fire('Inbox (4) - someone@gmail.com - Gmail', 2);
    await fire('Inbox (5) - someone@gmail.com - Gmail', 3);
    await fire('Inbox (6) - someone@gmail.com - Gmail', 4);

    expect(gmailCreates()).toHaveLength(established);
  });

  it('keeps a browser with no readable URL as an app session', async () => {
    // The URL is what makes it a website visit. A browser sitting on a blank
    // tab with nothing readable is a window, and typing it as a website would
    // put a nameless row in the site reports.
    render(<TrackerHarness />);

    await act(async () => {
      foregroundWindowListeners[0]?.({
        app: 'Google Chrome',
        title: 'New Tab',
        url: null,
        inferred_url: null,
        captured_at: '2026-04-21T09:00:00.000Z',
      });
    });

    const chromeCreate = mocks.createActivitySessionMock.mock.calls
      .map(([payload]: [any]) => payload)
      .find((payload) => payload?.app_name === 'Google Chrome');

    if (chromeCreate) {
      expect(chromeCreate.activity_kind).toBe('desktop_app');
      expect(chromeCreate.tool_type).toBe('software');
    }
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

  it('does not record the tracker own window as activity', async () => {
    /*
     * Self-exclusion is about the Electron window the tracker runs in, which
     * the desktop agent flags with is_self_window. It is NOT about the product
     * appearing in a page title.
     */
    render(<TrackerHarness />);

    await act(async () => {
      foregroundWindowListeners[0]?.({
        app: 'Electron',
        title: 'CareVance HRMS Workspace',
        url: null,
        inferred_url: null,
        is_self_window: true,
        captured_at: '2026-04-21T09:00:00.000Z',
      });
    });

    /*
     * Asserted against the app name rather than "never called": the harness's
     * own tick creates a Visual Studio Code session from its default
     * active-window context, so a blanket not.toHaveBeenCalled() would pass or
     * fail for reasons that have nothing to do with self-exclusion.
     */
    const recordedApps = mocks.createActivitySessionMock.mock.calls.map(([payload]: [any]) => payload?.app_name);
    expect(recordedApps).not.toContain('Electron');
  });

  it('records the CareVance web app opened in a browser as real browsing', async () => {
    /*
     * Previously refused, on the reasoning that CareVance in a browser is the
     * tracker looking at itself. It is not — the tracker is the Electron
     * window. A person reading their payslip in Chrome is working, and an HR
     * user who lives in the HRMS lost nearly all their browser time to this.
     *
     * The exclusion was arbitrary as well as costly: it keyed off the window
     * title, so "Home | Dashboard" was recorded while "CareVance HRMS
     * Workspace" was not, for the very same application.
     */
    render(<TrackerHarness />);

    await act(async () => {
      foregroundWindowListeners[0]?.({
        app: 'Google Chrome',
        title: 'CareVance HRMS Workspace',
        url: null,
        inferred_url: 'http://localhost:5173/add-user',
        inferred_url_source: 'document',
        inferred_url_confidence: 100,
        is_self_window: false,
        captured_at: '2026-04-21T09:00:00.000Z',
      });
    });

    expect(mocks.createActivitySessionMock).toHaveBeenCalledWith(expect.objectContaining({
      app_name: 'Google Chrome',
      url: 'http://localhost:5173/add-user',
    }));
  });

  it('keeps the session running through a shell window that flickers into the foreground', async () => {
    /*
     * Recorded live on 14 Aug 2026, mid-switch between Chrome and VS Code:
     *   {"app":"Windows Explorer","title":"","record":true}
     * Windows hands the shell the foreground for a beat during a switch, and
     * acting on it closed the session for the window the person was actually
     * using. An untitled shell process is a transient; a TITLED Explorer
     * window is a real folder and stays trackable.
     */
    render(<TrackerHarness />);

    await act(async () => {
      foregroundWindowListeners[0]?.({
        app: 'Notepad',
        title: 'notes.txt - Notepad',
        url: null,
        captured_at: '2026-04-21T09:00:00.000Z',
      });
    });

    mocks.createActivitySessionMock.mockClear();

    await act(async () => {
      foregroundWindowListeners[0]?.({
        app: 'Windows Explorer',
        title: '',
        url: null,
        captured_at: '2026-04-21T09:00:05.000Z',
      });
    });

    const recordedApps = mocks.createActivitySessionMock.mock.calls.map(([payload]: [any]) => payload?.app_name);
    expect(recordedApps).not.toContain('Windows Explorer');
  });

  it('records an app whose window title merely mentions the product', async () => {
    /*
     * The defect this pins, measured on 13 Aug 2026: Visual Studio Code never
     * once reached the timeline on a machine whose project folder is called
     * CareVance_Hrms_IDE, because self-detection matched the product name
     * against the window TITLE. The same silence swallows an email about
     * CareVance, a support ticket, or a spreadsheet named CareVance_Report.
     */
    render(<TrackerHarness />);

    await act(async () => {
      foregroundWindowListeners[0]?.({
        app: 'Visual Studio Code',
        title: 'useDesktopTracker.ts - CareVance_Hrms_IDE - Visual Studio Code',
        url: null,
        is_self_window: false,
        captured_at: '2026-04-21T09:00:00.000Z',
      });
    });

    expect(mocks.createActivitySessionMock).toHaveBeenCalledWith(expect.objectContaining({
      app_name: 'Visual Studio Code',
      window_title: 'useDesktopTracker.ts - CareVance_Hrms_IDE - Visual Studio Code',
    }));
  });

  it('still excludes the tracker window itself', async () => {
    // Electron reports its own focus, which cannot be confused with a title.
    render(<TrackerHarness />);
    mocks.createActivitySessionMock.mockClear();

    await act(async () => {
      foregroundWindowListeners[0]?.({
        app: 'CareVance Tracker',
        title: 'CareVance HRMS Workspace',
        url: null,
        is_self_window: true,
        captured_at: '2026-04-21T09:05:00.000Z',
      });
    });

    const titles = mocks.createActivitySessionMock.mock.calls.map(([p]: [any]) => p?.window_title);
    expect(titles).not.toContain('CareVance HRMS Workspace');
  });

  it('creates one session when two foreground events for the same window arrive together', async () => {
    /*
     * The duplicate-row defect, measured live on 13 Aug 2026: ids 106 and 107
     * were byte-identical Visual Studio Code sessions written in the same
     * second, with different local_ids and the first left at zero length.
     *
     * ensureDesktopSessionStarted awaits the active time entry before it looks
     * at activeDesktopSessionRef, so two calls that overlap both see "no
     * session yet" and both create one. The second then closes the first,
     * leaving an orphan row and inflating the timeline.
     */
    render(<TrackerHarness />);
    await act(async () => {});
    mocks.createActivitySessionMock.mockClear();

    const payload = {
      app: 'Visual Studio Code',
      title: 'useDesktopTracker.ts - Visual Studio Code',
      url: null,
      is_self_window: false,
      captured_at: '2026-04-21T09:00:00.000Z',
    };

    await act(async () => {
      // Fired together, exactly as two polls landing in the same tick do.
      foregroundWindowListeners[0]?.(payload);
      foregroundWindowListeners[0]?.({ ...payload });
    });

    expect(mocks.createActivitySessionMock).toHaveBeenCalledTimes(1);
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

  it('credits a browser with the whole time it stayed in front, not zero seconds', async () => {
    /*
     * The defect this pins, measured live on 13 Aug 2026.
     *
     * The foreground watcher fires only when the foreground CHANGES, so a
     * browser held in front for half a minute produces exactly one event —
     * the create. Only the per-second tick can grow that session, and the
     * tick classified every browser as "not a reliable desktop context",
     * closing the session the watcher had just opened. The row kept the
     * placeholder ended_at it was seeded with, so Chrome sat in front for 28
     * unbroken seconds and the timeline stored dur=0. The time was not
     * misattributed, it was recorded nowhere at all.
     *
     * VS Code never showed the bug because a non-browser takes the tick's
     * other branch, which extends normally — which is why the timeline
     * looked plausible while every browser visit on it was empty.
     */
    const chromeWindow = {
      app: 'Google Chrome',
      title: 'chrome.tabs | API | Chrome for Developers',
      url: null,
      inferred_url: 'https://developer.chrome.com/docs/extensions/reference/api/tabs',
      inferred_url_source: 'document',
      inferred_url_confidence: 100,
    };
    const vsCodeWindow = { app: 'Visual Studio Code', title: 'Tracking Work', url: null };

    mocks.getActiveWindowContextMock.mockResolvedValue(chromeWindow);
    mocks.createActivitySessionMock.mockResolvedValue({ data: { id: 5101 } });

    render(<TrackerHarness />);

    // Chrome holds the foreground for 30 seconds of ordinary polling.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30 * 1000);
    });

    mocks.getActiveWindowContextMock.mockResolvedValue(vsCodeWindow);

    // Switching away closes it, which is where the real duration is stamped.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    // The LAST patch, not the first: the session is extended every second, so
    // the first patch always reads 1 whether or not the bug is present.
    const patches = mocks.updateActivitySessionMock.mock.calls.filter((call) => call[0] === 5101);
    const finalPatch = patches.at(-1);

    expect(finalPatch).toBeDefined();
    // Held ~30s; anything near zero means the tick truncated it again.
    expect(finalPatch?.[1].duration_seconds).toBeGreaterThanOrEqual(30);

    // Exactly one Chrome session for one unbroken visit — the extends must not
    // have become a create/close churn of zero-length rows.
    const chromeCreates = mocks.createActivitySessionMock.mock.calls
      .filter((call) => call[0].app_name === 'Google Chrome');
    expect(chromeCreates).toHaveLength(1);
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

  it('creates a session when a browser window is showing the CareVance app', async () => {
    /*
     * The mirror of the Chrome case above, for a second browser. This used to
     * assert the opposite — that CareVance in a browser is the tracker looking
     * at itself. The tracker is the Electron window (is_self_window); a person
     * reading the timeline report in Brave is working.
     */
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

    expect(mocks.createActivitySessionMock).toHaveBeenCalledWith(expect.objectContaining({
      app_name: 'Brave',
      url: 'http://localhost:5173/reports/timeline',
    }));
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

  it('flushes the active session immediately when logout requests a tracker flush', async () => {
    // Browser time used to arrive through extension events, which this test
    // also drove. The extension was removed on 14 Aug 2026; a browser is now
    // just another foreground window, so one session covers both cases.
    mocks.createActivitySessionMock.mockResolvedValue({ data: { id: 1501 } });

    render(<TrackerHarness />);

    await act(async () => {
      foregroundWindowListeners[0]?.({
        app: 'Visual Studio Code',
        title: 'Tracking Work',
        url: null,
        captured_at: '2026-04-21T09:00:00.000Z',
      });
    });

    const flushDetail: { promise?: Promise<void> } = {};

    await act(async () => {
      window.dispatchEvent(new CustomEvent('desktop-tracker:flush', { detail: flushDetail }));
      await flushDetail.promise;
    });

    expect(mocks.updateActivitySessionMock).toHaveBeenCalledWith(1501, expect.objectContaining({
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

  it('keeps legacy sampled browser tracking for unsupported browsers even when Chromium exact tracking is healthy', async () => {
    window.desktopTracker = {
      ...window.desktopTracker,
      getDesktopDeviceIdentity: mocks.getDesktopDeviceIdentityMock,
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
