import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getOfflineStatus,
  onOfflineStatusChange,
  isDesktopApp,
  OfflineState,
} from '@/services/offlineService';

const initialState: OfflineState = {
  status: 'online',
  pendingRecords: 0,
  lastSyncAt: null,
  isDesktopApp: isDesktopApp(),
  queueSize: 0,
};

const POLL_INTERVAL_MS = 10000;

export function useOnlineStatus() {
  const [state, setState] = useState<OfflineState>(initialState);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const updateState = useCallback(async () => {
    if (!isDesktopApp()) return;
    try {
      const status = await getOfflineStatus();
      setState(status);
    } catch {}
  }, []);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;
    const handleApiOffline = () => { if (mounted) updateState(); };
    const handleBrowserOnline = () => { if (mounted) updateState(); };
    const handleBrowserOffline = () => {
      if (mounted) {
        setState((prev) => ({ ...prev, status: 'offline' }));
      }
    };

    const init = async () => {
      if (!isDesktopApp()) {
        if (mounted) {
          setState((prev) => ({ ...prev, isDesktopApp: false }));
          setLoading(false);
        }
        return;
      }

      const status = await getOfflineStatus();
      if (mounted) {
        setState(status);
        setLoading(false);
      }

      // Listen for IPC events from main process
      unsubscribe = onOfflineStatusChange((newStatus) => {
        if (mounted) {
          setState(newStatus);
        }
      });

      // Listen for API-detected offline events (from api.ts interceptor)
      window.addEventListener('app:offline-detected', handleApiOffline);

      // Periodic poll as fallback (in case IPC events are missed)
      pollRef.current = setInterval(async () => {
        if (mounted) {
          await updateState();
        }
      }, POLL_INTERVAL_MS);

      // Browser online/offline events
      window.addEventListener('online', handleBrowserOnline);
      window.addEventListener('offline', handleBrowserOffline);
    };

    init();

    return () => {
      mounted = false;
      window.removeEventListener('app:offline-detected', handleApiOffline);
      window.removeEventListener('online', handleBrowserOnline);
      window.removeEventListener('offline', handleBrowserOffline);
      if (unsubscribe) unsubscribe();
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [updateState]);

  const refresh = useCallback(async () => {
    if (!isDesktopApp()) return;
    const status = await getOfflineStatus();
    setState(status);
  }, []);

  return {
    ...state,
    loading,
    isOnline: state.status === 'online',
    isOffline: state.status === 'offline',
    isSyncing: state.status === 'syncing',
    refresh,
  };
}
