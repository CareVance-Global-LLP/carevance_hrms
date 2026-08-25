import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * The guarantee everything else leans on: when real-time is not available,
 * nothing throws and the caller is told, so it can turn its fallback poll
 * back on.
 *
 * This is the local-development case and the blocked-proxy case, and it is the
 * one that must not regress — a transport that throws on a missing
 * configuration would take the whole authenticated layout down with it.
 */

const echoConstructor = vi.fn();

vi.mock('laravel-echo', () => ({
  default: class {
    constructor(options: unknown) {
      echoConstructor(options);
    }
  },
}));

vi.mock('pusher-js', () => ({ default: class {} }));

vi.mock('@/services/api', () => ({ default: { post: vi.fn() } }));

describe('realtime transport when no app key is configured', () => {
  beforeEach(() => {
    vi.resetModules();
    echoConstructor.mockClear();
  });

  afterEach(() => {
    vi.doUnmock('@/lib/runtimeConfig');
  });

  const loadWithoutKey = async () => {
    vi.doMock('@/lib/runtimeConfig', () => ({
      realtimeEnabled: false,
      reverbAppKey: '',
      reverbHost: 'localhost',
      reverbPort: 8080,
      reverbScheme: 'http',
    }));

    return import('@/lib/realtime');
  };

  it('reports itself disabled rather than attempting a connection', async () => {
    const { connectRealtime } = await loadWithoutKey();
    const onStatusChange = vi.fn();

    connectRealtime(7, {
      onNotification: vi.fn(),
      onSessionRevoked: vi.fn(),
      onStatusChange,
    });

    expect(onStatusChange).toHaveBeenCalledWith('disabled');
    expect(echoConstructor).not.toHaveBeenCalled();
  });

  it('still returns a teardown function, so callers never branch on availability', async () => {
    const { connectRealtime } = await loadWithoutKey();

    const teardown = connectRealtime(7, {
      onNotification: vi.fn(),
      onSessionRevoked: vi.fn(),
      onStatusChange: vi.fn(),
    });

    expect(typeof teardown).toBe('function');
    expect(() => teardown()).not.toThrow();
  });

  it('does not attempt a connection for a signed-out user', async () => {
    const { connectRealtime } = await loadWithoutKey();
    const onStatusChange = vi.fn();

    connectRealtime(0, {
      onNotification: vi.fn(),
      onSessionRevoked: vi.fn(),
      onStatusChange,
    });

    expect(echoConstructor).not.toHaveBeenCalled();
    expect(onStatusChange).toHaveBeenCalledWith('disabled');
  });

  it('reports unavailable rather than throwing when the transport cannot start', async () => {
    vi.doMock('@/lib/runtimeConfig', () => ({
      realtimeEnabled: true,
      reverbAppKey: 'a-key',
      reverbHost: 'localhost',
      reverbPort: 8080,
      reverbScheme: 'http',
    }));

    // A constructor that blows up stands in for every way the transport can
    // fail to start — bad options, a missing global, a library change.
    echoConstructor.mockImplementation(() => {
      throw new Error('cannot construct');
    });

    const { connectRealtime } = await import('@/lib/realtime');
    const onStatusChange = vi.fn();

    let teardown: (() => void) | undefined;
    expect(() => {
      teardown = connectRealtime(7, {
        onNotification: vi.fn(),
        onSessionRevoked: vi.fn(),
        onStatusChange,
      });
    }).not.toThrow();

    expect(onStatusChange).toHaveBeenCalledWith('unavailable');
    expect(() => teardown?.()).not.toThrow();

    echoConstructor.mockReset();
  });
});
