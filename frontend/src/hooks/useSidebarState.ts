/**
 * Sidebar width and open-group state, remembered per user.
 *
 * Both were previously component state in `Layout`, so every refresh reset
 * them. They are stored per user id because a shared machine must not carry
 * one person's layout into the next person's session.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

const COLLAPSE_PREFIX = 'carevance.sidebar.collapsed';
const GROUPS_PREFIX = 'carevance.sidebar.groups';

const keyFor = (prefix: string, userId: number | string | null | undefined) =>
  `${prefix}.${userId ?? 'anonymous'}`;

const readBoolean = (key: string): boolean => {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    // Private mode or storage disabled — expanded is the safe default.
    return false;
  }
};

const readGroups = (key: string): string[] => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
  } catch {
    return [];
  }
};

const write = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Layout preferences are a convenience, never a requirement.
  }
};

export interface UseSidebarState {
  collapsed: boolean;
  toggleCollapsed: () => void;
  setCollapsed: (next: boolean) => void;
  openGroups: ReadonlySet<string>;
  isGroupOpen: (label: string) => boolean;
  toggleGroup: (label: string) => void;
  /**
   * Opens `label` and closes every other group.
   *
   * The old auto-expand effect only ever added, so visiting three sections left
   * three open and the rail grew until it scrolled. Navigation now replaces the
   * open set rather than accumulating into it.
   */
  focusGroup: (label: string | null) => void;
}

export function useSidebarState(userId: number | string | null | undefined): UseSidebarState {
  const collapseKey = keyFor(COLLAPSE_PREFIX, userId);
  const groupsKey = keyFor(GROUPS_PREFIX, userId);

  const [collapsed, setCollapsedState] = useState(() => readBoolean(collapseKey));
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(readGroups(groupsKey)));

  // Switching user must not inherit the previous one's layout.
  useEffect(() => {
    setCollapsedState(readBoolean(collapseKey));
    setOpenGroups(new Set(readGroups(groupsKey)));
  }, [collapseKey, groupsKey]);

  const setCollapsed = useCallback(
    (next: boolean) => {
      setCollapsedState(next);
      write(collapseKey, next ? '1' : '0');
    },
    [collapseKey]
  );

  const toggleCollapsed = useCallback(() => {
    setCollapsedState((previous) => {
      const next = !previous;
      write(collapseKey, next ? '1' : '0');
      return next;
    });
  }, [collapseKey]);

  const persistGroups = useCallback(
    (next: Set<string>) => {
      write(groupsKey, JSON.stringify(Array.from(next)));
      return next;
    },
    [groupsKey]
  );

  const toggleGroup = useCallback(
    (label: string) => {
      setOpenGroups((previous) => {
        const next = new Set(previous);
        if (next.has(label)) next.delete(label);
        else next.add(label);
        return persistGroups(next);
      });
    },
    [persistGroups]
  );

  const focusGroup = useCallback(
    (label: string | null) => {
      setOpenGroups((previous) => {
        if (!label) {
          if (previous.size === 0) return previous;
          return persistGroups(new Set());
        }
        // Already exactly this group — don't churn state or storage.
        if (previous.size === 1 && previous.has(label)) return previous;
        return persistGroups(new Set([label]));
      });
    },
    [persistGroups]
  );

  const isGroupOpen = useCallback((label: string) => openGroups.has(label), [openGroups]);

  return useMemo(
    () => ({ collapsed, toggleCollapsed, setCollapsed, openGroups, isGroupOpen, toggleGroup, focusGroup }),
    [collapsed, focusGroup, isGroupOpen, openGroups, setCollapsed, toggleCollapsed, toggleGroup]
  );
}
