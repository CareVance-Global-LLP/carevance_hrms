const AUTH_STORAGE_KEYS = ['token', 'user', 'organization'] as const;
const PERSISTED_AUTH_STORAGE_KEYS = ['user', 'organization'] as const;

export type AuthStorageKey = (typeof AUTH_STORAGE_KEYS)[number];
type PersistedAuthStorageKey = (typeof PERSISTED_AUTH_STORAGE_KEYS)[number];

let inMemoryAuthToken: string | null = null;

const hasWindow = () => typeof window !== 'undefined';

const getPreferredAuthStorage = (): Storage | null => {
  if (!hasWindow()) {
    return null;
  }

  return window.desktopTracker ? window.localStorage : window.sessionStorage;
};

const getSecondaryAuthStorage = (): Storage | null => {
  if (!hasWindow()) {
    return null;
  }

  return window.desktopTracker ? window.sessionStorage : window.localStorage;
};

export const getStoredAuthValue = (key: AuthStorageKey) => {
  if (key === 'token') {
    if (inMemoryAuthToken !== null) {
      return inMemoryAuthToken;
    }

    const preferredStorage = getPreferredAuthStorage();
    const secondaryStorage = getSecondaryAuthStorage();
    const storedToken = preferredStorage?.getItem('token')
      ?? secondaryStorage?.getItem('token')
      ?? null;

    if (storedToken !== null && storedToken !== undefined) {
      inMemoryAuthToken = storedToken;
      preferredStorage?.setItem('token', storedToken);
      secondaryStorage?.removeItem('token');
    }

    return inMemoryAuthToken;
  }

  const preferredStorage = getPreferredAuthStorage();
  const preferredValue = preferredStorage?.getItem(key);

  if (preferredValue !== null && preferredValue !== undefined) {
    return preferredValue;
  }

  return getSecondaryAuthStorage()?.getItem(key) ?? null;
};

export const setStoredAuthValue = (key: AuthStorageKey, value: string) => {
  if (key === 'token') {
    inMemoryAuthToken = value;
    getPreferredAuthStorage()?.setItem('token', value);
    getSecondaryAuthStorage()?.removeItem('token');
    return;
  }

  getPreferredAuthStorage()?.setItem(key, value);
  getSecondaryAuthStorage()?.removeItem(key);
};

export const removeStoredAuthValue = (key: AuthStorageKey) => {
  if (key === 'token') {
    inMemoryAuthToken = null;
  }
  getPreferredAuthStorage()?.removeItem(key);
  getSecondaryAuthStorage()?.removeItem(key);
};

export const clearAuthStorage = () => {
  AUTH_STORAGE_KEYS.forEach((key) => {
    removeStoredAuthValue(key);
  });
};



export const migrateStoredAuth = () => {
  const preferredStorage = getPreferredAuthStorage();
  const secondaryStorage = getSecondaryAuthStorage();

  if (!preferredStorage || !secondaryStorage || preferredStorage === secondaryStorage) {
    inMemoryAuthToken = getStoredAuthValue('token');
    return;
  }

  const legacyToken = preferredStorage.getItem('token') ?? secondaryStorage.getItem('token');
  if (legacyToken !== null) {
    inMemoryAuthToken = legacyToken;
    preferredStorage.setItem('token', legacyToken);
  }
  secondaryStorage.removeItem('token');

  PERSISTED_AUTH_STORAGE_KEYS.forEach((key: PersistedAuthStorageKey) => {
    const preferredValue = preferredStorage.getItem(key);
    const secondaryValue = secondaryStorage.getItem(key);

    if ((preferredValue === null || preferredValue === undefined) && secondaryValue !== null) {
      preferredStorage.setItem(key, secondaryValue);
    }

    secondaryStorage.removeItem(key);
  });
};
