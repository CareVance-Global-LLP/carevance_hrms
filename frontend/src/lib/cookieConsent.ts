export type CookieConsentStatus = 'pending' | 'accepted' | 'rejected';

export interface CookieConsentState {
  status: CookieConsentStatus;
  preferences: {
    analytics: boolean;
  };
  version: number;
  updatedAt: string | null;
}

export const COOKIE_CONSENT_STORAGE_KEY = 'carevance:cookie-consent';
export const COOKIE_CONSENT_VERSION = 1;

export const defaultCookieConsentState: CookieConsentState = {
  status: 'pending',
  preferences: {
    analytics: false,
  },
  version: COOKIE_CONSENT_VERSION,
  updatedAt: null,
};

const safelyGetCookieConsentValue = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
  } catch {
    return null;
  }
};

const safelySetCookieConsentValue = (value: string) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, value);
  } catch {
    // Ignore storage failures so consent persistence never crashes rendering.
  }
};

export function loadCookieConsentState(): CookieConsentState {
  if (typeof window === 'undefined') {
    return defaultCookieConsentState;
  }

  const rawValue = safelyGetCookieConsentValue();

  if (!rawValue) {
    return defaultCookieConsentState;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<CookieConsentState>;

    if (parsed.version !== COOKIE_CONSENT_VERSION) {
      return defaultCookieConsentState;
    }

    return {
      status: parsed.status === 'accepted' || parsed.status === 'rejected' ? parsed.status : 'pending',
      preferences: {
        analytics: Boolean(parsed.preferences?.analytics),
      },
      version: COOKIE_CONSENT_VERSION,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    };
  } catch {
    return defaultCookieConsentState;
  }
}

export function persistCookieConsentState(nextState: CookieConsentState) {
  if (typeof window === 'undefined') {
    return;
  }

  safelySetCookieConsentValue(JSON.stringify(nextState));
}

export function buildAcceptedCookieConsentState(): CookieConsentState {
  return {
    status: 'accepted',
    preferences: {
      analytics: true,
    },
    version: COOKIE_CONSENT_VERSION,
    updatedAt: new Date().toISOString(),
  };
}

export function buildRejectedCookieConsentState(): CookieConsentState {
  return {
    status: 'rejected',
    preferences: {
      analytics: false,
    },
    version: COOKIE_CONSENT_VERSION,
    updatedAt: new Date().toISOString(),
  };
}

export function hasAnalyticsConsent(consentState: CookieConsentState) {
  return consentState.preferences.analytics;
}
