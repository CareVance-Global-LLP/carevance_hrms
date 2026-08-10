export interface SelfieItem {
  id: number;
  user: { id: number; name: string } | null;
  image_url: string;
  latitude: number | null;
  longitude: number | null;
  accuracy_meters: number | null;
  attendance_date: string;
  created_at: string;
}

export interface RosterRow {
  kind: 'verified' | 'no-gps' | 'missing';
  userId: number;
  userName: string;
  selfie: SelfieItem | null;
}

export interface RosterDay {
  dateISO: string;
  rows: RosterRow[];
  verifiedCount: number;
  totalCount: number;
}

const hasGps = (selfie: SelfieItem) =>
  selfie.latitude !== null && selfie.longitude !== null
  && Number.isFinite(Number(selfie.latitude)) && Number.isFinite(Number(selfie.longitude));

/**
 * The verification roster: one row per person per day. On a single-day view
 * every known employee appears — with their selfie, with a no-GPS flag, or as
 * "no selfie yet" — because who is missing is the page's headline, not a gap.
 * On ranges, only days that actually have selfies are listed (absence across
 * a whole range is noise, not signal).
 */
export function buildSelfieRoster(
  selfies: SelfieItem[],
  employees: Array<{ id: number; name: string }>,
  options: { singleDay: boolean; dayISO?: string; selectedUserId?: number | '' }
): RosterDay[] {
  const { singleDay, dayISO, selectedUserId } = options;

  const scopedEmployees = selectedUserId
    ? employees.filter((employee) => Number(employee.id) === Number(selectedUserId))
    : employees;

  const byDate = new Map<string, SelfieItem[]>();
  selfies.forEach((selfie) => {
    const date = String(selfie.attendance_date || '').slice(0, 10);
    if (!date) return;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(selfie);
  });

  const rowFor = (selfie: SelfieItem): RosterRow => ({
    kind: hasGps(selfie) ? 'verified' : 'no-gps',
    userId: Number(selfie.user?.id || 0),
    userName: selfie.user?.name || 'Unknown',
    selfie,
  });

  if (singleDay) {
    const date = dayISO || Array.from(byDate.keys())[0] || '';
    const daySelfies = byDate.get(date) || [];
    const selfieByUser = new Map<number, SelfieItem>();
    daySelfies.forEach((selfie) => {
      const userId = Number(selfie.user?.id || 0);
      if (userId > 0 && !selfieByUser.has(userId)) selfieByUser.set(userId, selfie);
    });

    const present: RosterRow[] = [];
    const missing: RosterRow[] = [];
    scopedEmployees.forEach((employee) => {
      const selfie = selfieByUser.get(Number(employee.id));
      if (selfie) {
        present.push(rowFor(selfie));
      } else {
        missing.push({ kind: 'missing', userId: Number(employee.id), userName: employee.name, selfie: null });
      }
    });
    // Selfies from people outside the visible employee list still count.
    daySelfies.forEach((selfie) => {
      const userId = Number(selfie.user?.id || 0);
      if (!scopedEmployees.some((employee) => Number(employee.id) === userId)) {
        if (!selectedUserId) present.push(rowFor(selfie));
      }
    });

    const rows = [...present, ...missing];
    return [{
      dateISO: date,
      rows,
      verifiedCount: present.filter((row) => row.kind === 'verified').length,
      totalCount: rows.length,
    }];
  }

  return Array.from(byDate.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, daySelfies]) => {
      const rows = daySelfies
        .filter((selfie) => !selectedUserId || Number(selfie.user?.id) === Number(selectedUserId))
        .map(rowFor);
      return {
        dateISO: date,
        rows,
        verifiedCount: rows.filter((row) => row.kind === 'verified').length,
        totalCount: rows.length,
      };
    })
    .filter((day) => day.rows.length > 0);
}

/**
 * Group selfies that landed on (almost) the same spot so the map shows one
 * badged marker instead of a stack of identical pins. ~110 m grid.
 */
export function groupSelfiesByLocation(selfies: SelfieItem[]): Array<{
  key: string;
  latitude: number;
  longitude: number;
  items: SelfieItem[];
}> {
  const groups = new Map<string, { key: string; latitude: number; longitude: number; items: SelfieItem[] }>();

  selfies.forEach((selfie) => {
    if (!hasGps(selfie)) return;
    const latitude = Number(selfie.latitude);
    const longitude = Number(selfie.longitude);
    const key = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
    if (!groups.has(key)) {
      groups.set(key, { key, latitude, longitude, items: [] });
    }
    groups.get(key)!.items.push(selfie);
  });

  return Array.from(groups.values());
}
