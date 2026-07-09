const AUTH_STORAGE_KEYS = ['token', 'user', 'organization'] as const;
const PERSISTED_AUTH_STORAGE_KEYS = ['user', 'organization'] as const;

export type AuthStorageKey = (typeof AUTH_STORAGE_KEYS)[number];
type PersistedAuthStorageKey = (typeof PERSISTED_AUTH_STORAGE_KEYS)[number];

// In-memory storage for sensitive data (cleared on page refresh)
let inMemoryAuthToken: string | null = null;
let inMemoryUser: string | null = null;
let inMemoryOrganization: string | null = null;

// Minimal data that can be safely stored in localStorage (non-sensitive metadata only)
interface MinimalUserData {
  id: number;
  name: string;
  email: string;
  role: string;
  organization_id: number;
}

interface MinimalOrganizationData {
  id: number;
  name: string;
  slug: string;
}

const hasWindow = () => typeof window !== 'undefined';

const safelyAccessStorage = <T>(operation: () => T, fallback: T): T => {
  try {
    return operation();
  } catch {
    return fallback;
  }
};

const getStorageItem = (storage: Storage | null, key: string): string | null =>
  safelyAccessStorage(() => storage?.getItem(key) ?? null, null);

const setStorageItem = (storage: Storage | null, key: string, value: string) => {
  safelyAccessStorage(() => {
    storage?.setItem(key, value);
    return true;
  }, false);
};

const removeStorageItem = (storage: Storage | null, key: string) => {
  safelyAccessStorage(() => {
    storage?.removeItem(key);
    return true;
  }, false);
};

const getPreferredAuthStorage = (): Storage | null => {
  if (!hasWindow()) {
    return null;
  }

  // Always prefer sessionStorage for security (cleared when browser closes)
  // Use localStorage only in desktop environment
  return safelyAccessStorage(
    () => (window.desktopTracker ? window.localStorage : window.sessionStorage),
    null,
  );
};

const getSecondaryAuthStorage = (): Storage | null => {
  if (!hasWindow()) {
    return null;
  }

  return safelyAccessStorage(
    () => (window.desktopTracker ? window.sessionStorage : window.localStorage),
    null,
  );
};

export const getStoredAuthValue = (key: AuthStorageKey) => {
  // Always use in-memory storage for sensitive data first
  if (key === 'token') {
    if (inMemoryAuthToken !== null) {
      return inMemoryAuthToken;
    }

    // Try to restore from sessionStorage on page reload
    if (typeof window !== 'undefined') {
      const storedToken = window.sessionStorage.getItem('token');
      if (storedToken) {
        inMemoryAuthToken = storedToken;
        return inMemoryAuthToken;
      }
    }
    
    return null;
  }
  
  if (key === 'user') {
    if (inMemoryUser !== null) {
      return inMemoryUser;
    }
    // Restore from sessionStorage
    if (typeof window !== 'undefined') {
      const storedUser = window.sessionStorage.getItem('user');
      if (storedUser) {
        inMemoryUser = storedUser;
        return inMemoryUser;
      }
    }
    return null;
  }
  
  if (key === 'organization') {
    if (inMemoryOrganization !== null) {
      return inMemoryOrganization;
    }
    // Restore from sessionStorage
    if (typeof window !== 'undefined') {
      const storedOrg = window.sessionStorage.getItem('organization');
      if (storedOrg) {
        inMemoryOrganization = storedOrg;
        return inMemoryOrganization;
      }
    }
    return null;
  }

  return null;
};

export const setStoredAuthValue = (key: AuthStorageKey, value: string) => {
    if (key === 'token') {
    inMemoryAuthToken = value;
    // Persist token to sessionStorage for web app persistence across reloads
    // Use sessionStorage (not localStorage) for security - cleared when browser closes
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('token', value);
    }
    return;
  }
  
  if (key === 'user') {
    inMemoryUser = value;
    // Persist to sessionStorage for page reload persistence
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('user', value);
    }
    return;
  }
  
  if (key === 'organization') {
    inMemoryOrganization = value;
    // Persist to sessionStorage for page reload persistence
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('organization', value);
    }
    return;
  }
};

export const removeStoredAuthValue = (key: AuthStorageKey) => {
  // Clear from memory
  if (key === 'token') {
    inMemoryAuthToken = null;
  } else if (key === 'user') {
    inMemoryUser = null;
  } else if (key === 'organization') {
    inMemoryOrganization = null;
  }
  
  // Clear from sessionStorage
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(key);
  }
  
  // Clear from all storage
  removeStorageItem(getPreferredAuthStorage(), key);
  removeStorageItem(getSecondaryAuthStorage(), key);
};

export const clearAuthStorage = () => {
  // Clear memory
  inMemoryAuthToken = null;
  inMemoryUser = null;
  inMemoryOrganization = null;
  
  // Clear sessionStorage
  if (typeof window !== 'undefined') {
    AUTH_STORAGE_KEYS.forEach((key) => {
      window.sessionStorage.removeItem(key);
    });
  }
  
  // Clear all storage
  AUTH_STORAGE_KEYS.forEach((key) => {
    removeStorageItem(getPreferredAuthStorage(), key);
    removeStorageItem(getSecondaryAuthStorage(), key);
  });
};



export const migrateStoredAuth = () => {
  // The primary store (sessionStorage on web, localStorage on desktop) is the
  // per-tab source of truth. It MUST be preserved across reloads so a tab keeps
  // its own session and is not forced to fall back to the shared httpOnly cookie
  // (which other tabs can overwrite when a different user logs in). Only clean up
  // the legacy secondary store.
  const primaryStorage = getPreferredAuthStorage();
  const legacyStorage = getSecondaryAuthStorage();

  const migrateKey = (key: AuthStorageKey, setInMemory: (value: string) => void) => {
    const fromPrimary = primaryStorage?.getItem(key) ?? null;
    const fromLegacy = legacyStorage?.getItem(key) ?? null;
    const value = fromPrimary ?? fromLegacy;

    if (value !== null) {
      setInMemory(value);
      // Ensure the primary store holds the value (idempotent for per-tab persistence).
      primaryStorage?.setItem(key, value);
      // Clean up only the legacy location, never the primary.
      if (fromLegacy !== null) {
        legacyStorage?.removeItem(key);
      }
    }
  };

  migrateKey('token', (value) => { inMemoryAuthToken = value; });
  migrateKey('user', (value) => { inMemoryUser = value; });
  migrateKey('organization', (value) => { inMemoryOrganization = value; });
};
