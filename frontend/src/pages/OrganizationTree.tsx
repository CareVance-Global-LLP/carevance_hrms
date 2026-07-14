import { Fragment, useEffect, useMemo, useRef, useState, type WheelEvent as ReactWheelEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Crown,
  Network,
  Search,
  Shield,
  Users,
  X,
} from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { PageErrorState, PageLoadingState, PageEmptyState } from '@/components/ui/PageState';
import { useAuth } from '@/contexts/AuthContext';
import { userApi, roleApi } from '@/services/api';
import { getRoleColor } from '@/lib/roleColors';

/* ── Types ── */

type SimpleGroup = { id: number; name: string; slug?: string | null };

type OrgUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  role_id: number | null;
  role_name: string;
  role_color: string;
  hierarchy_level: number;
  reporting_manager_id: number | null;
  department: string;
  department_id: number | null;
  team: { id: number; name: string; is_manager: boolean } | null;
  created_at?: string;
  groups?: SimpleGroup[];
};

type ConnectorSeg = { path: string; team: boolean };

/* ── Helpers ── */

const initials = (name: string) => {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length <= 1) return (parts[0] || '').slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const matchUser = (u: OrgUser, q: string) =>
  !q ||
  u.name.toLowerCase().includes(q) ||
  (u.email && u.email.toLowerCase().includes(q)) ||
  u.department?.toLowerCase().includes(q) ||
  (u.groups?.some((g) => g.name.toLowerCase().includes(q)) ?? false);

const deptLabel = (d: string) => d || 'Unassigned';

/* ── Tree Node Card ── */

