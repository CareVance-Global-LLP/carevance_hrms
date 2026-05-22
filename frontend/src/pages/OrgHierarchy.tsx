import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, Crown, Network, Users } from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { PageErrorState, PageLoadingState, PageEmptyState } from '@/components/ui/PageState';
import { useAuth } from '@/contexts/AuthContext';
import { userApi } from '@/services/api';

type HierarchyUser = {
  id: number;
  name: string;
  email?: string;
  role?: string;
  reporting_manager_id?: number | null;
  department?: string;
  groups?: Array<{ id: number; name: string }>;
};

const resolveDepartment = (user: HierarchyUser) =>
  String(user?.department || user?.groups?.[0]?.name || 'Unassigned').trim() || 'Unassigned';

const roleLabel = (role: string | undefined) => {
  if (role === 'admin') return 'Admin';
  if (role === 'manager') return 'Manager';
  return 'Employee';
};

function PersonNode({ user, tone }: { user: HierarchyUser; tone: 'admin' | 'manager' | 'employee' }) {
  const toneClass =
    tone === 'admin'
      ? 'border-rose-200 bg-rose-50 shadow-md'
      : tone === 'manager'
        ? 'border-sky-200 bg-sky-50 shadow-sm'
        : 'border-amber-200 bg-amber-50 shadow-sm';

  const badgeClass =
    tone === 'admin'
      ? 'bg-rose-100 text-rose-700'
      : tone === 'manager'
        ? 'bg-sky-100 text-sky-700'
        : 'bg-amber-100 text-amber-700';

  const email = user.email ? (
    <p className="mt-0.5 truncate text-[11px] text-slate-400">{user.email}</p>
  ) : null;

  return (
    <div className={`w-full rounded-xl border p-3 ${toneClass}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{user.name}</p>
          <p className="mt-0.5 text-xs text-slate-500">{resolveDepartment(user)}</p>
          {email}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeClass}`}>
          {roleLabel(user.role)}
        </span>
      </div>
    </div>
  );
}

