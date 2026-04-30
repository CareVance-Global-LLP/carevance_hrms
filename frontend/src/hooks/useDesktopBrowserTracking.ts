import { useEffect, useRef, useState } from 'react';
import type { BrowserTrackingPairingCode, BrowserTrackingState } from '@/types';

const DEFAULT_STATE: BrowserTrackingState = {
  ready: false,
  local_url: null,
  connections: [],
  pairing_code: null,
  last_event_at: null,
  last_error: null,
};

const sanitizeBrowserTrackingState = (
  nextState: BrowserTrackingState | null | undefined,
  userId?: number | null
): BrowserTrackingState => {
  if (!nextState || !userId) {
    return {
      ...DEFAULT_STATE,
      ready: Boolean(nextState?.ready),
      local_url: nextState?.local_url ?? null,
      last_event_at: nextState?.last_event_at ?? null,
      last_error: nextState?.last_error ?? null,
    };
  }

  const scopedConnections = Array.isArray(nextState.connections)
    ? nextState.connections.filter((connection) => Number(connection.user_id) === Number(userId))
    : [];
  const scopedPairingCode = Number(nextState.pairing_code?.user_id) === Number(userId)
    ? nextState.pairing_code
    : null;
  const pairingExpiresAt = scopedPairingCode?.expires_at ? new Date(scopedPairingCode.expires_at).getTime() : Number.NaN;

  return {
    ...DEFAULT_STATE,
    ...nextState,
    connections: scopedConnections,
    pairing_code: Number.isFinite(pairingExpiresAt) && pairingExpiresAt > Date.now() ? scopedPairingCode : null,
  };
};

