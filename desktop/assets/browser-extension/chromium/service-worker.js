export const isTrackableBrowserUrl = (url) => {
  const value = String(url || '').trim().toLowerCase();
  if (!value) return false;

  return /^https?:\/\//.test(value);
};

const SESSION_TOKEN_STORAGE_KEY = 'bridgeSessionTokensByBrowserProfile';
const HEARTBEAT_ALARM_NAME = 'browser-tracking-heartbeat';
const HEARTBEAT_PERIOD_MINUTES = 0.5;
let lastFocusedTrackableTab = null;

export const buildBrowserTrackingEvent = ({
  kind,
  browserName,
  profileKey,
  recordedAt,
  tab,
}) => {
  const url = String(tab?.url || '').trim();
  const allowsMissingUrl = kind === 'tab-closed' || kind === 'window-blurred';
  if (!allowsMissingUrl && !isTrackableBrowserUrl(url)) {
    return null;
  }

  return {
    kind,
    browser_name: String(browserName || '').trim().toLowerCase(),
    profile_key: String(profileKey || '').trim(),
    tab_id: Number(tab?.id || 0) || null,
    window_id: Number(tab?.windowId || 0) || null,
    url: url || null,
    title: String(tab?.title || '').trim() || null,
    recorded_at: recordedAt,
  };
};

export const getBrowserProfileId = async () => {
  const { browserProfileId = '' } = await chrome.storage.local.get('browserProfileId');
  return String(browserProfileId || '').trim();
};

export const getBrowserBridgeCredential = async (profileKey) => {
  const { bridgeCredentialsByBrowserProfile = {} } = await chrome.storage.local.get(
    'bridgeCredentialsByBrowserProfile'
  );
  const normalizedProfileKey = String(profileKey || '').trim();
  const credential = bridgeCredentialsByBrowserProfile[normalizedProfileKey];
  if (!credential?.local_url) {
    return null;
  }

  const { [SESSION_TOKEN_STORAGE_KEY]: sessionTokensByProfile = {} } = await chrome.storage.session.get(
    SESSION_TOKEN_STORAGE_KEY
  );
  const sessionToken = String(sessionTokensByProfile?.[normalizedProfileKey] || '').trim();
  const legacyToken = String(credential?.bearer_token || '').trim();
  const bearerToken = sessionToken || legacyToken;
  if (!bearerToken) {
    return null;
  }

  if (!sessionToken && legacyToken) {
    await chrome.storage.session.set({
      [SESSION_TOKEN_STORAGE_KEY]: {
        ...sessionTokensByProfile,
        [normalizedProfileKey]: legacyToken,
      },
    });

    await chrome.storage.local.set({
      bridgeCredentialsByBrowserProfile: {
        ...bridgeCredentialsByBrowserProfile,
        [normalizedProfileKey]: {
          ...credential,
          bearer_token: undefined,
        },
      },
    });
  }

  return {
    ...credential,
    bearer_token: bearerToken,
  };
};

export const postBrowserTrackingEvent = async (event, credential) => {
  if (!credential?.bearer_token || !credential?.local_url) {
    throw new Error('Browser bridge is not paired.');
  }

  const response = await fetch(`${credential.local_url}/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${credential.bearer_token}`,
    },
    body: JSON.stringify(event),
  });

  if (!response.ok) {
    throw new Error(`Browser bridge responded with ${response.status}`);
  }
};

const rememberTrackableTab = (tab) => {
  const url = String(tab?.url || '').trim();
  if (!isTrackableBrowserUrl(url)) {
    return;
  }

  lastFocusedTrackableTab = {
    id: Number(tab?.id || 0) || null,
    windowId: Number(tab?.windowId || 0) || null,
    url,
    title: String(tab?.title || '').trim() || null,
  };
};

export const emitTrackedTab = async (kind, tab) => {
  const profileKey = await getBrowserProfileId();
  const event = buildBrowserTrackingEvent({
    kind,
    browserName: 'chrome',
    profileKey,
    recordedAt: new Date().toISOString(),
    tab,
  });

  if (!event) {
    return;
  }

  const credential = await getBrowserBridgeCredential(profileKey);
  if (!credential) {
    return;
  }

  await postBrowserTrackingEvent(event, credential);

  if (event.url) {
    rememberTrackableTab(tab);
  }
};

export const emitTrackedBrowserClose = async (kind, tab = lastFocusedTrackableTab) => {
  const profileKey = await getBrowserProfileId();
  const event = buildBrowserTrackingEvent({
    kind,
    browserName: 'chrome',
    profileKey,
    recordedAt: new Date().toISOString(),
    tab,
  });

  if (!event) {
    return;
  }

  const credential = await getBrowserBridgeCredential(profileKey);
  if (!credential) {
    return;
  }

  await postBrowserTrackingEvent(event, credential);
  lastFocusedTrackableTab = null;
};

export const emitHeartbeat = async () => {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
    return;
  }

  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });

  if (!tab) {
    return;
  }

  await emitTrackedTab('heartbeat', tab);
};

export const registerBrowserEventListeners = () => {
  if (
    typeof chrome === 'undefined'
    || !chrome.tabs?.onActivated
    || !chrome.tabs?.onUpdated
    || !chrome.tabs?.onRemoved
    || !chrome.tabs?.query
    || !chrome.alarms?.create
    || !chrome.alarms?.onAlarm
    || !chrome.windows?.onFocusChanged
  ) {
    return;
  }

  chrome.tabs.onActivated.addListener(({ tabId }) => {
    void (async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        await emitTrackedTab('tab-focused', tab);
      } catch {
        // Ignore transient tab lookup failures.
      }
    })();
  });

  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') {
      return;
    }

    void emitTrackedTab('tab-updated', tab).catch(() => {
      // Ignore transient bridge failures.
    });
  });

  chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (!lastFocusedTrackableTab || lastFocusedTrackableTab.id !== tabId) {
      return;
    }

    void emitTrackedBrowserClose('tab-closed', {
      ...lastFocusedTrackableTab,
      windowId: removeInfo.windowId,
    }).catch(() => {
      // Ignore transient bridge failures.
    });
  });

  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE || !lastFocusedTrackableTab) {
      return;
    }

    void emitTrackedBrowserClose('window-blurred').catch(() => {
      // Ignore transient bridge failures.
    });
  });

  chrome.alarms.create(HEARTBEAT_ALARM_NAME, {
    periodInMinutes: HEARTBEAT_PERIOD_MINUTES,
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== HEARTBEAT_ALARM_NAME) {
      return;
    }

    void emitHeartbeat().catch(() => {
      // Ignore transient bridge failures.
    });
  });
};

registerBrowserEventListeners();
