import Echo from 'laravel-echo';
import Pusher from 'pusher-js';
import type {
  ChannelAuthorizationCallback,
  ChannelAuthorizationData,
} from 'pusher-js/types/src/core/auth/options';
import api from '@/services/api';
import { realtimeEnabled, reverbAppKey, reverbHost, reverbPort, reverbScheme } from '@/lib/runtimeConfig';
import { reportSilentError } from '@/lib/reportSilentError';

/**
 * The real-time transport, and the one place that knows it exists.
 *
 * Everything above this module deals in callbacks and a connection state; it
 * never touches Echo, Pusher or a channel name. That matters because the
 * transport is the part most likely to be swapped or misconfigured, and
 * because the app has to work correctly when it is absent — which is the
 * normal case in a local checkout where nobody has run `reverb:start`.
 */

export type RealtimeStatus = 'disabled' | 'connecting' | 'connected' | 'reconnecting' | 'unavailable';

type NotificationEvent = { broadcast_id: string; type: string };
type SessionRevokedEvent = { reason: string };

type Handlers = {
  onNotification: (event: NotificationEvent) => void;
  onSessionRevoked: (event: SessionRevokedEvent) => void;
  onStatusChange: (status: RealtimeStatus) => void;
};

let echo: Echo<'reverb'> | null = null;
let subscribedUserId: number | null = null;

/**
 * Echo reads the Pusher constructor off the window rather than taking it as an
 * argument. Assigning it here keeps the coupling in one file instead of in an
 * app entrypoint where its purpose would not be obvious.
 */
const ensurePusherOnWindow = () => {
  if (typeof window === 'undefined') return;
  (window as unknown as { Pusher?: typeof Pusher }).Pusher = Pusher;
};

/**
 * Authorize a private channel through the app's own API client.
 *
 * Deliberately not a hand-rolled fetch. The axios instance already attaches
 * the bearer token the way every other request does, so channel authorization
 * cannot drift from request authentication — and a 401 here runs the same
 * clear-and-signal path as a 401 anywhere else, instead of failing silently
 * inside the socket library where nothing would surface it.
 */
const authorizer = (channel: { name: string }) => ({
  authorize: (socketId: string, callback: ChannelAuthorizationCallback) => {
    api
      .post<ChannelAuthorizationData>('/broadcasting/auth', {
        socket_id: socketId,
        channel_name: channel.name,
      })
      .then((response) => callback(null, response.data))
      .catch((error: unknown) =>
        callback(error instanceof Error ? error : new Error(String(error)), null)
      );
  },
});

/**
 * Map Pusher's connection states onto the three the UI actually distinguishes.
 *
 * 'unavailable' and 'failed' are kept apart from 'connecting' on purpose: they
 * are what a blocked WebSocket upgrade or a stopped daemon looks like, and
 * they are the signal the caller uses to fall back to polling. Treating them
 * as "still connecting" is how a dead transport stays invisible.
 */
const mapConnectionState = (state: string): RealtimeStatus => {
  switch (state) {
    case 'connected':
      return 'connected';
    case 'connecting':
      return 'connecting';
    case 'unavailable':
    case 'failed':
      return 'unavailable';
    default:
      return 'reconnecting';
  }
};

export const isRealtimeConfigured = () => realtimeEnabled;

/**
 * Connect and subscribe to this user's own channel.
 *
 * Returns a teardown function in every case, including the ones where nothing
 * was connected, so callers never branch on whether real-time was available.
 */
export const connectRealtime = (userId: number, handlers: Handlers): (() => void) => {
  if (!realtimeEnabled || !userId || typeof window === 'undefined') {
    handlers.onStatusChange('disabled');
    return () => {};
  }

  try {
    ensurePusherOnWindow();

    if (!echo) {
      echo = new Echo({
        broadcaster: 'reverb',
        key: reverbAppKey,
        wsHost: reverbHost,
        wsPort: reverbPort,
        wssPort: reverbPort,
        forceTLS: reverbScheme === 'https',
        // WebSocket only, because that is all Reverb speaks — it has no
        // equivalent of Pusher's HTTP long-polling fallback. So a network that
        // refuses the upgrade (a corporate proxy, some hotel Wi-Fi) has no
        // transport-level second chance, and the connection simply reports
        // 'unavailable'. That is precisely why the fallback poll in the caller
        // is not optional: for those users it is the only path there is.
        enabledTransports: ['ws', 'wss'],
        authorizer,
      });
    }

    const connection = (echo.connector as unknown as { pusher: Pusher }).pusher.connection;

    handlers.onStatusChange(mapConnectionState(connection.state));
    const onStateChange = ({ current }: { current: string }) =>
      handlers.onStatusChange(mapConnectionState(current));
    connection.bind('state_change', onStateChange);

    const channelName = `user.${userId}`;
    subscribedUserId = userId;

    echo
      .private(channelName)
      .listen('.notification.created', (event: NotificationEvent) => handlers.onNotification(event))
      .listen('.session.revoked', (event: SessionRevokedEvent) => handlers.onSessionRevoked(event));

    return () => {
      try {
        connection.unbind('state_change', onStateChange);
        echo?.leave(channelName);
      } catch (error) {
        reportSilentError('realtime: teardown failed', error);
      }
      subscribedUserId = null;
    };
  } catch (error) {
    // A transport that cannot start must degrade, never throw into a render.
    // The caller reads 'unavailable' and turns its fallback poll back on.
    reportSilentError('realtime: could not establish a connection; falling back to polling', error);
    handlers.onStatusChange('unavailable');
    return () => {};
  }
};

/**
 * Drop the connection entirely — used on sign-out and on a revoked session.
 *
 * Leaving the channel is not enough for either: the socket itself was
 * authorized with credentials that are no longer valid, and it must not
 * survive to be reused by whoever signs in next on the same machine.
 */
export const disconnectRealtime = () => {
  try {
    if (echo && subscribedUserId !== null) {
      echo.leave(`user.${subscribedUserId}`);
    }
    echo?.disconnect();
  } catch (error) {
    reportSilentError('realtime: disconnect failed', error);
  } finally {
    echo = null;
    subscribedUserId = null;
  }
};