export const useDesktopBrowserTracking = (userId?: number | null) => {
  const [state, setState] = useState<BrowserTrackingState>(DEFAULT_STATE);
  const [isPairingCodePending, setIsPairingCodePending] = useState(false);
  const [isInstallPending, setIsInstallPending] = useState(false);
  const [isInstallGuidePending, setIsInstallGuidePending] = useState(false);
  const [isOptionsPending, setIsOptionsPending] = useState(false);
  const [pairingError, setPairingError] = useState('');
  const activePairingRequestIdRef = useRef(0);
  const currentUserIdRef = useRef<number | null>(userId ?? null);

  useEffect(() => {
    currentUserIdRef.current = userId ?? null;
    activePairingRequestIdRef.current += 1;
  }, [userId]);

  useEffect(() => {
    const desktopApi = window.desktopTracker;
    setState((currentState) => ({
      ...DEFAULT_STATE,
      ready: currentState.ready,
      local_url: currentState.local_url,
      last_event_at: currentState.last_event_at,
      last_error: currentState.last_error,
    }));
    setPairingError('');
    setIsPairingCodePending(false);
    setIsInstallPending(false);
    setIsInstallGuidePending(false);
    setIsOptionsPending(false);

    if (!desktopApi?.getBrowserTrackingState) {
      setState(DEFAULT_STATE);
      return;
    }

    let active = true;

    const bootstrap = async () => {
      try {
        const nextState = await desktopApi.getBrowserTrackingState?.();
        if (active && nextState) {
          setState(sanitizeBrowserTrackingState(nextState, userId));
        }
      } catch (error) {
        if (active) {
          setPairingError(error instanceof Error ? error.message : 'Unable to load browser tracking status.');
        }
      }
    };

    void bootstrap();

    const unsubscribe = desktopApi.onBrowserTrackingState?.((nextState) => {
      if (!active) {
        return;
      }

      setState(sanitizeBrowserTrackingState(nextState, userId));
      if (!nextState.last_error) {
        setPairingError('');
      }
    });

    return () => {
      active = false;
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      } else {
        desktopApi.clearBrowserTrackingStateListeners?.();
      }
    };
  }, [userId]);

  useEffect(() => {
    const pairingCode = state.pairing_code;
    if (!pairingCode?.expires_at) {
      return;
    }

    const expiresAt = new Date(pairingCode.expires_at).getTime();
    if (!Number.isFinite(expiresAt)) {
      return;
    }

    const delay = expiresAt - Date.now();
    if (delay <= 0) {
      setState((currentState) => (currentState.pairing_code ? { ...currentState, pairing_code: null } : currentState));
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setState((currentState) => (
        currentState.pairing_code?.value === pairingCode.value
          ? { ...currentState, pairing_code: null }
          : currentState
      ));
    }, delay + 1);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [state.pairing_code]);

  const createPairingCode = async (browserName = 'chrome'): Promise<BrowserTrackingPairingCode | null> => {
    if (!window.desktopTracker?.createBrowserTrackingPairingCode) {
      setPairingError('Browser tracking pairing is not available in this desktop build.');
      return null;
    }

    if (!userId) {
      setPairingError('Sign in again to generate a browser pairing code.');
      return null;
    }

    const pairingRequestId = activePairingRequestIdRef.current + 1;
    activePairingRequestIdRef.current = pairingRequestId;
    const requestUserId = Number(userId);
    setIsPairingCodePending(true);
    setPairingError('');

    try {
      const pairingCode = await window.desktopTracker.createBrowserTrackingPairingCode({
        browser_name: browserName,
        user_id: userId,
      });

      const requestIsCurrent =
        activePairingRequestIdRef.current === pairingRequestId &&
        currentUserIdRef.current === requestUserId;

      if (!requestIsCurrent) {
        return null;
      }

      if (pairingCode) {
        setState((currentState) => ({
          ...currentState,
          pairing_code: {
            ...pairingCode,
            browser_name: browserName,
            user_id: requestUserId,
          },
        }));
      }

      return pairingCode;
    } catch (error) {
      if (
        activePairingRequestIdRef.current !== pairingRequestId ||
        currentUserIdRef.current !== requestUserId
      ) {
        return null;
      }

      setPairingError(error instanceof Error ? error.message : 'Unable to create browser pairing code.');
      return null;
    } finally {
      if (
        activePairingRequestIdRef.current === pairingRequestId &&
        currentUserIdRef.current === requestUserId
      ) {
        setIsPairingCodePending(false);
      }
    }
  };

  const openInstallGuide = async (browserName = 'chrome'): Promise<boolean> => {
    if (!window.desktopTracker?.openBrowserTrackingGuide) {
      setPairingError('Browser extension install guidance is not available in this desktop build.');
      return false;
    }

    setIsInstallGuidePending(true);
    setPairingError('');

    try {
      return await window.desktopTracker.openBrowserTrackingGuide({
        browser_name: browserName,
      });
    } catch (error) {
      setPairingError(error instanceof Error ? error.message : 'Unable to open the browser extension install guide.');
      return false;
    } finally {
      setIsInstallGuidePending(false);
    }
  };

  const openInstall = async (browserName = 'chrome'): Promise<boolean> => {
    if (!window.desktopTracker?.openBrowserTrackingInstall) {
      if (window.desktopTracker?.openBrowserTrackingGuide) {
        setIsInstallPending(true);
        setPairingError('');

        try {
          const opened = await window.desktopTracker.openBrowserTrackingGuide({
            browser_name: browserName,
          });
          if (opened) {
            setPairingError('Direct install is not available in this desktop build yet, so the local extension folder was opened instead.');
          }
          return opened;
        } catch (error) {
          setPairingError(error instanceof Error ? error.message : 'Unable to open the browser extension install folder.');
          return false;
        } finally {
          setIsInstallPending(false);
        }
      }

      setPairingError('Browser extension installation is not available in this desktop build.');
      return false;
    }

    setIsInstallPending(true);
    setPairingError('');

    try {
      return await window.desktopTracker.openBrowserTrackingInstall({
        browser_name: browserName,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open the browser extension install page.';
      const missingInstallHandler =
        typeof message === 'string'
        && message.toLowerCase().includes('desktop:open-browser-tracking-install');

      if (missingInstallHandler && window.desktopTracker?.openBrowserTrackingGuide) {
        try {
          const opened = await window.desktopTracker.openBrowserTrackingGuide({
            browser_name: browserName,
          });
          if (opened) {
            setPairingError('Your current desktop shell is still on the older install flow, so the local extension folder was opened instead. Restart the desktop app to enable the direct install button.');
          }
          return opened;
        } catch (fallbackError) {
          setPairingError(fallbackError instanceof Error ? fallbackError.message : 'Unable to open the browser extension install folder.');
          return false;
        }
      }

      setPairingError(message);
      return false;
    } finally {
      setIsInstallPending(false);
    }
  };

  const openExtensionOptions = async (extensionOrigin?: string | null): Promise<boolean> => {
    if (!window.desktopTracker?.openBrowserTrackingOptions) {
      setPairingError('Opening the browser extension options page is not available in this desktop build.');
      return false;
    }

    const normalizedOrigin = String(extensionOrigin || '').trim();
    if (!normalizedOrigin) {
      setPairingError('Install and pair the extension first, then reopen its options from here.');
      return false;
    }

    setIsOptionsPending(true);
    setPairingError('');

    try {
      return await window.desktopTracker.openBrowserTrackingOptions({
        extension_origin: normalizedOrigin,
      });
    } catch (error) {
      setPairingError(error instanceof Error ? error.message : 'Unable to open the browser extension options page.');
      return false;
    } finally {
      setIsOptionsPending(false);
    }
  };

  return {
    state,
    isPairingCodePending,
    isInstallPending,
    isInstallGuidePending,
    isOptionsPending,
    pairingError,
    createPairingCode,
    openInstall,
    openInstallGuide,
    openExtensionOptions,
  };
};