function TreeNodeCard({
  user, count, isCollapsed, onToggle, groupNames, matched, simple, emphasize, onMouseEnter, onMouseLeave, onClick,
}: {
  user: OrgUser;
  count?: number; isCollapsed?: boolean; onToggle?: () => void;
  groupNames?: string[]; matched?: boolean;
  simple?: boolean; emphasize?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onClick?: () => void;
}) {
  const t = getRoleColor(user.role_color, user.hierarchy_level);
  const dept = deptLabel(user.department);
  return (
    <div
      data-node-id={user.id}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      className={`w-[200px] cursor-pointer rounded-xl border-2 p-3 shadow-sm transition-all hover:shadow-md ${t.border} ${t.bg} ${
        matched === false ? 'opacity-40' : ''
      } ${matched ? 'ring-2 ring-sky-400' : ''} ${
        emphasize ? 'border-indigo-400 ring-2 ring-indigo-300 shadow-md' : ''
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${t.avatar}`}>
          {initials(user.name)}
        </div>
        <div className="min-w-0 flex-1">
          {/* Primary: name */}
          <p className="break-words text-sm font-bold leading-tight text-slate-900">{user.name}</p>

          {/* Role: colored pill/badge (scannable tier) */}
          <span
            className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${t.avatar}`}
          >
            {user.role_name}
          </span>

          {/* Department: plain secondary text */}
          {dept !== 'Unassigned' && (
            <p className="mt-1 break-words text-[11px] font-medium text-slate-500">{dept}</p>
          )}
          {dept === 'Unassigned' && (
            <p className="mt-1 text-[11px] font-medium text-slate-400 italic">No department</p>
          )}

          {/* Team: distinct chip with icon (sub-group tag, not a department line). Hidden in Simple view. */}
          {user.team && !simple && (
            <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
              <Users className="h-3 w-3 shrink-0" />
              {user.team.name}
              {user.team.is_manager ? ' • Lead' : ''}
            </span>
          )}

          {/* Direct-report count: least prominent, bottom of card */}
          {typeof count === 'number' && (
            <p className="mt-1.5 text-[10px] font-medium text-slate-400">
              {count > 0 ? `${count} direct report${count === 1 ? '' : 's'}` : 'No reports'}
            </p>
          )}

          {groupNames && groupNames.filter((g) => g !== dept).length > 0 && (
            <p className="mt-0.5 break-words text-[10px] font-medium text-indigo-600">
              {groupNames.filter((g) => g !== dept).join(', ')}
            </p>
          )}
        </div>
        {onToggle && (
          <button onClick={onToggle} className="mt-0.5 shrink-0 rounded p-0.5 text-slate-400 transition hover:bg-white/60 hover:text-slate-600">
            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Recursive Subordinate Tree ── */

function SubordinateTree({
  parentId,
  depth,
  childrenMap,
  collapsed,
  onToggle,
  q,
  simple,
  onHoverUser,
  onPinUser,
}: {
  parentId: number;
  depth: number;
  childrenMap: Map<number, OrgUser[]>;
  collapsed: Set<number>;
  onToggle: (id: number) => void;
  q: string;
  simple?: boolean;
  onHoverUser?: (id: number) => void;
  onPinUser?: (id: number) => void;
}) {
  const children = childrenMap.get(parentId) ?? [];
  if (children.length === 0) return null;

  const visibleChildren = q
    ? children.filter((c) => {
        const selfMatch = matchUser(c, q);
        const hasVisibleDescendant = (pid: number): boolean => {
          const subs = childrenMap.get(pid) ?? [];
          return subs.some((s) => matchUser(s, q) || hasVisibleDescendant(s.id));
        };
        return selfMatch || hasVisibleDescendant(c.id);
      })
    : children;

  if (visibleChildren.length === 0) return null;

  // Order by hierarchy level (team managers above members naturally).
  const sorted = [...visibleChildren].sort((a, b) => a.hierarchy_level - b.hierarchy_level);

  // Group siblings that share a team.id into a visible team band.
  // Teams with a single member (or no team) are rendered as individual cards.
  type Row =
    | { kind: 'user'; user: OrgUser }
    | { kind: 'band'; team: { id: number; name: string }; users: OrgUser[] };

  const rows: Row[] = [];
  if (simple) {
    // Simple view: every person is an individual card (no team band boxes).
    sorted.forEach((u) => rows.push({ kind: 'user', user: u }));
  } else {
    // Detailed view: group siblings sharing a team.id into a visible band box.
    const teamGroups = new Map<number, OrgUser[]>();
    const loose: OrgUser[] = [];
    for (const u of sorted) {
      if (u.team) {
        const arr = teamGroups.get(u.team.id) ?? [];
        arr.push(u);
        teamGroups.set(u.team.id, arr);
      } else {
        loose.push(u);
      }
    }

    for (const [teamId, users] of teamGroups) {
      if (users.length >= 2) {
        rows.push({ kind: 'band', team: { id: teamId, name: users[0].team!.name }, users });
      } else {
        users.forEach((u) => rows.push({ kind: 'user', user: u }));
      }
    }
    loose.forEach((u) => rows.push({ kind: 'user', user: u }));
  }

  rows.sort((a, b) => {
    const la = a.kind === 'band' ? Math.min(...a.users.map((u) => u.hierarchy_level)) : a.user.hierarchy_level;
    const lb = b.kind === 'band' ? Math.min(...b.users.map((u) => u.hierarchy_level)) : b.user.hierarchy_level;
    return la - lb;
  });

  const cardHandlers = (id: number) => ({
    onMouseEnter: onHoverUser ? () => onHoverUser(id) : undefined,
    onMouseLeave: onHoverUser ? () => onHoverUser(-1) : undefined,
    onClick: onPinUser ? () => onPinUser(id) : undefined,
  });

  return (
    <div className="flex flex-wrap justify-center gap-4 rounded-xl border border-slate-100 bg-slate-50/50 p-4">
      {rows.map((row) =>
        row.kind === 'band' ? (
          <div
            key={`band-${row.team.id}`}
            className="flex flex-col items-center rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 p-3"
          >
            {/* Team name as a header strip INSIDE the box */}
            <div className="mb-2 flex items-center gap-1.5 rounded-md bg-indigo-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-indigo-700">
              <Users className="h-3.5 w-3.5" />
              {row.team.name}
            </div>
            <div className="flex flex-wrap justify-center gap-4">
              {row.users.map((child) => (
                <div key={child.id} className="flex flex-col items-center gap-8">
                  <TreeNodeCard
                    user={child}
                    simple={simple}
                    count={childrenMap.get(child.id)?.length ?? 0}
                    isCollapsed={collapsed.has(child.id)}
                    onToggle={childrenMap.get(child.id)?.length ? () => onToggle(child.id) : undefined}
                    matched={q ? matchUser(child, q) : undefined}
                    {...cardHandlers(child.id)}
                  />
                  {!collapsed.has(child.id) && (
                    <SubordinateTree
                      parentId={child.id}
                      depth={depth + 1}
                      childrenMap={childrenMap}
                      collapsed={collapsed}
                      onToggle={onToggle}
                      q={q}
                      simple={simple}
                      onHoverUser={onHoverUser}
                      onPinUser={onPinUser}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div key={row.user.id} className="flex flex-col items-center gap-8">
            <TreeNodeCard
              user={row.user}
              simple={simple}
              count={childrenMap.get(row.user.id)?.length ?? 0}
              isCollapsed={collapsed.has(row.user.id)}
              onToggle={childrenMap.get(row.user.id)?.length ? () => onToggle(row.user.id) : undefined}
              matched={q ? matchUser(row.user, q) : undefined}
              {...cardHandlers(row.user.id)}
            />
            {!collapsed.has(row.user.id) && (
              <SubordinateTree
                parentId={row.user.id}
                depth={depth + 1}
                childrenMap={childrenMap}
                collapsed={collapsed}
                onToggle={onToggle}
                q={q}
                simple={simple}
                onHoverUser={onHoverUser}
                onPinUser={onPinUser}
              />
            )}
          </div>
        ),
      )}
    </div>
  );
}

/* ── By Dept tree: Department / Team / User are explicit tree nodes ──
   These reuse the SAME data-node-id + SVG connector mechanism as the
   Simple/Detailed reporting tree — they are intermediate nodes hanging
   off the Admin root, not floating section headers. */

type NodeId = number | string;

type OrgNode =
  | { kind: 'user'; id: number; user: OrgUser }
  | { kind: 'dept'; id: string; name: string; headcount: number }
  | { kind: 'team'; id: string; name: string; headcount: number; deptId: number };

const nodeLevel = (n: OrgNode): number => {
  if (n.kind === 'user') return n.user.hierarchy_level;
  if (n.kind === 'dept') return -2;
  return -1;
};

function DeptNodeCard({ node }: { node: OrgNode & { kind: 'dept' } }) {
  return (
    <div
      data-node-id={node.id}
      className="flex w-[210px] items-center gap-3 rounded-xl border-2 border-slate-300 bg-white p-3 shadow-sm"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
        <Building2 className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Department</p>
        <p className="truncate text-base font-semibold text-slate-900">{node.name}</p>
      </div>
      <span className="ml-auto shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
        {node.headcount}
      </span>
    </div>
  );
}

function TeamNodeCard({ node }: { node: OrgNode & { kind: 'team' } }) {
  return (
    <div
      data-node-id={node.id}
      className="flex w-[200px] items-center gap-3 rounded-xl border-2 border-indigo-300 bg-indigo-50/60 p-3 shadow-sm"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white">
        <Users className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-500">Team</p>
        <p className="truncate text-sm font-semibold text-slate-900">{node.name}</p>
      </div>
      <span className="ml-auto shrink-0 rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-semibold text-indigo-700">
        {node.headcount}
      </span>
    </div>
  );
}

/* Recursive renderer for the By Dept tree. Renders Dept / Team / User nodes
   and recurses via the same childrenMap shape the reporting tree uses. */
function DeptSubTree({
  parentId,
  childrenMap,
  collapsed,
  onToggle,
  q,
  onHoverUser,
  onPinUser,
}: {
  parentId: NodeId;
  childrenMap: Map<NodeId, OrgNode[]>;
  collapsed: Set<number>;
  onToggle: (id: number) => void;
  q: string;
  onHoverUser?: (id: number) => void;
  onPinUser?: (id: number) => void;
}) {
  const children = childrenMap.get(parentId) ?? [];
  if (children.length === 0) return null;

  const nodeMatches = (n: OrgNode) => (n.kind === 'user' ? matchUser(n.user, q) : true);
  const hasVisibleDescendant = (id: NodeId): boolean => {
    const kids = childrenMap.get(id) ?? [];
    return kids.some((k) => nodeMatches(k) || hasVisibleDescendant(k.id));
  };

  const visibleChildren = q
    ? children.filter((c) => nodeMatches(c) || hasVisibleDescendant(c.id))
    : children;
  if (visibleChildren.length === 0) return null;

  const sorted = [...visibleChildren].sort((a, b) => nodeLevel(a) - nodeLevel(b));

  const cardHandlers = (id: number) => ({
    onMouseEnter: onHoverUser ? () => onHoverUser(id) : undefined,
    onMouseLeave: onHoverUser ? () => onHoverUser(-1) : undefined,
    onClick: onPinUser ? () => onPinUser(id) : undefined,
  });

  return (
    <div className="flex flex-wrap justify-center gap-8">
      {sorted.map((node) => {
        const childNodes = childrenMap.get(node.id) ?? [];
        const hasChildren = childNodes.length > 0;
        return (
          <div key={String(node.id)} className="flex flex-col items-center gap-8">
            {node.kind === 'user' ? (
              <TreeNodeCard
                user={node.user}
                emphasize={node.user.team?.is_manager}
                count={childNodes.length}
                isCollapsed={collapsed.has(node.user.id)}
                onToggle={hasChildren ? () => onToggle(node.user.id) : undefined}
                matched={q ? matchUser(node.user, q) : undefined}
                {...cardHandlers(node.user.id)}
              />
            ) : node.kind === 'dept' ? (
              <DeptNodeCard node={node} />
            ) : (
              <TeamNodeCard node={node} />
            )}

            {hasChildren && (
              <DeptSubTree
                parentId={node.id}
                childrenMap={childrenMap}
                collapsed={collapsed}
                onToggle={onToggle}
                q={q}
                onHoverUser={onHoverUser}
                onPinUser={onPinUser}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Main ── */

export default function OrganizationTree() {
  const { isLoading: isAuthLoading, isAuthenticated } = useAuth();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [connectors, setConnectors] = useState<ConnectorSeg[]>([]);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  /* ── Simple / Detailed / Departments view ── */
  const [view, setView] = useState<'simple' | 'detailed' | 'departments'>('simple');
  const simple = view === 'simple';

  /* ── Reporting breadcrumb (hover preview + click pin) ── */
  const [pinned, setPinned] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const handleHoverUser = (id: number) => setHovered(id === -1 ? null : id);
  const handlePinUser = (id: number) => setPinned(id);

  /* ── Zoom & pan ── */
  const [zoom, setZoom] = useState(1);
  const panning = useRef(false);
  const panLast = useRef({ x: 0, y: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });

  const clampZoom = (z: number) => Math.min(2, Math.max(0.4, z));

  const onViewportWheel = (e: ReactWheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom((z) => clampZoom(z * (e.deltaY < 0 ? 1.1 : 0.9)));
  };

  const onViewportMouseDown = (e: ReactMouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    panning.current = true;
    panLast.current = { x: e.clientX, y: e.clientY };
  };

  const onViewportMouseMove = (e: ReactMouseEvent) => {
    if (!panning.current || !scrollRef.current) return;
    const dx = e.clientX - panLast.current.x;
    const dy = e.clientY - panLast.current.y;
    panLast.current = { x: e.clientX, y: e.clientY };
    scrollRef.current.scrollLeft -= dx;
    scrollRef.current.scrollTop -= dy;
  };

  const endPan = () => {
    panning.current = false;
  };

  // Keep the scrollable stage size in sync with content so large/zoomed trees stay scrollable.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStageSize({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── Queries ── */
  const { data: raw = [], isLoading, isError, refetch } = useQuery<OrgUser[]>({
    queryKey: ['organization-tree', isAuthenticated],
    queryFn: async () => {
      console.log('[OrganizationTree] Fetching users...');
      const res: any = await userApi.getAll({ simple: 1, is_active: true });
      const list: any[] = res?.data ?? (Array.isArray(res) ? res : []);
      console.log(`[OrganizationTree] Received ${list.length} users`);
      
      const mapped = list.map((u: any) => ({
        id: u.id,
        name: u.name,
        email: u.email ?? '',
        role: u.role ?? 'employee',
        role_id: u.role_id ?? null,
        role_name: u.role_name ?? '',
        role_color: u.role_color ?? 'slate',
        hierarchy_level: u.hierarchy_level ?? 100,
        reporting_manager_id: u.reporting_manager_id ?? null,
        department: (u.department ?? '').trim(),
        department_id: typeof u.department_id === 'number' ? u.department_id : null,
        team: u.team && typeof u.team.id === 'number'
          ? { id: u.team.id, name: u.team.name, is_manager: !!u.team.is_manager }
          : null,
        created_at: u.created_at ?? undefined,
        groups: Array.isArray(u.groups) ? u.groups.map((g: any) => ({ id: g.id, name: g.name, slug: g.slug })) : [],
      })) as OrgUser[];
      
      // Debug: Log users by department
      const byDept: Record<string, number> = {};
      mapped.forEach(u => {
        const dept = u.department || 'Unassigned';
        byDept[dept] = (byDept[dept] || 0) + 1;
      });
      console.log('[OrganizationTree] Users by department:', byDept);
      
      return mapped;
    },
    enabled: isAuthenticated && !isAuthLoading,
    staleTime: 0, // Always fetch fresh data
    gcTime: 5 * 60 * 1000, // Cache for 5 minutes only (gcTime = garbage collection time)
    refetchOnWindowFocus: true, // Refetch when user returns to tab
    refetchOnMount: 'always', // Always refetch on mount
  });

  /* ── Reporting breadcrumb lookups ── */
  const byId = useMemo(() => new Map<number, OrgUser>(raw.map((u) => [u.id, u])), [raw]);

  // Walk upward via reporting_manager_id to build the approval line.
  const reportingChain = (startId: number | null): OrgUser[] | null => {
    if (startId == null) return null;
    const chain: OrgUser[] = [];
    const seen = new Set<number>();
    let cur: OrgUser | undefined = byId.get(startId);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.push(cur);
      const mgrId = cur.reporting_manager_id;
      cur = mgrId != null ? byId.get(mgrId) : undefined;
    }
    return chain.length ? chain : null;
  };
  const activeChain = reportingChain(pinned ?? hovered);

  // Force refetch on initial load to ensure fresh data
  useEffect(() => {
    if (isAuthenticated && !isAuthLoading) {
      refetch();
    }
  }, [isAuthenticated, isAuthLoading, refetch]);

  const { data: rolesData = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: async () => {
      const res = await roleApi.list();
      return res.data.data;
    },
    enabled: isAuthenticated && !isAuthLoading,
  });

  /* ── Separate unassigned (non-Admin, department-less) users ── */
  const { treeUsers, unassignedUsers } = useMemo(() => {
    const inTree: OrgUser[] = [];
    const unassigned: OrgUser[] = [];
    for (const u of raw) {
      // Admins always belong in the tree (even with no department).
      // Non-admins with no department are shown in the "No Department Assigned" box.
      if (u.department_id === null && u.role !== 'admin') {
        unassigned.push(u);
      } else {
        inTree.push(u);
      }
    }
    return { treeUsers: inTree, unassignedUsers: unassigned };
  }, [raw]);

  /* ── Build tree (Admin is always the single root) ── */
  const tree = useMemo(() => {
    // Deduplicate users by ID
    const uniqueUsers = new Map<number, OrgUser>();
    for (const u of treeUsers) {
      if (!uniqueUsers.has(u.id)) {
        uniqueUsers.set(u.id, u);
      }
    }
    const dedupedUsers = Array.from(uniqueUsers.values());

    // Step 1: Find admin by role — NEVER by hierarchy_level. If multiple admins
    // exist, the earliest created_at is the single root; the rest become its
    // direct children (rendered as Admin peers, not Managers).
    const admins = dedupedUsers.filter((u) => u.role === 'admin');
    const admin = admins.length
      ? [...admins].sort((a, b) => {
          const ca = a.created_at ? new Date(a.created_at).getTime() : 0;
          const cb = b.created_at ? new Date(b.created_at).getTime() : 0;
          return ca - cb;
        })[0]
      : null;

    if (!admin) {
      return {
        admin: null as OrgUser | null,
        childrenMap: new Map<number, OrgUser[]>(),
        allIds: [] as number[],
        managers: [] as OrgUser[],
      };
    }

    const childrenMap = new Map<number, OrgUser[]>();
    const userById = new Map<number, OrgUser>(dedupedUsers.map((u) => [u.id, u]));
    const placedUserIds = new Set<number>();

    // Place admin at root
    placedUserIds.add(admin.id);

    // Step 2: Identify managers and custom roles (hierarchy < 100 but not admin)
    // These can have employees under them
    const managers = dedupedUsers.filter((u) =>
      u.id !== admin.id &&
      u.hierarchy_level < 100 &&
      u.department_id !== null,
    ).sort((a, b) => a.hierarchy_level - b.hierarchy_level);

    // Step 3: Place users by explicit reporting_manager_id FIRST (highest priority)
    for (const u of dedupedUsers) {
      if (u.id === admin.id) continue;
      if (placedUserIds.has(u.id)) continue;

      if (u.reporting_manager_id && userById.has(u.reporting_manager_id)) {
        const manager = userById.get(u.reporting_manager_id)!;
        // Can report to anyone higher in hierarchy
        if (manager.hierarchy_level < u.hierarchy_level) {
          // Before placing under reporting_manager_id, check if there is a
          // CLOSER superior (higher level) in the same department. If so, skip
          // placement here and let Step 4 place the user under the closest one.
          const userDept = u.department_id;
          const closerSuperiors = dedupedUsers.filter((other) =>
            other.id !== manager.id &&
            other.department_id === userDept &&
            other.hierarchy_level < u.hierarchy_level &&
            other.hierarchy_level > manager.hierarchy_level,
          );

          if (closerSuperiors.length > 0) {
            continue; // Skip — let Step 4 place under closest superior
          }

          if (!childrenMap.has(manager.id)) childrenMap.set(manager.id, []);
          childrenMap.get(manager.id)!.push(u);
          placedUserIds.add(u.id);
        }
      }
    }

    // Step 3.5: Auto-place managers/custom roles under the highest-ranked
    // person (lowest level number) in their same department.
    for (const u of dedupedUsers) {
      if (u.id === admin.id) continue;
      if (placedUserIds.has(u.id)) continue;
      if (u.hierarchy_level >= 100) continue; // employees handled in Step 4

      const userDept = u.department_id;

      const sameDeptSuperiors = dedupedUsers.filter(
        (other) =>
          other.id !== u.id &&
          other.department_id === userDept &&
          other.hierarchy_level < u.hierarchy_level,
      );

      if (sameDeptSuperiors.length > 0) {
        const superior = sameDeptSuperiors.sort(
          (a, b) => a.hierarchy_level - b.hierarchy_level,
        )[0];
        if (!childrenMap.has(superior.id)) childrenMap.set(superior.id, []);
        childrenMap.get(superior.id)!.push(u);
        placedUserIds.add(u.id);
      } else {
        if (!childrenMap.has(admin.id)) childrenMap.set(admin.id, []);
        childrenMap.get(admin.id)!.push(u);
        placedUserIds.add(u.id);
      }
    }

    // Step 4: Place employees under their CLOSEST superior in the same department
    for (const u of dedupedUsers) {
      if (u.id === admin.id) continue;
      if (placedUserIds.has(u.id)) continue;

      if (u.hierarchy_level >= 100) {
        const userDept = u.department_id;

        // All same-department people ranked higher (lower level number)
        const deptSuperiors = dedupedUsers.filter(
          (other) =>
            other.id !== u.id &&
            other.department_id === userDept &&
            other.hierarchy_level < u.hierarchy_level,
        );

        if (import.meta.env.DEV) {
          console.log(
            `[Tree] ${u.name} (L${u.hierarchy_level}) dept="${userDept}" superiors=`,
            deptSuperiors.map((s) => `${s.name}(L${s.hierarchy_level})`),
          );
        }

        if (deptSuperiors.length > 0) {
          // Closest superior = highest level number that is still lower than the employee's
          const closestSuperior = deptSuperiors.sort(
            (a, b) => b.hierarchy_level - a.hierarchy_level,
          )[0];
          if (!childrenMap.has(closestSuperior.id)) childrenMap.set(closestSuperior.id, []);
          childrenMap.get(closestSuperior.id)!.push(u);
          placedUserIds.add(u.id);
        } else {
          // No superior in same dept, attach directly to admin
          if (!childrenMap.has(admin.id)) childrenMap.set(admin.id, []);
          childrenMap.get(admin.id)!.push(u);
          placedUserIds.add(u.id);
        }
      } else {
        // Any remaining non-employees (safety net) go under admin
        if (!childrenMap.has(admin.id)) childrenMap.set(admin.id, []);
        childrenMap.get(admin.id)!.push(u);
        placedUserIds.add(u.id);
      }
    }

    return {
      admin,
      childrenMap,
      allIds: Array.from(uniqueUsers.keys()),
      managers,
    };
  }, [treeUsers]); // Removed currentUser - prevents refresh race condition

  /* ── By Dept tree: Department & Team as explicit intermediate nodes ──
     Re-roots the same people under Admin → Department → Team → Members.
     Uses the identical childrenMap shape + data-node-id connectors as the
     reporting tree; only the grouping/nesting order differs. */
  const { deptChildrenMap, deptNodeById } = useMemo(() => {
    const childrenMap = new Map<NodeId, OrgNode[]>();
    const nodeById = new Map<NodeId, OrgNode>();
    for (const u of raw) nodeById.set(u.id, { kind: 'user', id: u.id, user: u });

    const adminId = tree.admin?.id ?? -1;
    const pushChild = (parentId: NodeId, child: OrgNode) => {
      const arr = childrenMap.get(parentId) ?? [];
      arr.push(child);
      childrenMap.set(parentId, arr);
    };

    // Bucket users by department (skip department-less; handled elsewhere).
    const byDept = new Map<number, OrgUser[]>();
    for (const u of raw) {
      if (u.department_id == null) continue;
      const arr = byDept.get(u.department_id) ?? [];
      arr.push(u);
      byDept.set(u.department_id, arr);
    }

    const deptEntries = Array.from(byDept.entries()).sort((a, b) =>
      deptLabel(a[1][0].department).localeCompare(deptLabel(b[1][0].department)),
    );

    const adminChildren: OrgNode[] = [];

    for (const [deptId, users] of deptEntries) {
      const deptName = deptLabel(users[0].department);
      const deptNode: OrgNode = { kind: 'dept', id: `dept:${deptId}`, name: deptName, headcount: users.length };
      nodeById.set(deptNode.id, deptNode);

      const deptChildren: OrgNode[] = [];

      // Group members into teams.
      const teamMap = new Map<number, OrgUser[]>();
      const direct: OrgUser[] = [];
      for (const u of users) {
        if (u.team && u.team.id != null) {
          const arr = teamMap.get(u.team.id) ?? [];
          arr.push(u);
          teamMap.set(u.team.id, arr);
        } else {
          direct.push(u);
        }
      }

      const teamsEntries = Array.from(teamMap.entries()).sort((a, b) =>
        a[1][0].team!.name.localeCompare(b[1][0].team!.name),
      );

      for (const [teamId, teamUsers] of teamsEntries) {
        const teamName = teamUsers[0].team!.name;
        const teamNode: OrgNode = { kind: 'team', id: `team:${teamId}`, name: teamName, headcount: teamUsers.length, deptId };
        nodeById.set(teamNode.id, teamNode);

        const managers = teamUsers.filter((u) => u.team?.is_manager);
        const members = teamUsers.filter((u) => !u.team?.is_manager);
        const placed = new Set<number>();

        // One or more managers sit directly under the team node...
        for (const m of managers) {
          pushChild(teamNode.id, { kind: 'user', id: m.id, user: m });
          childrenMap.set(m.id, childrenMap.get(m.id) ?? []);
        }
        // ...and members hang under their (same-team) manager, else under the team.
        for (const mem of members) {
          const mgr = mem.reporting_manager_id != null ? managers.find((m) => m.id === mem.reporting_manager_id) : undefined;
          const target = mgr ?? managers[0];
          if (target) {
            pushChild(target.id, { kind: 'user', id: mem.id, user: mem });
            placed.add(mem.id);
          }
        }
        for (const mem of members) {
          if (!placed.has(mem.id)) pushChild(teamNode.id, { kind: 'user', id: mem.id, user: mem });
        }

        deptChildren.push(teamNode);
      }

      // Department-less-within-dept: users with no team.
      for (const d of direct) deptChildren.push({ kind: 'user', id: d.id, user: d });

      childrenMap.set(deptNode.id, deptChildren);
      adminChildren.push(deptNode);
    }

    childrenMap.set(adminId, adminChildren);
    return { deptChildrenMap: childrenMap, deptNodeById: nodeById };
  }, [raw, tree.admin]);

  /* ── Auto-collapse large branches ── */
  useEffect(() => {
    if (tree.childrenMap.size > 0 && collapsed.size === 0) {
      const auto = new Set<number>();
      for (const [parentId, children] of tree.childrenMap) {
        if (children.length > 10) auto.add(parentId);
      }
      if (auto.size > 0) setCollapsed(auto);
    }
  }, [tree]);

  /* ── View-dependent tree maps (shared connector mechanism) ── */
  const reportNodeById = useMemo(
    () => new Map<NodeId, OrgNode>(raw.map((u) => [u.id, { kind: 'user', id: u.id, user: u }])),
    [raw],
  );
  const activeChildrenMap = view === 'departments' ? deptChildrenMap : tree.childrenMap;
  const activeNodeById = view === 'departments' ? deptNodeById : reportNodeById;

  /* ── Draw connectors ── */
  useEffect(() => {
    const draw = () => {
      const el = wrapperRef.current;
      if (!el) return;

      const wr = el.getBoundingClientRect();
      const segs: ConnectorSeg[] = [];

      const getNodePos = (id: NodeId) => {
        const node = el.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
        if (!node) return null;
        const r = node.getBoundingClientRect();
        return {
          cx: r.left - wr.left + r.width / 2,
          top: r.top - wr.top,
          bottom: r.top - wr.top + r.height,
        };
      };

      for (const [parentId, children] of activeChildrenMap) {
        const parentPos = getNodePos(parentId);
        if (!parentPos) continue;

        const parentNode = activeNodeById.get(parentId);
        const parentTeamId = parentNode && parentNode.kind === 'user' ? parentNode.user.team?.id ?? null : null;

        for (const child of children) {
          const childPos = getNodePos(child.id);
          if (!childPos) continue;

          const childNode = activeNodeById.get(child.id);
          // Department/Team nodes are GROUPING edges (dashed) — not strict
          // reporting lines. Within-team edges (parent is a team node) stay solid.
          const isGrouping =
            !!childNode &&
            (childNode.kind === 'dept' ||
              (childNode.kind === 'team' && parentNode?.kind !== 'team'));
          const isTeamEdge =
            view !== 'simple' &&
            childNode?.kind === 'user' &&
            !!childNode.user.team &&
            childNode.user.team.id !== parentTeamId &&
            parentNode?.kind !== 'team';

          const mY = (parentPos.bottom + childPos.top) / 2;
          segs.push({
            path: `M ${parentPos.cx} ${parentPos.bottom} L ${parentPos.cx} ${mY} L ${childPos.cx} ${mY} L ${childPos.cx} ${childPos.top}`,
            team: isTeamEdge || isGrouping,
          });
        }
      }

      setConnectors(segs);
    };

    const ro = new ResizeObserver(draw);
    const wrapper = wrapperRef.current;
    if (wrapper) ro.observe(wrapper);
    requestAnimationFrame(draw);
    return () => ro.disconnect();
  }, [activeChildrenMap, activeNodeById, collapsed, search, raw, zoom, view]);

  /* ── Toggle collapse ── */
  const toggle = (id: number) => {
    setCollapsed((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  /* ── Role cards ── */
  const roleCards = useMemo(() => {
    const activeRoles = rolesData.filter((r: any) => r.is_active);
    return activeRoles.map((role: any) => {
      const count = role.is_system
        ? raw.filter((u) => u.role_id === role.id || (!u.role_id && u.role === role.slug)).length
        : raw.filter((u) => u.role_id === role.id).length;
      const Icon =
        role.slug === 'admin' ? Crown :
        role.slug === 'employee' ? Users :
        role.slug === 'manager' ? Network :
        Shield;
      const colorTone = getRoleColor(role.color, role.hierarchy_level);
      return {
        key: `role-card-${role.id}`,
        label: role.name,
        value: count,
        hint: role.is_system ? `System role • Level ${role.hierarchy_level}` : `Custom role • Level ${role.hierarchy_level}`,
        icon: Icon,
        accent: colorTone.badge,
        dot: colorTone.avatar.split(' ')[0],
      };
    });
  }, [rolesData, raw]);

  /* ── Filtered state ── */
  const q = search.trim().toLowerCase();

  /* ── Loading / error states ── */
  if (isAuthLoading || isLoading) return <PageLoadingState label="Building organization tree…" />;
  if (!isAuthenticated) return <PageErrorState message="Please log in to view this page." />;
  if (isError) return <PageErrorState message="Unable to load organization data right now." />;
  
  // No admin record available → empty state (covers zero admins and zero data)
  if (!tree.admin) {
    return <PageEmptyState title="No organization data" description="No admin record is available." />;
  }

  return (
    <div className="min-h-screen bg-slate-50/60 pb-8">
      <PageHeader title="Organization" description="Company hierarchy — admins, departments, managers, and reporting structure." />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* ── Stats ── */}
        <div className={`mb-5 grid grid-cols-2 gap-3 ${roleCards.length > 4 ? 'sm:grid-cols-3 lg:grid-cols-5' : 'sm:grid-cols-2 lg:grid-cols-4'}`}>
          {roleCards.map((s) => (
            <SurfaceCard key={s.key} className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500">{s.label}</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-950">{s.value}</p>
                  <p className="mt-0.5 text-[10px] text-slate-400">{s.hint}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <s.icon className={`h-5 w-5 ${s.accent}`} />
                  <div className={`h-3 w-3 rounded-full ${s.dot}`} />
                </div>
              </div>
            </SurfaceCard>
          ))}
          {unassignedUsers.length > 0 && (
            <SurfaceCard className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500">No Department</p>
                  <p className="mt-1 text-2xl font-semibold text-amber-600">{unassignedUsers.length}</p>
                  <p className="mt-0.5 text-[10px] text-slate-400">Unassigned employees</p>
                </div>
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              </div>
            </SurfaceCard>
          )}
        </div>

        {/* ── Toolbar ── */}
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, department, group…"
              className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-9 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="flex items-center rounded-md border border-slate-200 bg-white p-0.5">
              {(['simple', 'detailed', 'departments'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setView(mode)}
                  className={`rounded px-3 py-1.5 text-xs font-semibold capitalize transition ${
                    view === mode ? 'bg-sky-500 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                  title={
                    mode === 'simple'
                      ? 'Flat reporting tree (no team boxes)'
                      : mode === 'detailed'
                        ? 'Team boxes + dashed team connectors'
                        : 'Group by department, then team-wise sections'
                  }
                >
                  {mode === 'departments' ? 'By Dept' : mode}
                </button>
              ))}
            </div>
            <div className="flex items-center rounded-md border border-slate-200 bg-white">
              <button
                onClick={() => setZoom((z) => clampZoom(z - 0.1))}
                className="px-2.5 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
                title="Zoom out"
              >
                &#8722;
              </button>
              <button
                onClick={() => setZoom(1)}
                className="border-x border-slate-200 px-2 py-2 text-[11px] font-semibold tabular-nums text-slate-600 transition hover:bg-slate-50"
                title="Reset zoom"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                onClick={() => setZoom((z) => clampZoom(z + 0.1))}
                className="px-2.5 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
                title="Zoom in"
              >
                +
              </button>
            </div>
            <button
              onClick={() => refetch()}
              disabled={isLoading}
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              title="Refresh organization data"
            >
              {isLoading ? 'Loading…' : 'Refresh'}
            </button>
            {view !== 'departments' && (
              <>
                <button
                  onClick={() => setCollapsed(new Set(Array.from(tree.childrenMap.keys())))}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  Collapse All
                </button>
                <button
                  onClick={() => setCollapsed(new Set())}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  Expand All
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── Legend ── */}
        <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Legend</span>
          {roleCards.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
              <span className={`h-3 w-3 rounded-full ${s.dot}`} />
              {s.label}
            </span>
          ))}
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-indigo-600">
            <span className="inline-block h-3 w-3 rounded-[3px] border-2 border-dashed border-indigo-300 bg-indigo-50" />
            Team group
          </span>
          <span className="ml-auto text-[10px] text-slate-400">
            Scroll + Ctrl/Cmd to zoom · drag to pan
          </span>
        </div>

        {/* ── Reporting breadcrumb ── */}
        {activeChain && activeChain.length > 0 ? (
          <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {pinned != null ? 'Pinned line' : 'Hover line'}
            </span>
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              {activeChain.map((u, i) => (
                <Fragment key={u.id}>
                  {i > 0 ? (
                    <span className="text-[11px] font-medium text-slate-400">→ reports to →</span>
                  ) : null}
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">
                    <span className="font-semibold text-slate-800">{u.name}</span>
                    <span className="rounded-full bg-slate-200 px-1.5 text-[10px] font-semibold text-slate-600">
                      {u.role_name || u.role}
                    </span>
                    {i === activeChain.length - 1 ? (
                      <span className="text-[10px] font-medium text-slate-400">Top</span>
                    ) : null}
                  </span>
                </Fragment>
              ))}
            </div>
            {pinned != null ? (
              <button
                type="button"
                onClick={() => setPinned(null)}
                className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Unpin reporting line"
              >
                Unpin ×
              </button>
            ) : null}
          </div>
        ) : null}

        {/* ── Tree viewport ── */}
        <div
          ref={scrollRef}
          className="relative cursor-grab overflow-auto rounded-xl border border-slate-200 bg-white active:cursor-grabbing"
          style={{ minHeight: '400px', maxHeight: '80vh' }}
          onWheel={onViewportWheel}
          onMouseDown={onViewportMouseDown}
          onMouseMove={onViewportMouseMove}
          onMouseUp={endPan}
          onMouseLeave={endPan}
        >
          <div
            ref={wrapperRef}
            className="relative"
            style={{
              width: stageSize.w * zoom || 'max-content',
              height: stageSize.h * zoom || 'max-content',
              transformOrigin: '0 0',
            }}
          >
            {/* SVG connectors (in wrapper space, matches connector coords) */}
            <svg className="pointer-events-none absolute inset-0 z-0" width="100%" height="100%">
              {connectors.map((c, i) =>
                c.path ? (
                  <path
                    key={`p${i}`}
                    d={c.path}
                    stroke={c.team ? '#cbd5e1' : '#94a3b8'}
                    strokeWidth={c.team ? 1.5 : 2}
                    strokeDasharray={c.team ? '5 4' : undefined}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : null,
              )}
            </svg>

            {/* Scaled stage */}
            <div
              ref={stageRef}
              className="relative inline-block min-w-full p-10"
              style={{ transform: `scale(${zoom})`, transformOrigin: '0 0' }}
            >
              {view === 'departments' ? (
                /* By Dept tree: Admin → Department → Team → Members (real nested tree) */
                <div className="relative z-10 flex flex-col items-center gap-8">
                  {/* Admin root */}
                  <div className="flex justify-center">
                    <div>
                      <TreeNodeCard
                        user={tree.admin}
                        matched={q ? matchUser(tree.admin, q) : undefined}
                        onMouseEnter={() => handleHoverUser(tree.admin.id)}
                        onMouseLeave={() => handleHoverUser(-1)}
                        onClick={() => handlePinUser(tree.admin.id)}
                      />
                    </div>
                  </div>

                  <DeptSubTree
                    parentId={tree.admin.id}
                    childrenMap={deptChildrenMap}
                    collapsed={collapsed}
                    onToggle={toggle}
                    q={q}
                    onHoverUser={handleHoverUser}
                    onPinUser={handlePinUser}
                  />
                </div>
              ) : (
                /* Tree content */
                <div className="relative z-10 flex flex-col items-center gap-8">
                  {/* Admin */}
                  <div className="flex justify-center">
                    <div>
                      <TreeNodeCard
                        user={tree.admin}
                        simple={simple}
                        matched={q ? matchUser(tree.admin, q) : undefined}
                        onMouseEnter={() => handleHoverUser(tree.admin.id)}
                        onMouseLeave={() => handleHoverUser(-1)}
                        onClick={() => handlePinUser(tree.admin.id)}
                      />
                    </div>
                  </div>

                  {/* Recursive subordinate tree */}
                  <SubordinateTree
                    parentId={tree.admin.id}
                    depth={1}
                    childrenMap={tree.childrenMap}
                    collapsed={collapsed}
                    onToggle={toggle}
                    q={q}
                    simple={simple}
                    onHoverUser={handleHoverUser}
                    onPinUser={handlePinUser}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Unassigned Department Employees ── */}
        {unassignedUsers.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <h2 className="text-sm font-semibold text-slate-700">
                No Department Assigned
              </h2>
              <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                {unassignedUsers.length}
              </span>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
              <div className="flex flex-wrap gap-3">
                {unassignedUsers
                  .filter((u) => (q ? matchUser(u, q) : true))
                  .map((u) => (
                    <div
                      key={u.id}
                      className="flex items-center gap-2.5 rounded-lg border border-amber-200 bg-white px-3 py-2 shadow-sm"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700">
                        {initials(u.name)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-800 truncate">{u.name}</p>
                        <p className="text-[10px] text-slate-400">{u.role_name || u.role}</p>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Routing note ── */}
        <div className="mt-8 rounded-lg border border-slate-200 bg-white p-4">
          <p className="flex items-center gap-2 text-xs font-medium text-slate-700">
            <Network className="h-3.5 w-3.5 text-slate-400" />
            How Routing Works
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Approval requests route to the employee&apos;s explicit{' '}
            <strong>reporting manager</strong> first. If none is set, the system falls back
            to the <strong>nearest higher-ranked colleague in the same department</strong>.
            New departments and employees appear here automatically.
          </p>
        </div>
      </div>
    </div>
  );
}
