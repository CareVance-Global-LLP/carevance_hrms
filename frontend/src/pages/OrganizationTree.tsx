import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
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

/* ── Types ── */

type SimpleGroup = { id: number; name: string; slug?: string | null };

type OrgUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  role_id: number | null;
  role_name: string;
  hierarchy_level: number;
  reporting_manager_id: number | null;
  department: string;
  groups?: SimpleGroup[];
};

type NodeTone = 'admin' | 'manager' | 'employee';

type ConnectorSeg = { path: string };

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

const getNodeTone = (u: OrgUser): NodeTone => {
  const level = u.hierarchy_level ?? (u.role === 'admin' ? 10 : u.role === 'manager' ? 50 : 100);
  if (level <= 10) return 'admin';
  if (level < 100) return 'manager';
  return 'employee';
};

/* ── Tone palette ── */

const TONES: Record<NodeTone, { border: string; bg: string; avatar: string; badge: string }> = {
  admin:    { border: 'border-rose-200', bg: 'bg-rose-50', avatar: 'bg-rose-100 text-rose-700', badge: 'bg-rose-100 text-rose-700' },
  manager:  { border: 'border-sky-200', bg: 'bg-sky-50', avatar: 'bg-sky-100 text-sky-700', badge: 'bg-sky-100 text-sky-700' },
  employee: { border: 'border-amber-200', bg: 'bg-amber-50', avatar: 'bg-amber-100 text-amber-700', badge: 'bg-amber-100 text-amber-700' },
};

/* ── Tree Node Card ── */

