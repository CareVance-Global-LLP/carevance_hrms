/** A full working day, in seconds. Cells are shaded against this. */
export const FULL_DAY_SECONDS = 8 * 3600;

export interface WeekDay {
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  label: string;
  dayNumber: string;
  isWeekend: boolean;
  isToday: boolean;
  isFuture: boolean;
}

const toIsoDate = (date: Date) => {
  // Local date parts, not toISOString() — that shifts to UTC and can hand back
  // the previous day for anyone east of Greenwich.
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/** Monday-based start of the week containing `date`. */
export const startOfWeek = (date: Date) => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  const weekday = result.getDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  result.setDate(result.getDate() + offset);
  return result;
};

export const addDays = (date: Date, days: number) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

export const buildWeek = (weekStart: Date): WeekDay[] => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    return {
      date: toIsoDate(date),
      label: date.toLocaleDateString(undefined, { weekday: 'short' }),
      dayNumber: String(date.getDate()),
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
      isToday: date.getTime() === today.getTime(),
      isFuture: date.getTime() > today.getTime(),
    };
  });
};

export const formatWeekRange = (weekStart: Date) => {
  const weekEnd = addDays(weekStart, 6);
  const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
  const startLabel = weekStart.toLocaleDateString(undefined, { day: 'numeric', month: sameMonth ? undefined : 'short' });
  const endLabel = weekEnd.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${startLabel} – ${endLabel}`;
};

/** `7h 30m`, or an em dash for nothing. */
export const formatCell = (seconds: number) => {
  if (!seconds || seconds <= 0) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours && minutes) return `${hours}:${String(minutes).padStart(2, '0')}`;
  if (hours) return `${hours}:00`;
  return `0:${String(minutes).padStart(2, '0')}`;
};

/** `40:20` — for grid cells and column totals, where digits line up. */
export const formatTotal = (seconds: number) => {
  const hours = Math.floor(Math.max(0, seconds) / 3600);
  const minutes = Math.round((Math.max(0, seconds) % 3600) / 60);
  return `${hours}:${String(minutes).padStart(2, '0')}`;
};

/** `29h 25m` — for prose and metric tiles, where `29:25h` reads as a typo. */
export const formatDuration = (seconds: number) => {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.round((safe % 3600) / 60);
  if (!hours && !minutes) return '0h';
  if (!hours) return `${minutes}m`;
  if (!minutes) return `${hours}h`;
  return `${hours}h ${minutes}m`;
};

export type CellState = 'full' | 'over' | 'short' | 'missing' | 'weekend-worked' | 'future';

/**
 * A totals table cannot show absence — it just shows a smaller number. The grid
 * can, which is the whole reason to build one: a missing weekday is hatched and
 * unmissable, and a weekend that was worked stands out rather than blending in.
 */
export const getCellState = (seconds: number, day: WeekDay): CellState => {
  if (seconds > 0) {
    if (day.isWeekend) return 'weekend-worked';
    if (seconds > FULL_DAY_SECONDS * 1.05) return 'over';
    if (seconds >= FULL_DAY_SECONDS * 0.9) return 'full';
    return 'short';
  }
  if (day.isWeekend) return 'weekend-worked';
  if (day.isFuture) return 'future';
  return 'missing';
};

export interface UserDayRow {
  user_id: number;
  date: string;
  total_duration?: number;
  idle_duration?: number;
}

export interface WeekGridRow {
  userId: number;
  name: string;
  email?: string;
  department?: string;
  cells: Array<{ seconds: number; idleSeconds: number; state: CellState }>;
  total: number;
  expected: number;
  overtime: number;
  missingDays: number;
}

interface BuildRowsArgs {
  users: Array<{ id: number; name: string; email?: string }>;
  byUser: Array<any>;
  byUserDay: UserDayRow[];
  week: WeekDay[];
}

export const buildWeekGridRows = ({ users, byUser, byUserDay, week }: BuildRowsArgs): WeekGridRow[] => {
  const index = new Map<string, UserDayRow>();
  byUserDay.forEach((row) => index.set(`${row.user_id}|${row.date}`, row));

  const departmentByUser = new Map<number, string>();
  byUser.forEach((row: any) => {
    const id = Number(row?.user?.id ?? row?.user_id);
    const department = row?.user?.department?.name ?? row?.user?.department ?? '';
    if (Number.isFinite(id) && department) departmentByUser.set(id, String(department));
  });

  return users
    .map((user) => {
      const cells = week.map((day) => {
        const row = index.get(`${user.id}|${day.date}`);
        const seconds = Number(row?.total_duration || 0);
        return {
          seconds,
          idleSeconds: Number(row?.idle_duration || 0),
          state: getCellState(seconds, day),
        };
      });

      const total = cells.reduce((sum, cell) => sum + cell.seconds, 0);
      // Only weekdays that have already happened are owed.
      const expectedDays = week.filter((day) => !day.isWeekend && !day.isFuture).length;
      const expected = expectedDays * FULL_DAY_SECONDS;
      const missingDays = week.filter(
        (day, position) => !day.isWeekend && !day.isFuture && cells[position].seconds <= 0
      ).length;

      // Overtime accrues per day, not as a weekly net. Netting it off meant
      // someone who worked 29 hours on Monday and nothing after showed zero
      // overtime — while the Monday cell was flagged +21:21, so the grid and
      // its own summary disagreed.
      const overtime = cells.reduce((sum, cell) => sum + Math.max(0, cell.seconds - FULL_DAY_SECONDS), 0);

      return {
        userId: user.id,
        name: user.name,
        email: user.email,
        department: departmentByUser.get(user.id),
        cells,
        total,
        expected,
        overtime,
        missingDays,
      };
    })
    // Whoever logged the most comes first. Sorting by name buried the people
    // with data under everyone who tracked nothing.
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
};
