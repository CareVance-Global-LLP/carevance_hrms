const STORAGE_KEYS = ['browserProfileId', 'bridgeCredentialsByBrowserProfile'];
const SESSION_TOKEN_STORAGE_KEY = 'bridgeSessionTokensByBrowserProfile';
const BRIDGE_LOCAL_URL = 'http://127.0.0.1:38947';

export const pairBrowserBridge = async ({
  fetchImpl = globalThis.fetch,
  pairingCode,
  browserProfileId,
  browserName = 'chrome',
  extensionVersion = '0.1.0',
  localUrl = BRIDGE_LOCAL_URL,
  extensionOrigin = globalThis.location?.origin || '',
} = {}) => {
  const response = await fetchImpl(`${localUrl}/pair`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      pairing_code: String(pairingCode || '').trim(),
      browser_name: String(browserName || '').trim().toLowerCase() || 'chrome',
      profile_key: String(browserProfileId || '').trim(),
      extension_version: String(extensionVersion || '').trim() || '0.1.0',
    }),
  });

  if (!response.ok) {
    let errorCode = '';
    try {
      const errorPayload = await response.json();
      errorCode = String(errorPayload?.error || '').trim();
    } catch {
      errorCode = '';
    }

    if (errorCode === 'invalid_pairing') {
      throw new Error('That pairing code is expired or no longer active. Generate a fresh code in the desktop app.');
    }

    if (errorCode === 'invalid_origin') {
      throw new Error('This extension is not allowed by the desktop app. Reinstall it from the desktop pairing guide.');
    }

    throw new Error(`Browser bridge responded with ${response.status}`);
  }

  const payload = await response.json();
  return buildBrowserBridgeCredential({
    browserProfileId,
    pairingCode,
    pairedAt: new Date().toISOString(),
    localUrl: payload.local_url || localUrl,
    bearerToken: payload.token,
    extensionOrigin,
    browserName,
    extensionVersion,
  });
};

export const ensureBrowserProfileId = async (storage = globalThis.chrome?.storage?.local) => {
  if (!storage) {
    throw new Error('Chrome storage is unavailable.');
  }

  const { browserProfileId } = await storage.get('browserProfileId');
  if (browserProfileId) {
    return String(browserProfileId);
  }

  const nextBrowserProfileId =
    globalThis.crypto?.randomUUID?.() || `browser-profile-${Date.now()}`;
  await storage.set({ browserProfileId: nextBrowserProfileId });
  return nextBrowserProfileId;
};

export const buildBrowserBridgeCredential = ({
  browserProfileId,
  pairingCode,
  pairedAt,
  localUrl,
  bearerToken,
  extensionOrigin,
  browserName = 'chrome',
  extensionVersion = '0.1.0',
}) => ({
  browser_profile_id: String(browserProfileId || '').trim(),
  pairing_code: String(pairingCode || '').trim(),
  paired_at: pairedAt,
  local_url: String(localUrl || '').trim(),
  extension_origin: String(extensionOrigin || '').trim(),
  browser_name: String(browserName || '').trim().toLowerCase() || 'chrome',
  extension_version: String(extensionVersion || '').trim() || '0.1.0',
  bridge_status: 'paired',
});

export const persistBridgeSessionToken = async ({
  sessionStorage = globalThis.chrome?.storage?.session,
  browserProfileId,
  bearerToken,
} = {}) => {
  if (!sessionStorage) {
    throw new Error('Chrome session storage is unavailable.');
  }

  const profileKey = String(browserProfileId || '').trim();
  const token = String(bearerToken || '').trim();
  if (!profileKey || !token) {
    throw new Error('A browser profile id and bearer token are required.');
  }

  const { [SESSION_TOKEN_STORAGE_KEY]: tokensByProfile = {} } = await sessionStorage.get(
    SESSION_TOKEN_STORAGE_KEY
  );

  await sessionStorage.set({
    [SESSION_TOKEN_STORAGE_KEY]: {
      ...tokensByProfile,
      [profileKey]: token,
    },
  });
};

