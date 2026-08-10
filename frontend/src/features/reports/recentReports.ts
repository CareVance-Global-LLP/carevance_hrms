const STORAGE_KEY = 'carevance.reports.recent';
const MAX_RECENTS = 4;

export interface RecentReport {
  to: string;
  title: string;
  at: number;
}

/**
 * Recently opened report modules, per browser.
 *
 * With eight destinations across two hubs, remembering which one you were in
 * yesterday was a memory test. Deliberately local — this is a convenience, not
 * a record, and it should not cost a table or a round trip.
 */
export const readRecentReports = (): RecentReport[] => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is RecentReport => Boolean(item && typeof item.to === 'string' && typeof item.title === 'string'))
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
};

export const rememberReport = (report: { to: string; title: string }) => {
  try {
    const existing = readRecentReports().filter((item) => item.to !== report.to);
    const next = [{ ...report, at: Date.now() }, ...existing].slice(0, MAX_RECENTS);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A browser with storage disabled simply gets no recents.
  }
};

export const formatRecentAge = (at: number): string => {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};