function TreeNodeCard({
  user, tone, count, isCollapsed, onToggle, groupNames, matched,
}: {
  user: OrgUser; tone: NodeTone;
  count?: number; isCollapsed?: boolean; onToggle?: () => void;
  groupNames?: string[]; matched?: boolean;
}) {
  const t = TONES[tone];
  const dept = deptLabel(user.department);
  return (
    <div
      data-node-id={user.id}
      className={`w-[200px] rounded-xl border-2 p-3 shadow-sm transition-all hover:shadow-md ${t.border} ${t.bg} ${
        matched === false ? 'opacity-40' : ''
      } ${matched ? 'ring-2 ring-sky-400' : ''}`}
    >
      <div className="flex items-start gap-2.5">
        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${t.avatar}`}>
          {initials(user.name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-bold leading-tight text-slate-900">{user.name}</p>
          <p className={`mt-0.5 text-[11px] font-semibold ${t.badge.split(' ')[1]}`}>
            {user.role_name}
          </p>
          {dept !== 'Unassigned' && (
            <p className="mt-0.5 break-words text-[11px] font-medium text-slate-500">{dept}</p>
          )}
          {dept === 'Unassigned' && (
            <p className="mt-0.5 text-[11px] font-medium text-slate-400 italic">No department</p>
          )}
          {typeof count === 'number' && (
            <p className="mt-1 text-[10px] font-medium text-slate-400">
              {count > 0 ? `${count} direct report${count === 1 ? '' : 's'}` : 'No direct reports yet'}
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
}: {
  parentId: number;
  depth: number;
  childrenMap: Map<number, OrgUser[]>;
  collapsed: Set<number>;
  onToggle: (id: number) => void;
  q: string;
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

  return (
    <div className="flex flex-wrap justify-center gap-5 mt-4">
      {visibleChildren.map((child) => (
        <div key={child.id} className="flex flex-col items-center gap-4">
          <TreeNodeCard
            user={child}
            tone={getNodeTone(child)}
            count={childrenMap.get(child.id)?.length ?? 0}
            isCollapsed={collapsed.has(child.id)}
            onToggle={childrenMap.get(child.id)?.length ? () => onToggle(child.id) : undefined}
            matched={q ? matchUser(child, q) : undefined}
          />
          {!collapsed.has(child.id) && (
            <SubordinateTree
              parentId={child.id}
              depth={depth + 1}
              childrenMap={childrenMap}
              collapsed={collapsed}
              onToggle={onToggle}
              q={q}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Main ── */

export default function OrganizationTree() {
  const { user: currentUser, isLoading: isAuthLoading, isAuthenticated } = useAuth();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [connectors, setConnectors] = useState<ConnectorSeg[]>([]);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  /* ── Queries ── */
  const { data: raw = [], isLoading, isError } = useQuery({
    queryKey: ['organization-tree'],
    queryFn: async () => {
      const res: any = await userApi.getAll({ simple: 1, is_active: true });
      const list: any[] = res?.data ?? (Array.isArray(res) ? res : []);
      return list.map((u: any) => ({
        id: u.id,
        name: u.name,
        email: u.email ?? '',
        role: u.role ?? 'employee',
        role_id: u.role_id ?? null,
        role_name: u.role_name ?? '',
        hierarchy_level: u.hierarchy_level ?? 100,
        reporting_manager_id: u.reporting_manager_id ?? null,
        department: (u.department ?? '').trim(),
        groups: Array.isArray(u.groups) ? u.groups.map((g: any) => ({ id: g.id, name: g.name, slug: g.slug })) : [],
      })) as OrgUser[];
    },
    enabled: isAuthenticated && !isAuthLoading,
  });

  const { data: rolesData = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: async () => {
      const res = await roleApi.list();
      return res.data.data;
    },
    enabled: isAuthenticated && !isAuthLoading,
  });

  /* ── Separate assigned vs unassigned ── */
  const { assignedUsers, unassignedUsers } = useMemo(() => {
    const assigned: OrgUser[] = [];
    const unassigned: OrgUser[] = [];
    for (const u of raw) {
      if (!u.department || u.department.trim() === '') {
        unassigned.push(u);
      } else {
        assigned.push(u);
      }
    }
    return { assignedUsers: assigned, unassignedUsers: unassigned };
  }, [raw]);

  /* ── Build tree (only assigned-department users) ── */
  const tree = useMemo(() => {
    // Deduplicate users by ID
    const uniqueUsers = new Map<number, OrgUser>();
    for (const u of assignedUsers) {
      if (!uniqueUsers.has(u.id)) {
        uniqueUsers.set(u.id, u);
      }
    }
    const dedupedUsers = Array.from(uniqueUsers.values());
    
    // Step 1: Find admin (lowest hierarchy_level, always at top)
    const sortedByHierarchy = [...dedupedUsers].sort((a, b) => a.hierarchy_level - b.hierarchy_level);
    const admin = sortedByHierarchy[0];
    
    if (!admin) {
      return { 
        admin: null as OrgUser | null, 
        childrenMap: new Map<number, OrgUser[]>(), 
        allIds: [] as number[],
        managers: [] as OrgUser[] 
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
      u.department && // Must have a department to manage others
      u.department.trim() !== ''
    ).sort((a, b) => a.hierarchy_level - b.hierarchy_level);

    // Step 3: Place users by explicit reporting_manager_id FIRST (highest priority)
    for (const u of dedupedUsers) {
      if (u.id === admin.id) continue;
      if (placedUserIds.has(u.id)) continue;
      
      if (u.reporting_manager_id && userById.has(u.reporting_manager_id)) {
        const manager = userById.get(u.reporting_manager_id)!;
        // Can report to anyone higher in hierarchy
        if (manager.hierarchy_level < u.hierarchy_level) {
          if (!childrenMap.has(manager.id)) childrenMap.set(manager.id, []);
          childrenMap.get(manager.id)!.push(u);
          placedUserIds.add(u.id);
        }
      }
    }
    
    // Step 4: Place employees under managers with same department
    for (const u of dedupedUsers) {
      if (u.id === admin.id) continue;
      if (placedUserIds.has(u.id)) continue;
      
      // Only employees can be auto-assigned by department
      if (u.hierarchy_level >= 100) {
        const userDept = deptLabel(u.department).toLowerCase();
        
        // Find manager with same department (higher rank = lower level number)
        const matchingManager = managers.find((m) => 
          deptLabel(m.department).toLowerCase() === userDept
        );
        
        if (matchingManager) {
          if (!childrenMap.has(matchingManager.id)) childrenMap.set(matchingManager.id, []);
          childrenMap.get(matchingManager.id)!.push(u);
          placedUserIds.add(u.id);
        } else {
          // No matching manager, attach directly to admin
          if (!childrenMap.has(admin.id)) childrenMap.set(admin.id, []);
          childrenMap.get(admin.id)!.push(u);
          placedUserIds.add(u.id);
        }
      } else {
        // Custom roles/managers without explicit reporting go under admin
        if (!childrenMap.has(admin.id)) childrenMap.set(admin.id, []);
        childrenMap.get(admin.id)!.push(u);
        placedUserIds.add(u.id);
      }
    }

    return { 
      admin, 
      childrenMap, 
      allIds: Array.from(uniqueUsers.keys()),
      managers 
    };
  }, [currentUser, assignedUsers]);

  /* ── Auto-collapse large branches ── */
  useEffect(() => {
    if (tree.childrenMap.size > 0 && collapsed.size === 0) {
      const auto = new Set<number>();
      for (const [parentId, children] of tree.childrenMap) {
        if (children.length > 10) auto.add(parentId);
      }
      if (auto.size > 0) setCollapsed(auto);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree.childrenMap, collapsed.size]);

  /* ── Draw connectors ── */
  useEffect(() => {
    const draw = () => {
      const el = wrapperRef.current;
      if (!el) return;

      const wr = el.getBoundingClientRect();
      const segs: ConnectorSeg[] = [];

      const getNodePos = (id: number) => {
        const node = el.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
        if (!node) return null;
        const r = node.getBoundingClientRect();
        return {
          cx: r.left - wr.left + r.width / 2,
          top: r.top - wr.top,
          bottom: r.top - wr.top + r.height,
        };
      };

      for (const [parentId, children] of tree.childrenMap) {
        const parentPos = getNodePos(parentId);
        if (!parentPos) continue;

        for (const child of children) {
          const childPos = getNodePos(child.id);
          if (!childPos) continue;

          const mY = (parentPos.bottom + childPos.top) / 2;
          segs.push({
            path: `M ${parentPos.cx} ${parentPos.bottom} L ${parentPos.cx} ${mY} L ${childPos.cx} ${mY} L ${childPos.cx} ${childPos.top}`,
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
  }, [tree.childrenMap, collapsed, search]);

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
      const accent =
        role.slug === 'admin' ? 'text-rose-500' :
        role.slug === 'employee' ? 'text-amber-600' :
        'text-sky-600';
      return {
        key: `role-card-${role.id}`,
        label: role.name,
        value: count,
        hint: role.is_system ? `System role • Level ${role.hierarchy_level}` : `Custom role • Level ${role.hierarchy_level}`,
        icon: Icon,
        accent,
      };
    });
  }, [rolesData, raw]);

  /* ── Filtered state ── */
  const q = search.trim().toLowerCase();

  /* ── Loading / error states ── */
  if (isAuthLoading || isLoading) return <PageLoadingState label="Building organization tree…" />;
  if (!isAuthenticated) return <PageErrorState message="Please log in to view this page." />;
  if (isError) return <PageErrorState message="Unable to load organization data right now." />;
  if (!tree.admin) return <PageEmptyState title="No organization data" description="No admin record is available." />;

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
                <s.icon className={`h-5 w-5 ${s.accent}`} />
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

          <div className="flex gap-2">
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
          </div>
        </div>

        {/* ── Tree viewport ── */}
        <div className="relative overflow-auto rounded-xl border border-slate-200 bg-white" style={{ minHeight: '400px', maxHeight: '80vh' }}>
          <div ref={wrapperRef} className="relative inline-block min-w-full p-10">
            {/* SVG connectors */}
            <svg className="pointer-events-none absolute inset-0 z-0" width="100%" height="100%">
              {connectors.map((c, i) =>
                c.path ? (
                  <path
                    key={`p${i}`}
                    d={c.path}
                    stroke="#94a3b8"
                    strokeWidth={2}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : null,
              )}
            </svg>

            {/* Tree content */}
            <div className="relative z-10 flex flex-col items-center gap-10">
              {/* Admin */}
              <div className="flex justify-center">
                <div>
                  <TreeNodeCard
                    user={tree.admin}
                    tone="admin"
                    matched={q ? matchUser(tree.admin, q) : undefined}
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
              />
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