export const loadBridgeSessionToken = async ({
  sessionStorage = globalThis.chrome?.storage?.session,
  browserProfileId,
} = {}) => {
  if (!sessionStorage) {
    return '';
  }

  const profileKey = String(browserProfileId || '').trim();
  if (!profileKey) {
    return '';
  }

  const { [SESSION_TOKEN_STORAGE_KEY]: tokensByProfile = {} } = await sessionStorage.get(
    SESSION_TOKEN_STORAGE_KEY
  );

  return String(tokensByProfile?.[profileKey] || '').trim();
};

export const loadOptions = async ({
  storage = globalThis.chrome?.storage?.local,
  sessionStorage = globalThis.chrome?.storage?.session,
  elements,
} = {}) => {
  if (!storage || !elements) {
    return;
  }

  try {
    const browserProfileId = await ensureBrowserProfileId(storage);
    const { bridgeCredentialsByBrowserProfile = {} } = await storage.get(
      STORAGE_KEYS
    );
    const credential = bridgeCredentialsByBrowserProfile[browserProfileId];
    const bearerToken = await loadBridgeSessionToken({
      sessionStorage,
      browserProfileId,
    });

    if (credential?.local_url && bearerToken) {
      elements.status.textContent = `Paired to browser profile ${browserProfileId}.`;
      return;
    }

    if (credential?.local_url) {
      elements.status.textContent = `Pairing expired for browser profile ${browserProfileId}. Pair again to continue tracking.`;
      return;
    }

    elements.status.textContent = `Not paired yet for browser profile ${browserProfileId}.`;
  } catch {
    elements.status.textContent = 'Unable to load pairing state.';
  }
};

export const saveOptions = async ({
  storage = globalThis.chrome?.storage?.local,
  sessionStorage = globalThis.chrome?.storage?.session,
  elements,
} = {}) => {
  if (!storage || !elements) {
    return;
  }

  try {
    const browserProfileId = await ensureBrowserProfileId(storage);
    const pairingCode = elements.profileCodeInput.value.trim();
    if (!pairingCode) {
      elements.status.textContent = 'Enter the pairing code from the desktop app before pairing.';
      return;
    }

    const credential = await pairBrowserBridge({
      pairingCode,
      browserProfileId,
      extensionVersion:
        globalThis.chrome?.runtime?.getManifest?.().version || '0.1.0',
    });

    const { bridgeCredentialsByBrowserProfile = {} } = await storage.get(
      'bridgeCredentialsByBrowserProfile'
    );

    await persistBridgeSessionToken({
      sessionStorage,
      browserProfileId,
      bearerToken: credential.bearer_token,
    });

    await storage.set({
      bridgeCredentialsByBrowserProfile: {
        ...bridgeCredentialsByBrowserProfile,
        [browserProfileId]: {
          ...credential,
          bearer_token: undefined,
        },
      },
    });

    elements.status.textContent = `Paired browser profile ${browserProfileId}.`;
  } catch (error) {
    if (error instanceof TypeError) {
      elements.status.textContent = 'Desktop app is not reachable. Open CareVance Tracker and try again.';
      return;
    }

    elements.status.textContent = error?.message || 'Unable to pair with the desktop app.';
  }
};

export const bootstrapOptionsPage = () => {
  if (typeof document === 'undefined' || typeof chrome === 'undefined') {
    return;
  }

  const elements = {
    profileCodeInput: document.getElementById('pairingCode'),
    pairButton: document.getElementById('pair'),
    status: document.getElementById('status'),
  };

  if (!elements.profileCodeInput || !elements.pairButton || !elements.status) {
    return;
  }

  elements.pairButton.addEventListener('click', () => {
    void saveOptions({ elements });
  });

  void loadOptions({ elements });
};

bootstrapOptionsPage();
