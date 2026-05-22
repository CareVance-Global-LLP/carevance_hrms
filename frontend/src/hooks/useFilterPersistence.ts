import { useState, useEffect, useCallback } from 'react';

interface UseFilterPersistenceOptions<T> {
  storageKey: string;
  defaultValues: T;
}

export function useFilterPersistence<T extends Record<string, any>>(
  options: UseFilterPersistenceOptions<T>
) {
  const { storageKey, defaultValues } = options;

  const [filters, setFilters] = useState<T>(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge with defaults to ensure all keys exist
        return { ...defaultValues, ...parsed };
      }
    } catch {
      // Ignore parse errors
    }
    return defaultValues;
  });

  const updateFilter = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setFilters(prev => {
      const updated = { ...prev, [key]: value };
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(updated));
      } catch {
        // Ignore storage errors
      }
      return updated;
    });
  }, [storageKey]);

  const updateFilters = useCallback((updates: Partial<T>) => {
    setFilters(prev => {
      const updated = { ...prev, ...updates };
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(updated));
      } catch {
        // Ignore storage errors
      }
      return updated;
    });
  }, [storageKey]);

  const resetFilters = useCallback(() => {
    setFilters(defaultValues);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // Ignore storage errors
    }
  }, [defaultValues, storageKey]);

  const clearFilter = useCallback((key: keyof T) => {
    setFilters(prev => {
      const updated = { ...prev, [key]: defaultValues[key] };
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(updated));
      } catch {
        // Ignore storage errors
      }
      return updated;
    });
  }, [defaultValues, storageKey]);

  return {
    filters,
    updateFilter,
    updateFilters,
    resetFilters,
    clearFilter,
    setFilters,
  };
}
