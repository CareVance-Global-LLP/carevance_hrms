/**
 * Remembers what someone opens from the command bar, so their habits float up.
 *
 * Most searches in an HR tool are re-visits: the same four pages, over and
 * over. Storage is per-user and capped — a shared machine must not leak one
 * person's recent people-searches into the next person's palette.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

const STORAGE_PREFIX = 'carevance.commandBar.recent';
const MAX_ENTRIES = 40;
/** How many show in the idle palette before anyone types. */
export const RECENT_DISPLAY_COUNT = 5;

export interface RecentEntry {
  id: string;
  uses: number;
  lastUsedAt: number;
}

const storageKey = (userId: number | string | null | undefined) =>
  `${STORAGE_PREFIX}.${userId ?? 'anonymous'}`;

const read = (key: string): RecentEntry[] => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry.id === 'string')
      .map((entry) => ({
        id: entry.id,
        uses: Number(entry.uses) || 1,
        lastUsedAt: Number(entry.lastUsedAt) || 0,
      }));
  } catch {
    // Corrupt JSON or storage disabled — an empty history is a fine fallback.
    return [];
  }
};

const write = (key: string, entries: RecentEntry[]) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(entries));
  } catch {
    // Quota or private mode. Recents are a convenience, never a requirement.
  }
};

export interface UseRecentCommands {
  /** Ids most recently used first. */
  recentIds: string[];
  /** Usage count for an id, for the ranker's recency boost. */
  usesOf: (id: string) => number;
  remember: (id: string) => void;
  clear: () => void;
}

export function useRecentCommands(userId: number | string | null | undefined): UseRecentCommands {
  const key = storageKey(userId);
  const [entries, setEntries] = useState<RecentEntry[]>(() => read(key));

  // Switching user (or logging out and back in) must not carry history over.
  useEffect(() => {
    setEntries(read(key));
  }, [key]);

  const remember = useCallback(
    (id: string) => {
      if (!id) return;
      setEntries((previous) => {
        const existing = previous.find((entry) => entry.id === id);
        const next: RecentEntry[] = [
          {
            id,
            uses: (existing?.uses || 0) + 1,
            lastUsedAt: Date.now(),
          },
          ...previous.filter((entry) => entry.id !== id),
        ].slice(0, MAX_ENTRIES);

        write(key, next);
        return next;
      });
    },
    [key]
  );

  const clear = useCallback(() => {
    setEntries([]);
    write(key, []);
  }, [key]);

  const usesById = useMemo(() => {
    const map = new Map<string, number>();
    entries.forEach((entry) => map.set(entry.id, entry.uses));
    return map;
  }, [entries]);

  const usesOf = useCallback((id: string) => usesById.get(id) || 0, [usesById]);

  const recentIds = useMemo(
    () => entries.slice().sort((a, b) => b.lastUsedAt - a.lastUsedAt).map((entry) => entry.id),
    [entries]
  );

  return { recentIds, usesOf, remember, clear };
}
