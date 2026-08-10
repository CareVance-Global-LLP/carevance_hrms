import { useCallback, useMemo } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { departmentTeamApi, type DepartmentTeam } from '@/services/api';

/* ────────────────────────────────────────────────────────────────
   Types
   ──────────────────────────────────────────────────────────────── */

export interface DeptUser {
  id: number;
  name: string;
  email?: string | null;
  role?: string | null;
  level: number;
  displayRole?: string;
  groups?: Array<{ id: number; name?: string }>;
  employeeWorkInfo?: { reporting_manager_id?: number | null } | null;
}

/** One entry from `teamInsights` in EmployeeManagementWorkspace. */
export interface DeptInsight {
  id: number;
  name: string;
  description: string;
  users: DeptUser[];
  employeeCount: number;
  membersCount: number;
  leadName: string;
  leadLabel: string;
  leadEmail: string | null;
  managerName: string;
}

/** Where a person sits: a department, and optionally a team inside it. */
export interface Placement {
  deptId: number;
  teamId: number | null;
}

/** A person as rendered on the board — one card per (person, department). */
export interface PersonCard {
  user: DeptUser;
  deptId: number;
  teamId: number | null;
  isLead: boolean;
  isTeamManager: boolean;
}

export interface TeamGroup {
  teamId: number | null;
  name: string;
  cards: PersonCard[];
  managerCount: number;
  hasManager: boolean;
}

export interface BoardColumn {
  dept: DeptInsight;
  groups: TeamGroup[];
  total: number;
  hasLead: boolean;
}

/** A move waiting for the server to confirm, so the UI can update instantly. */
export interface PendingMove {
  userId: number;
  fromDeptId: number;
  to: Placement;
}

/* ────────────────────────────────────────────────────────────────
   Hierarchy rules — mirrored from the server ReportingManagerResolver
   ──────────────────────────────────────────────────────────────── */

export const ADMIN_LEVEL = 10;
export const EMPLOYEE_LEVEL = 100;

/**
 * Who the current user is allowed to move. Managers may move employees;
 * only admins may move other managers. Matches `canManageGroupMember` in
 * EmployeeManagementWorkspace so the board can never offer an action the
 * server will reject.
 */
export const canManagePerson = (user: DeptUser, currentUserLevel: number): boolean =>
  user.level >= EMPLOYEE_LEVEL || (user.level <= 50 && currentUserLevel <= ADMIN_LEVEL);

/* ────────────────────────────────────────────────────────────────
   Presentation helpers
   ──────────────────────────────────────────────────────────────── */

export const getInitials = (value: string): string => {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

/* ────────────────────────────────────────────────────────────────
   Role tiers — the visual split between admins, managers and employees
   ──────────────────────────────────────────────────────────────── */

export type RoleTier = 'admin' | 'manager' | 'employee';

/**
 * Derived from hierarchy level rather than the `role` string, so custom roles
 * land in the right tier automatically. Same thresholds the server uses.
 */
export const roleTier = (user: DeptUser): RoleTier => {
  if (user.level <= ADMIN_LEVEL) return 'admin';
  if (user.level < EMPLOYEE_LEVEL) return 'manager';
  return 'employee';
};

export const ROLE_TIER_LABEL: Record<RoleTier, string> = {
  admin: 'Admin',
  manager: 'Manager',
  employee: 'Employee',
};

/*
  Avatar colour carries the person's authority tier — it is the one thing you
  need to read at a glance across a whole column. The old implementation hashed
  the name into a 360° hue wheel, which was both off-brand and pure decoration:
  it encoded nothing. Depth of teal now maps to seniority, and gold stays
  reserved for "needs attention" so it can never be mistaken for a role.
*/
const TIER_AVATAR: Record<RoleTier, { backgroundColor: string; color: string }> = {
  admin: { backgroundColor: '#3D656B', color: '#F0F7F8' },
  manager: { backgroundColor: '#B3D7DB', color: '#233B40' },
  employee: { backgroundColor: '#E4E8EB', color: '#4E565D' },
};

export const roleAvatarStyle = (user: DeptUser): React.CSSProperties => TIER_AVATAR[roleTier(user)];

/** Tailwind classes for the small role chip shown beside a person's name. */
export const ROLE_TIER_CHIP: Record<RoleTier, string> = {
  admin: 'border-blue-700 bg-blue-700 text-white',
  manager: 'border-blue-200 bg-blue-50 text-blue-800',
  employee: 'border-slate-200 bg-white text-slate-500',
};

/** The person's own job title where one exists, otherwise their tier. */
export const roleLabel = (user: DeptUser): string =>
  (user.displayRole && user.displayRole.trim()) || ROLE_TIER_LABEL[roleTier(user)];

/** How many of each tier sit in a set of cards — used for column subtitles. */
export const tierBreakdown = (cards: PersonCard[]) => {
  const counts: Record<RoleTier, number> = { admin: 0, manager: 0, employee: 0 };
  cards.forEach((card) => {
    counts[roleTier(card.user)] += 1;
  });
  return counts;
};

/** "2 managers · 16 employees" — the leadership split, in words. */
export const describeBreakdown = (counts: Record<RoleTier, number>): string => {
  const parts: string[] = [];
  if (counts.admin > 0) parts.push(`${counts.admin} admin${counts.admin === 1 ? '' : 's'}`);
  if (counts.manager > 0) parts.push(`${counts.manager} manager${counts.manager === 1 ? '' : 's'}`);
  if (counts.employee > 0) parts.push(`${counts.employee} employee${counts.employee === 1 ? '' : 's'}`);
  return parts.join(' · ') || 'Nobody yet';
};

/** A stronger tint for department squares, keyed off the department name. */
export const departmentStyle = (name: string): React.CSSProperties => {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = name.charCodeAt(index) + ((hash << 5) - hash);
  }
  const tints = [
    { backgroundColor: '#D9EBED', color: '#3D656B' },
    { backgroundColor: '#B3D7DB', color: '#233B40' },
    { backgroundColor: '#E4E8EB', color: '#4E565D' },
  ];
  return tints[Math.abs(hash) % tints.length];
};

