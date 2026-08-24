import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { attendanceApi } from '../api/endpoints';
import {
  bumpAttempt, classifyFailure, enqueue, makeLocalId, next, punchSyncBody, remove,
} from '../lib/punchQueue';
import type { PunchKind, QueuedPunch } from '../lib/punchQueue';
import type { GeoPosition } from '../types';

const STORAGE_KEY = '@punch_queue';
const DEVICE_KEY = '@device_id';

/**
 * Punching that survives a bad connection.
 *
 * Every punch is written to storage *before* it is sent, then flushed. That
 * order matters: a request that is fired and then lost to a crash, a killed app
 * or a dead network leaves nothing behind, and attendance is the one thing here
 * a person cannot simply redo — the moment has passed. Writing first means the
 * worst case is a punch that arrives late, not one that never existed.
 *
 * Sending twice is safe because the server keys on local_id + device_id; see
 * IdempotentSync on the backend and punchSyncBody in lib/punchQueue.
 */
export interface PunchSyncState {
  /** Punches written down but not yet accepted by the server. */
  pending: QueuedPunch[];
  /** True while a flush is in flight. */
  syncing: boolean;
  /**
   * Record a punch. Resolves once it is safely stored, whether or not it
   * reached the server — the caller should not block on the network.
   */
  punch: (kind: PunchKind, position?: GeoPosition) => Promise<void>;
  flush: () => Promise<void>;
}

async function loadQueue(): Promise<QueuedPunch[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupt storage must not brick punching. An unreadable queue is an empty
    // one; the alternative is a screen that can never check in again.
    return [];
  }
}

async function saveQueue(queue: QueuedPunch[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // Nothing useful to do — the punch is still in memory for this flush.
  }
}

async function getDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_KEY).catch(() => null);
  if (existing) return existing;
  const fresh = 'dev-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
  await AsyncStorage.setItem(DEVICE_KEY, fresh).catch(() => {});
  return fresh;
}

/**
 * @param onRejected Told when the server refuses a punch outright, so the
 *   screen can say so. A rejection is the one outcome the user must see: it is
 *   the only case where the punch is gone and will not be retried.
 * @param onSettled Called after a punch is accepted, so the screen can refetch.
 */
export function usePunchSync(
  onRejected?: (message: string) => void,
  onSettled?: () => void,
): PunchSyncState {
  const [pending, setPending] = useState<QueuedPunch[]>([]);
  const [syncing, setSyncing] = useState(false);

  // Guards a second flush starting while one is in flight, which would send the
  // head of the queue twice concurrently.
  const flushing = useRef(false);
  const rejected = useRef(onRejected);
  const settled = useRef(onSettled);

  useEffect(() => { rejected.current = onRejected; }, [onRejected]);
  useEffect(() => { settled.current = onSettled; }, [onSettled]);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    setSyncing(true);

    try {
      let queue = await loadQueue();
      let delivered = false;

      // Strictly oldest-first, and stop at the first undeliverable one so a
      // check-out can never overtake the check-in it belongs to.
      while (queue.length) {
        const item = next(queue);
        if (!item) break;

        const position: GeoPosition | undefined =
          typeof item.latitude === 'number' && typeof item.longitude === 'number'
            ? { latitude: item.latitude, longitude: item.longitude, accuracy: item.accuracy ?? 0 }
            : undefined;

        // Keyed off item.kind — check-out reads punch_out_at, not punch_at.
        const sync = punchSyncBody(item);

        try {
          if (item.kind === 'in') await attendanceApi.checkIn(position, sync);
          else await attendanceApi.checkOut(position, sync);

          queue = remove(queue, item.localId);
          delivered = true;
        } catch (error) {
          const outcome = classifyFailure(error);

          if (outcome.kind === 'rejected') {
            queue = remove(queue, item.localId);
            rejected.current?.(outcome.message);
            continue;
          }

          queue = bumpAttempt(queue, item.localId);
          break;
        }
      }

      await saveQueue(queue);
      setPending(queue);
      if (delivered) settled.current?.();
    } finally {
      flushing.current = false;
      setSyncing(false);
    }
  }, []);

  const punch = useCallback(async (kind: PunchKind, position?: GeoPosition) => {
    const now = Date.now();
    const deviceId = await getDeviceId();

    const entry: QueuedPunch = {
      localId: makeLocalId(kind, now, Math.random()),
      deviceId,
      kind,
      // The real moment, stamped here. Letting the server default this to its
      // own clock is what made an offline punch land at sync time.
      punchAt: new Date(now).toISOString(),
      latitude: position?.latitude,
      longitude: position?.longitude,
      accuracy: position?.accuracy,
      attempts: 0,
    };

    const queue = enqueue(await loadQueue(), entry);
    await saveQueue(queue);
    setPending(queue);

    await flush();
  }, [flush]);

  // Anything still waiting from a previous session goes out on launch.
  useEffect(() => { void flush(); }, [flush]);

  // And the moment the connection comes back, without waiting for the user to
  // reopen the screen.
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) void flush();
    });
    return () => unsubscribe();
  }, [flush]);

  return { pending, syncing, punch, flush };
}
