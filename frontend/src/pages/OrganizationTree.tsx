import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  Crown,
  Minus,
  Network,
  Plus,
  Search,
  Users,
  UserX,
  X,
} from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { PageErrorState, PageLoadingState, PageEmptyState } from '@/components/ui/PageState';
import { useAuth } from '@/contexts/AuthContext';
import { userApi } from '@/services/api';

/* ── Types ── */

type SimpleGroup = { id: number; name: string; slug?: string | null };

type OrgUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  reporting_manager_id: number | null;
  department: string;
  groups?: SimpleGroup[];
};

type ManagerNode = { manager: OrgUser; employees: OrgUser[] };

type DeptGroup = { department: string; mgrs: ManagerNode[] };

type NodeTone = 'admin' | 'manager' | 'employee';

type LabelDef = { text: string; x: number; y: number };

type ConnectorSeg = { path: string; label?: LabelDef };

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

/* ── Tone palette ── */

const TONES: Record<NodeTone, { border: string; bg: string; avatar: string; badge: string }> = {
  admin:    { border: 'border-rose-200', bg: 'bg-rose-50', avatar: 'bg-rose-100 text-rose-700', badge: 'bg-rose-100 text-rose-700' },
  manager:  { border: 'border-sky-200', bg: 'bg-sky-50', avatar: 'bg-sky-100 text-sky-700', badge: 'bg-sky-100 text-sky-700' },
  employee: { border: 'border-amber-200', bg: 'bg-amber-50', avatar: 'bg-amber-100 text-amber-700', badge: 'bg-amber-100 text-amber-700' },
};

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', manager: 'Manager' };

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
            {ROLE_LABEL[user.role] ?? 'Employee'}
          </p>
          {dept !== 'Unassigned' && (
            <p className="mt-0.5 break-words text-[11px] font-medium text-slate-500">{dept}</p>
          )}
          {dept === 'Unassigned' && (
            <p className="mt-0.5 text-[11px] font-medium text-slate-400 italic">No department</p>
          )}
          {typeof count === 'number' && (
            <p className="mt-1 text-[10px] font-medium text-slate-400">
              {count > 0 ? `${count} employee${count === 1 ? '' : 's'}` : 'No employees yet'}
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

/* ── Connector label pill ── */

function LabelPill({ l }: { l: LabelDef }) {
  const w = l.text.length * 7.5 + 20;
  return (
    <g>
      <rect x={l.x - w / 2} y={l.y - 10} width={w} height={20} rx={10} fill="#f8fafc" stroke="#94a3b8" strokeWidth={1.5} />
      <text x={l.x} y={l.y + 0.5} textAnchor="middle" dominantBaseline="central" fill="#475569" fontSize={10} fontWeight={700} fontFamily="system-ui, sans-serif">
        {l.text}
      </text>
    </g>
  );
}

/* ── Main ── */

export default function OrganizationTree() {
  const { user: currentUser, isLoading: isAuthLoading, isAuthenticated } = useAuth();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [connectors, setConnectors] = useState<ConnectorSeg[]>([]);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('All');
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

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
        reporting_manager_id: u.reporting_manager_id ?? null,
        department: (u.department ?? '').trim(),
        groups: Array.isArray(u.groups) ? u.groups.map((g: any) => ({ id: g.id, name: g.name, slug: g.slug })) : [],
      })) as OrgUser[];
    },
    enabled: isAuthenticated && !isAuthLoading,
  });

  /* ── Build tree ── */
  const tree = useMemo(() => {
    const admins = raw.filter((u) => u.role === 'admin');
    const managers = raw.filter((u) => u.role === 'manager');
    const employees = raw.filter((u) => u.role === 'employee');

    const admin: OrgUser | null =
      admins[0] ??
      managers[0] ??
      (currentUser
        ? { id: currentUser.id, name: currentUser.name, email: currentUser.email ?? '', role: 'admin', reporting_manager_id: null, department: '', groups: [] }
        : null);

    // Build manager lookup
    const mgrById = new Map<number, OrgUser>();
    const deptMap = new Map<string, OrgUser[]>();

    const activeManagers = admin ? managers.filter((m) => Number(m.id) !== Number(admin.id)) : managers;

    for (const m of activeManagers) {
      mgrById.set(m.id, m);
      const dept = deptLabel(m.department);
      if (!deptMap.has(dept)) deptMap.set(dept, []);
      deptMap.get(dept)!.push(m);
    }

    // Assign employees to managers
    const empByMgr = new Map<number, OrgUser[]>();
    const unassignedEmps: OrgUser[] = [];

    // Helper: least-loaded manager in a list
    const leastLoaded = (mgrs: OrgUser[]) =>
      mgrs.reduce<OrgUser | null>((best, cur) => {
        const bestCount = empByMgr.get(best?.id ?? -1)?.length ?? 0;
        const curCount = empByMgr.get(cur.id)?.length ?? 0;
        return !best || curCount < bestCount ? cur : best;
      }, null);

    const addToMgr = (mgrId: number, emp: OrgUser) => {
      if (!empByMgr.has(mgrId)) empByMgr.set(mgrId, []);
      empByMgr.get(mgrId)!.push(emp);
    };

    for (const e of employees) {
      const mgrId = e.reporting_manager_id;
      const empDept = deptLabel(e.department);

      if (mgrId && mgrById.has(mgrId)) {
        // 1. Explicit reporting_manager_id (only when department is compatible)
        const explicitMgr = mgrById.get(mgrId)!;
        const mgrDept = deptLabel(explicitMgr.department);
        const isDeptCompatible =
          empDept === 'Unassigned'
          || mgrDept === 'Unassigned'
          || empDept.toLowerCase() === mgrDept.toLowerCase();

        if (isDeptCompatible) {
          addToMgr(mgrId, e);
          continue;
        }
      }

      // 2. Fallback: match by department
      if (empDept !== 'Unassigned') {
        const deptMgrs = deptMap.get(empDept) ?? [];
        const target = leastLoaded(deptMgrs);
        if (target) { addToMgr(target.id, e); continue; }
      } else {
        // Unassigned department with no compatible explicit manager
      }

      // 3. No match — truly unassigned
      unassignedEmps.push(e);
    }

    // Build department groups
    const groups: DeptGroup[] = [];
    for (const [dept, mgrs] of deptMap) {
      groups.push({
        department: dept,
        mgrs: mgrs.map((m) => ({
          manager: m,
          employees: empByMgr.get(m.id) ?? [],
        })),
      });
    }

    groups.sort((a, b) => {
      if (a.department === 'Unassigned') return 1;
      if (b.department === 'Unassigned') return -1;
      return a.department.localeCompare(b.department);
    });

    // Group unassigned employees by first group name
    const unassignedMap = new Map<string, OrgUser[]>();
    for (const e of unassignedEmps) {
      const key = e.groups?.[0]?.name || 'Not Assigned Yet';
      if (!unassignedMap.has(key)) unassignedMap.set(key, []);
      unassignedMap.get(key)!.push(e);
    }

    // All departments for filter pills
    const allDepts = [
      'All',
      ...new Set(raw.map((u) => deptLabel(u.department)).filter((d) => d !== 'Unassigned').sort()),
    ];

    return {
      admin,
      groups,
      unassignedEmps: unassignedMap,
      allDepts,
      allMgrIds: activeManagers.map((m) => m.id),
      totals: {
        admins: admins.length,
        managers: activeManagers.length,
        employees: employees.length,
        unassigned: unassignedEmps.length,
      },
    };
  }, [currentUser, raw]);

  /* ── Auto-collapse large branches ── */
  useEffect(() => {
    if (tree.allMgrIds.length > 0 && collapsed.size === 0) {
      const auto = new Set<number>();
      for (const g of tree.groups) {
        for (const n of g.mgrs) {
          if (n.employees.length > 10) auto.add(n.manager.id);
        }
      }
      if (auto.size > 0) setCollapsed(auto);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree.allMgrIds.join(','), tree.groups, collapsed.size]);

  /* ── Draw connectors ── */
  useEffect(() => {
    const draw = () => {
      const el = wrapperRef.current;
      if (!el) return;

      const wr = el.getBoundingClientRect();
      const segs: ConnectorSeg[] = [];

      const adminEl = el.querySelector<HTMLElement>('[data-node="admin"]');
      if (!adminEl) { setConnectors([]); return; }

      const ar = adminEl.getBoundingClientRect();
      const aCx = ar.left - wr.left + ar.width / 2;
      const aBy = ar.top - wr.top + ar.height;

      const mgrEls = el.querySelectorAll<HTMLElement>('[data-node="manager"]');
      const empEls = el.querySelectorAll<HTMLElement>('[data-node="employee"]');

      if (mgrEls.length === 0) {
        empEls.forEach((ee) => {
          const er = ee.getBoundingClientRect();
          const eCx = er.left - wr.left + er.width / 2;
          const eTy = er.top - wr.top;
          const mY = (aBy + eTy) / 2;
          segs.push({ path: `M ${aCx} ${aBy} L ${aCx} ${mY} L ${eCx} ${mY} L ${eCx} ${eTy}` });
        });
      } else {
        mgrEls.forEach((me) => {
          const mr = me.getBoundingClientRect();
          const mCx = mr.left - wr.left + mr.width / 2;
          const mTy = mr.top - wr.top;
          const mY = (aBy + mTy) / 2;

          segs.push({ path: `M ${aCx} ${aBy} L ${aCx} ${mY} L ${mCx} ${mY} L ${mCx} ${mTy}` });

          const mgrId = Number(me.getAttribute('data-id'));
          const mBy = mr.top - wr.top + mr.height;

          el.querySelectorAll<HTMLElement>(`[data-node="employee"][data-mgr="${mgrId}"]`).forEach((ee) => {
            const er = ee.getBoundingClientRect();
            const eCx = er.left - wr.left + er.width / 2;
            const eTy = er.top - wr.top;
            const mY2 = (mBy + eTy) / 2;
            segs.push({ path: `M ${mCx} ${mBy} L ${mCx} ${mY2} L ${eCx} ${mY2} L ${eCx} ${eTy}` });
          });
        });
      }

      setConnectors(segs);
    };

    const ro = new ResizeObserver(draw);
    const wrapper = wrapperRef.current;
    if (wrapper) ro.observe(wrapper);
    requestAnimationFrame(draw);
    return () => ro.disconnect();
  }, [tree.groups, tree.admin, collapsed, search, deptFilter]);

  /* ── Filtered state ── */
  const q = search.trim().toLowerCase();
  const hasNoDeptFilter = deptFilter === 'All';

  const filteredGroups = useMemo(() => {
    let list = tree.groups;
    if (!hasNoDeptFilter) list = list.filter((g) => g.department === deptFilter);
    if (!q) return list;
    return list
      .map((g) => ({
        ...g,
        mgrs: g.mgrs
          .map((n) => ({ ...n, employees: n.employees.filter((e) => matchUser(e, q)) }))
          .filter((n) => matchUser(n.manager, q) || n.employees.length > 0),
      }))
      .filter((g) => g.mgrs.length > 0 || g.department.toLowerCase().includes(q));
  }, [tree.groups, deptFilter, hasNoDeptFilter, q]);

  const filteredUnassigned = useMemo(() => {
    if (!q) return tree.unassignedEmps;
    const out = new Map<string, OrgUser[]>();
    for (const [key, list] of tree.unassignedEmps) {
      const filtered = list.filter((e) => matchUser(e, q));
      if (filtered.length > 0) out.set(key, filtered);
    }
    return out;
  }, [tree.unassignedEmps, q]);

  const toggle = (id: number) => {
    setCollapsed((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  /* ── Loading / error states ── */
  if (isAuthLoading || isLoading) return <PageLoadingState label="Building organization tree…" />;
  if (!isAuthenticated) return <PageErrorState message="Please log in to view this page." />;
  if (isError) return <PageErrorState message="Unable to load organization data right now." />;
  if (!tree.admin) return <PageEmptyState title="No organization data" description="No admin record is available." />;

  const unassignedCount = tree.totals.unassigned;

  return (
    <div className="min-h-screen bg-slate-50/60 pb-8">
      <PageHeader title="Organization" description="Company hierarchy — admins, departments, managers, and reporting structure." />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* ── Stats ── */}
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([
            { label: 'Admins', value: tree.totals.admins, icon: Crown, color: 'text-rose-500' },
            { label: 'Managers', value: tree.totals.managers, icon: Network, color: 'text-sky-600' },
            { label: 'Employees', value: tree.totals.employees, icon: Users, color: 'text-amber-600' },
            { label: 'Unassigned', value: unassignedCount, icon: UserX, color: 'text-slate-400' },
          ] as const).map((s) => (
            <SurfaceCard key={s.label} className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500">{s.label}</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-950">{s.value}</p>
                </div>
                <s.icon className={`h-5 w-5 ${s.color}`} />
              </div>
            </SurfaceCard>
          ))}
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

          <div className="flex flex-wrap items-center gap-2">
            {tree.allDepts.slice(0, 9).map((dept) => (
              <button
                key={dept}
                onClick={() => setDeptFilter(dept)}
                className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition ${
                  deptFilter === dept
                    ? 'border-sky-300 bg-sky-50 text-sky-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                {dept}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setCollapsed(new Set(tree.allMgrIds))}
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
        <div className="relative overflow-auto rounded-xl border border-slate-200 bg-white" style={{ height: '75vh' }}>
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
                <div data-node="admin" data-id={tree.admin.id}>
                  <TreeNodeCard
                    user={tree.admin}
                    tone="admin"
                    matched={matchUser(tree.admin, q)}
                  />
                </div>
              </div>

              {/* Department groups */}
              {filteredGroups.length > 0 ? (
                <div className="flex flex-wrap items-start justify-center gap-8">
                  {filteredGroups.map((group) => (
                    <div key={group.department} className="flex flex-col items-center gap-5">
                      {/* Department header */}
                      <div className="flex items-center gap-2 rounded-full border-2 border-slate-300 bg-white px-4 py-2 shadow-sm">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                          {group.department}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                          {group.mgrs.length} {group.mgrs.length === 1 ? 'manager' : 'managers'}
                        </span>
                      </div>

                      {/* Managers row */}
                      <div className="flex flex-wrap justify-center gap-5">
                        {group.mgrs.map((node) => (
                          <div key={node.manager.id} className="flex flex-col items-center gap-4">
                            <div data-node="manager" data-id={node.manager.id}>
                              <TreeNodeCard
                                user={node.manager}
                                tone="manager"
                                count={node.employees.length}
                                isCollapsed={collapsed.has(node.manager.id)}
                                onToggle={() => toggle(node.manager.id)}
                                matched={matchUser(node.manager, q)}
                              />
                            </div>

                            {!collapsed.has(node.manager.id) && node.employees.length > 0 && (
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {node.employees.map((emp) => (
                                  <div key={emp.id} data-node="employee" data-mgr={node.manager.id}>
                                    <TreeNodeCard
                                      user={emp}
                                      tone="employee"
                                      groupNames={emp.groups?.map((g) => g.name)}
                                      matched={matchUser(emp, q)}
                                    />
                                  </div>
                                ))}
                              </div>
                            )}

                            {!collapsed.has(node.manager.id) && node.employees.length === 0 && (
                              <p className="text-xs italic text-slate-400">No direct reports yet</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">No managers or employees found.</p>
              )}
            </div>
          </div>
        </div>

        {/* ── Unassigned Employees ── */}
        {filteredUnassigned.size > 0 && (
          <div className="mt-8 space-y-4">
            <div className="flex items-center gap-2">
              <UserX className="h-4 w-4 text-amber-500" />
              <h3 className="text-sm font-semibold text-slate-800">Unassigned Employees</h3>
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">
                {unassignedCount}
              </span>
              <p className="text-[11px] text-slate-400">
                Employees without a reporting manager
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from(filteredUnassigned.entries()).map(([key, list]) => (
                <SurfaceCard key={key} className="overflow-hidden">
                  <div className="border-b border-slate-100 bg-slate-50/60 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                      {key === 'Not Assigned Yet' ? (
                        <span className="text-slate-400">Not Assigned Yet</span>
                      ) : (
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-400" />
                          {key}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="space-y-1.5 p-3">
                    {list.length === 0 && (
                      <p className="text-[11px] italic text-slate-400">No employees</p>
                    )}
                    {list.map((emp) => (
                      <div
                        key={emp.id}
                        className="flex items-center gap-2.5 rounded-lg border border-slate-100 bg-white px-2.5 py-2 shadow-sm transition hover:border-amber-300 hover:shadow-md"
                      >
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700">
                          {initials(emp.name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-slate-800">{emp.name}</p>
                          <div className="flex flex-wrap items-center gap-1">
                            {emp.groups && emp.groups.length > 0 && (
                              <span className="truncate rounded bg-indigo-50 px-1 py-0.5 text-[9px] font-medium text-indigo-600">
                                {emp.groups.map((g) => g.name).join(', ')}
                              </span>
                            )}
                            {(!emp.groups || emp.groups.length === 0) && key === 'Not Assigned Yet' && (
                              <span className="text-[10px] italic text-slate-400">No groups</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </SurfaceCard>
              ))}
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
            to the <strong>department manager</strong>. Employees in &quot;Not Assigned Yet&quot;
            cannot submit requests until a manager is assigned or a department group is created.
            New departments and employees appear here automatically.
          </p>
        </div>
      </div>
    </div>
  );
}