export default function OrgHierarchy() {
  const { user: currentUser, isLoading: isAuthLoading, isAuthenticated } = useAuth();

  const { data: users = [], isLoading, isError } = useQuery({
    queryKey: ['org-hierarchy-users'],
    queryFn: async () => {
      const payload: any = (await userApi.getAll({ simple: true, period: 'all', is_active: true })).data;
      if (Array.isArray(payload)) return payload as HierarchyUser[];
      if (Array.isArray(payload?.data)) return payload.data as HierarchyUser[];
      return [] as HierarchyUser[];
    },
    enabled: isAuthenticated && !isAuthLoading,
  });

  const hierarchy = useMemo(() => {
    const admins = users.filter((item) => item.role === 'admin');
    const managers = users.filter((item) => item.role === 'manager');
    const employees = users.filter((item) => item.role === 'employee');

    const topAdmin: HierarchyUser | null = admins[0]
      || managers[0]
      || (currentUser
        ? {
            id: currentUser.id,
            name: currentUser.name,
            email: currentUser.email,
            role: currentUser.role,
            department: '',
          } as HierarchyUser
        : null);

    const visibleManagers = topAdmin
      ? managers.filter((mgr) => Number(mgr.id) !== Number(topAdmin.id))
      : managers;

    const managerNodes = visibleManagers.map((mgr) => ({
      manager: mgr,
      employees: [] as HierarchyUser[],
    }));
    const managerNodeById = new Map(
      managerNodes.map((n) => [Number(n.manager.id), n])
    );

    const takeLeastLoaded = (nodes: typeof managerNodes) =>
      nodes.reduce<typeof managerNodes[number] | null>((best, curr) =>
        !best || curr.employees.length < best.employees.length ? curr : best, null);

    const unresolved: HierarchyUser[] = [];

    employees.forEach((emp) => {
      const explicitNode = managerNodeById.get(Number(emp.reporting_manager_id || 0));
      if (explicitNode) {
        explicitNode.employees.push(emp);
      } else {
        unresolved.push(emp);
      }
    });

    const unassigned: HierarchyUser[] = [];

    unresolved.forEach((emp) => {
      const empDept = resolveDepartment(emp);
      if (empDept === 'Unassigned') {
        unassigned.push(emp);
        return;
      }
      const deptManagers = managerNodes.filter((n) => resolveDepartment(n.manager) === empDept);
      const deptNode = takeLeastLoaded(deptManagers);
      if (deptNode) {
        deptNode.employees.push(emp);
      } else {
        unassigned.push(emp);
      }
    });

    const topNodeEmployees = managerNodes.length === 0 && topAdmin
      ? employees.filter((e) => Number(e.id) !== Number(topAdmin.id))
      : [];

    return {
      topAdmin,
      managers: managerNodes,
      topNodeEmployees,
      unassignedEmployees: unassigned,
      totals: {
        admins: admins.length,
        managers: managers.length,
        employees: employees.length,
      },
    };
  }, [currentUser, users]);

  if (isAuthLoading || isLoading) {
    return <PageLoadingState label="Building organization hierarchy..." />;
  }

  if (!isAuthenticated) {
    return <PageErrorState message="Please log in to view this page." />;
  }

  if (isError) {
    return <PageErrorState message="Unable to load organization hierarchy right now." />;
  }

  if (!hierarchy.topAdmin) {
    return <PageEmptyState title="No hierarchy data" description="No admin record is available for this organization." />;
  }

  const verticalStem = (h: number) => <div className="mx-auto" style={{ height: h, width: 1, background: '#cbd5e1' }} />;
  const horizontalBar = (w: string) => <div className="mx-auto" style={{ height: 1, width: w, background: '#cbd5e1' }} />;

  const renderManagerColumns = () => {
    const colCount = Math.min(hierarchy.managers.length, 3);
    return (
      <div className="grid grid-cols-1 gap-8" style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}>
        {hierarchy.managers.map(({ manager, employees }) => (
          <div key={manager.id} className="flex flex-col items-center">
            {verticalStem(24)}
            <PersonNode user={manager} tone="manager" />

            {employees.length > 0 ? (
              <div className="mt-5 flex w-full flex-col items-center">
                <div className="flex w-4/5 items-stretch">
                  {employees.map((_, i) => (
                    <div key={i} className="flex-1 border-t border-slate-300" />
                  ))}
                </div>
                <div className="mt-0 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
                  {employees.map((employee) => (
                    <div key={employee.id} className="flex flex-col items-center">
                      {verticalStem(16)}
                      <PersonNode user={employee} tone="employee" />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-5 text-center text-xs italic text-slate-400">No direct reports yet</p>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50/60 pb-8">
      <PageHeader
        title="Org.Hierarchy"
        description="Visual structure from admin to managers and employees, with department labels."
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SurfaceCard className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500">Admins</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950">{hierarchy.totals.admins}</p>
              </div>
              <Crown className="h-5 w-5 text-rose-500" />
            </div>
          </SurfaceCard>
          <SurfaceCard className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500">Managers</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950">{hierarchy.totals.managers}</p>
              </div>
              <Network className="h-5 w-5 text-sky-600" />
            </div>
          </SurfaceCard>
          <SurfaceCard className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500">Employees</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950">{hierarchy.totals.employees}</p>
              </div>
              <Users className="h-5 w-5 text-amber-600" />
            </div>
          </SurfaceCard>
        </div>

        <SurfaceCard className="overflow-x-auto p-6">
          <div className="flex min-w-[840px] flex-col items-center">
            {/* ── Admin ── */}
            <div className="w-[240px]">
              <PersonNode user={hierarchy.topAdmin} tone="admin" />
            </div>

            {/* ── Managers subtree ── */}
            {hierarchy.managers.length > 0 && (
              <div className="mt-0 flex w-full flex-col items-center">
                {verticalStem(28)}

                <div className="flex w-full max-w-5xl items-stretch">
                  {hierarchy.managers.map((_, i) => (
                    <div key={i} className="flex-1 border-t border-slate-300" />
                  ))}
                </div>

                <div className="mt-0 w-full max-w-5xl">{renderManagerColumns()}</div>
              </div>
            )}

            {/* ── No managers: flat employee list or empty ── */}
            {hierarchy.managers.length === 0 && hierarchy.topNodeEmployees.length > 0 && (
              <div className="flex flex-col items-center">
                {verticalStem(24)}
                {horizontalBar('60%')}
                <div className="mt-4 grid max-w-4xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {hierarchy.topNodeEmployees.map((employee) => (
                    <div key={employee.id} className="flex flex-col items-center">
                      {verticalStem(16)}
                      <PersonNode user={employee} tone="employee" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {hierarchy.managers.length === 0 && hierarchy.topNodeEmployees.length === 0 && (
              <div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-5 text-center text-sm text-slate-500">
                No manager records found. Add manager users to build hierarchy branches.
              </div>
            )}

            {/* ── Unassigned employees section ── */}
            {hierarchy.unassignedEmployees.length > 0 && (
              <div className="mt-10 w-full">
                <div className="mb-4 rounded-lg border border-dashed border-amber-300 bg-amber-50/60 p-3">
                  <p className="text-xs font-semibold text-amber-800">Unassigned Employees</p>
                  <p className="mt-0.5 text-xs text-amber-600">
                    These employees do not have a reporting manager assigned and are shown outside the tree.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {hierarchy.unassignedEmployees.map((employee) => (
                    <PersonNode key={employee.id} user={employee} tone="employee" />
                  ))}
                </div>
              </div>
            )}
          </div>
        </SurfaceCard>

        <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-500">
          <Building2 className="h-3.5 w-3.5" />
          Department name is displayed under each person. Connector lines show reporting structure.
        </p>
      </div>
    </div>
  );
}