/* ────────────────────────────────────────────────────────────────
   Teams for every department at once
   ──────────────────────────────────────────────────────────────── */

export const teamsQueryKey = (departmentId: number) => ['department-teams', departmentId] as const;

/**
 * The board shows every department side by side, so it needs every
 * department's teams — but the API is per-department (`/departments/{id}/teams`,
 * there is no bulk route). `useQueries` fans out one request per department and
 * React Query caches and dedupes them, so switching views or re-rendering costs
 * nothing. With a large number of departments this is N requests on first paint;
 * a bulk endpoint would be the fix if that ever bites.
 */
export function useDepartmentTeams(departmentIds: number[]) {
  const queryClient = useQueryClient();

  const results = useQueries({
    queries: departmentIds.map((id) => ({
      queryKey: teamsQueryKey(id),
      queryFn: async (): Promise<DepartmentTeam[]> => {
        const response = await departmentTeamApi.list(id);
        return response.data.data ?? [];
      },
      staleTime: 30_000,
    })),
  });

  /*
    `results` is a fresh array on every render, so it cannot be a dependency
    directly. Spreading the per-query data into the dependency list would work
    until a department is added or removed — a dependency array that changes
    length between renders is undefined behaviour in React. Collapsing the
    freshness of every query into one fixed-length string keeps the memo honest
    and the array size constant.
  */
  const idsKey = departmentIds.join(',');
  const dataKey = results.map((result) => result.dataUpdatedAt ?? 0).join(',');

  const teamsByDept = useMemo(() => {
    const map = new Map<number, DepartmentTeam[]>();
    departmentIds.forEach((id, index) => {
      map.set(id, results[index]?.data ?? []);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, dataKey]);

  const isLoading = results.some((result) => result.isLoading);

  const refetchDepartments = useCallback(
    async (ids: number[]) => {
      await Promise.all(
        Array.from(new Set(ids)).map((id) =>
          queryClient.invalidateQueries({ queryKey: teamsQueryKey(id) })
        )
      );
    },
    [queryClient]
  );

  return { teamsByDept, isLoading, refetchDepartments };
}

/* ────────────────────────────────────────────────────────────────
   Board model
   ──────────────────────────────────────────────────────────────── */

const teamMemberIds = (team: DepartmentTeam): number[] =>
  team.member_ids ?? team.members?.map((member) => member.id) ?? [];

const teamManagerIds = (team: DepartmentTeam): number[] =>
  team.manager_ids ?? team.managers?.map((manager) => manager.id) ?? [];

/**
 * Turns departments + teams + any not-yet-confirmed drags into the columns the
 * board renders. Pending moves are applied on top so a dragged card lands in
 * its new column immediately rather than snapping back until the refetch
 * returns.
 */
export function buildColumns(
  departments: DeptInsight[],
  teamsByDept: Map<number, DepartmentTeam[]>,
  pending: PendingMove[],
  matches: (user: DeptUser, dept: DeptInsight) => boolean
): BoardColumn[] {
  const pendingByKey = new Map<string, PendingMove>();
  pending.forEach((move) => pendingByKey.set(`${move.userId}:${move.fromDeptId}`, move));

  // Natural placement first: which team (if any) holds each person.
  const naturalTeam = new Map<string, number | null>();
  const managerKeys = new Set<string>();
  departments.forEach((dept) => {
    (teamsByDept.get(dept.id) ?? []).forEach((team) => {
      teamMemberIds(team).forEach((userId) => naturalTeam.set(`${userId}:${dept.id}`, team.id));
      teamManagerIds(team).forEach((userId) => {
        naturalTeam.set(`${userId}:${dept.id}`, team.id);
        managerKeys.add(`${userId}:${dept.id}:${team.id}`);
      });
    });
  });

  // One card per (person, department), then relocate anything with a pending move.
  const cardsByDept = new Map<number, PersonCard[]>();
  departments.forEach((dept) => cardsByDept.set(dept.id, []));

  departments.forEach((dept) => {
    dept.users.forEach((user) => {
      if (!matches(user, dept)) return;

      const move = pendingByKey.get(`${user.id}:${dept.id}`);
      const deptId = move ? move.to.deptId : dept.id;
      const teamId = move ? move.to.teamId : naturalTeam.get(`${user.id}:${dept.id}`) ?? null;

      // A pending move can target a department that is filtered out of view —
      // the card is simply not rendered until the refetch confirms the move.
      if (!cardsByDept.has(deptId)) return;

      cardsByDept.get(deptId)!.push({
        user,
        deptId,
        teamId,
        isLead: dept.leadEmail != null && user.email === dept.leadEmail && !move,
        isTeamManager: teamId != null && managerKeys.has(`${user.id}:${deptId}:${teamId}`),
      });
    });
  });

  return departments.map((dept) => {
    const cards = cardsByDept.get(dept.id) ?? [];
    const teams = teamsByDept.get(dept.id) ?? [];

    const groups: TeamGroup[] = teams.map((team) => {
      const groupCards = cards.filter((card) => card.teamId === team.id);
      const managerCount = groupCards.filter((card) => card.isTeamManager).length;
      return {
        teamId: team.id,
        name: team.name,
        cards: sortCards(groupCards),
        managerCount,
        hasManager: managerCount > 0,
      };
    });

    const loose = cards.filter((card) => card.teamId === null);
    groups.push({
      teamId: null,
      name: 'Not in a team',
      cards: sortCards(loose),
      managerCount: 0,
      hasManager: true, // never flag the catch-all group as missing a manager
    });

    return {
      dept,
      groups,
      total: cards.length,
      hasLead: dept.leadName !== 'Not assigned',
    };
  });
}

/**
 * Authority first, then alphabetical: department lead, team managers, then
 * everyone else in hierarchy order. Without the level tiebreak a manager who
 * happens not to run a team would sort in among the employees, which is exactly
 * the distinction the board needs to make obvious.
 */
const sortCards = (cards: PersonCard[]): PersonCard[] =>
  [...cards].sort((a, b) => {
    const rank = (card: PersonCard) => (card.isLead ? 0 : card.isTeamManager ? 1 : 2);
    return (
      rank(a) - rank(b) ||
      a.user.level - b.user.level ||
      String(a.user.name).localeCompare(String(b.user.name))
    );
  });

/* ────────────────────────────────────────────────────────────────
   Search
   ──────────────────────────────────────────────────────────────── */

export const makeMatcher = (query: string) => {
  const needle = query.trim().toLowerCase();
  if (!needle) return () => true;
  return (user: DeptUser) =>
    [user.name, user.email, user.displayRole].filter(Boolean).join(' ').toLowerCase().includes(needle);
};

export const departmentMatches = (dept: DeptInsight, query: string): boolean => {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [dept.name, dept.description].filter(Boolean).join(' ').toLowerCase().includes(needle);
};

/* ────────────────────────────────────────────────────────────────
   Drag identifiers
   ──────────────────────────────────────────────────────────────── */

export const dropZoneId = (deptId: number, teamId: number | null) =>
  `drop:${deptId}:${teamId ?? 'none'}`;

export const cardId = (userId: number, deptId: number) => `card:${userId}:${deptId}`;

export const parseDropZoneId = (id: string): Placement | null => {
  const match = /^drop:(\d+):(\d+|none)$/.exec(id);
  if (!match) return null;
  return { deptId: Number(match[1]), teamId: match[2] === 'none' ? null : Number(match[2]) };
};
