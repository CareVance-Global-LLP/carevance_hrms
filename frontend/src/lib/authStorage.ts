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

const getPreferredAuthStorage = (): Storage | null => {
  if (!hasWindow()) {
    return null;
  }

  // Always prefer sessionStorage for security (cleared when browser closes)
  // Use localStorage only in desktop environment
  return window.desktopTracker ? window.localStorage : window.sessionStorage;
};

const getSecondaryAuthStorage = (): Storage | null => {
  if (!hasWindow()) {
    return null;
  }

  return window.desktopTracker ? window.sessionStorage : window.localStorage;
};

export const getStoredAuthValue = (key: AuthStorageKey) => {
  // Always use in-memory storage for sensitive data first
  if (key === 'token') {
    if (inMemoryAuthToken !== null) {
      return inMemoryAuthToken;
    }

    // Try to restore from storage (for desktop app persistence)
    const preferredStorage = getPreferredAuthStorage();
    const storedToken = preferredStorage?.getItem('token') ?? null;
    
    if (storedToken) {
      inMemoryAuthToken = storedToken;
      return inMemoryAuthToken;
    }
    
    return null;
  }
  
  if (key === 'user') {
    if (inMemoryUser !== null) {
      return inMemoryUser;
    }
    return null;
  }
  
  if (key === 'organization') {
    if (inMemoryOrganization !== null) {
      return inMemoryOrganization;
    }
    return null;
  }

  return null;
};

export const setStoredAuthValue = (key: AuthStorageKey, value: string) => {
  if (key === 'token') {
    inMemoryAuthToken = value;
    // Only persist token in storage for desktop app
    if (typeof window !== 'undefined' && window.desktopTracker) {
      getPreferredAuthStorage()?.setItem('token', value);
    }
    return;
  }
  
  if (key === 'user') {
    inMemoryUser = value;
    // Store only minimal non-sensitive user data
    try {
      const userData = JSON.parse(value);
      const minimalUser: MinimalUserData = {
        id: userData.id,
        name: userData.name,
        email: userData.email,
        role: userData.role,
        organization_id: userData.organization_id,
      };
      // Only store in sessionStorage, never localStorage (unless desktop)
      getPreferredAuthStorage()?.setItem(key, JSON.stringify(minimalUser));
    } catch {
      // If parsing fails, don't store
    }
    return;
  }
  
  if (key === 'organization') {
    inMemoryOrganization = value;
    // Store only minimal non-sensitive organization data
    try {
      const orgData = JSON.parse(value);
      const minimalOrg: MinimalOrganizationData = {
        id: orgData.id,
        name: orgData.name,
        slug: orgData.slug,
      };
      getPreferredAuthStorage()?.setItem(key, JSON.stringify(minimalOrg));
    } catch {
      // If parsing fails, don't store
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
  
  // Clear from all storage
  getPreferredAuthStorage()?.removeItem(key);
  getSecondaryAuthStorage()?.removeItem(key);
};

export const clearAuthStorage = () => {
  // Clear memory
  inMemoryAuthToken = null;
  inMemoryUser = null;
  inMemoryOrganization = null;
  
  // Clear all storage
  AUTH_STORAGE_KEYS.forEach((key) => {
    getPreferredAuthStorage()?.removeItem(key);
    getSecondaryAuthStorage()?.removeItem(key);
  });
};



export const migrateStoredAuth = () => {
  const preferredStorage = getPreferredAuthStorage();
  const secondaryStorage = getSecondaryAuthStorage();

  if (!preferredStorage || !secondaryStorage || preferredStorage === secondaryStorage) {
    return;
  }

  // Migrate token to memory (don't persist in secondary storage)
  const legacyToken = preferredStorage.getItem('token') ?? secondaryStorage.getItem('token');
  if (legacyToken !== null) {
    inMemoryAuthToken = legacyToken;
    // Only keep in preferred storage if it's sessionStorage (more secure)
    if (preferredStorage === window.sessionStorage) {
      preferredStorage.setItem('token', legacyToken);
    }
  }
  secondaryStorage.removeItem('token');

  // Migrate user/org data but only store minimal data
  PERSISTED_AUTH_STORAGE_KEYS.forEach((key: PersistedAuthStorageKey) => {
    const preferredValue = preferredStorage.getItem(key);
    const secondaryValue = secondaryStorage.getItem(key);
    
    let valueToMigrate = preferredValue ?? secondaryValue;
    
    if (valueToMigrate) {
      try {
        const data = JSON.parse(valueToMigrate);
        // Store minimal version
        if (key === 'user') {
          const minimalUser: MinimalUserData = {
            id: data.id,
            name: data.name,
            email: data.email,
            role: data.role,
            organization_id: data.organization_id,
          };
          preferredStorage.setItem(key, JSON.stringify(minimalUser));
        } else if (key === 'organization') {
          const minimalOrg: MinimalOrganizationData = {
            id: data.id,
            name: data.name,
            slug: data.slug,
          };
          preferredStorage.setItem(key, JSON.stringify(minimalOrg));
        }
      } catch {
        // Invalid JSON, remove it
        preferredStorage.removeItem(key);
      }
    }

    secondaryStorage.removeItem(key);
  });
};
