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
      ? 'border-rose-300 bg-rose-50'
      : tone === 'manager'
        ? 'border-sky-300 bg-sky-50'
        : 'border-amber-300 bg-amber-50';

  const badgeClass =
    tone === 'admin'
      ? 'bg-rose-100 text-rose-700'
      : tone === 'manager'
        ? 'bg-sky-100 text-sky-700'
        : 'bg-amber-100 text-amber-700';

  return (
    <div className={`rounded-xl border p-3 shadow-sm ${toneClass}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{user.name}</p>
          <p className="mt-1 text-xs text-slate-600">{resolveDepartment(user)}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeClass}`}>
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

    const topAdmin = admins[0]
      || managers[0]
      || (currentUser ? ({
        id: currentUser.id,
        name: currentUser.name,
        email: currentUser.email,
        role: currentUser.role,
        department: '',
      } as HierarchyUser) : null);

    const visibleManagers = topAdmin
      ? managers.filter((manager) => Number(manager.id) !== Number(topAdmin.id))
      : managers;

    const assignedEmployeeIds = new Set<number>();
    const managerNodes = visibleManagers.map((manager) => {
      const managerDepartment = resolveDepartment(manager);
      const directEmployees = employees.filter((employee) => {
        if (assignedEmployeeIds.has(employee.id)) return false;
        return managerDepartment !== 'Unassigned' && resolveDepartment(employee) === managerDepartment;
      });
      directEmployees.forEach((employee) => assignedEmployeeIds.add(employee.id));

      return {
        manager,
        employees: [...directEmployees],
      };
    });

    const topNodeEmployees = managerNodes.length === 0 && topAdmin
      ? employees.filter((employee) => Number(employee.id) !== Number(topAdmin.id))
      : [];

    const unassignedEmployees = employees.filter((employee) => !assignedEmployeeIds.has(employee.id));
    if (managerNodes.length > 0) {
      unassignedEmployees.forEach((employee, index) => {
        managerNodes[index % managerNodes.length].employees.push(employee);
      });
    }

    return {
      topAdmin,
      managers: managerNodes,
      topNodeEmployees,
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

        <SurfaceCard className="overflow-x-auto p-5">
          <div className="min-w-[840px]">
            <div className="flex justify-center">
              <div className="w-[240px]">
                <PersonNode user={hierarchy.topAdmin} tone="admin" />
              </div>
            </div>

            {hierarchy.managers.length > 0 ? (
              <>
                <div className="mx-auto h-8 w-px bg-slate-300" />
                <div className="mx-auto h-px w-[85%] bg-slate-300" />
              </>
            ) : null}

            <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
              {hierarchy.managers.length > 0 ? hierarchy.managers.map(({ manager, employees }) => (
                <div key={manager.id}>
                  <div className="mx-auto h-6 w-px bg-slate-300" />
                  <PersonNode user={manager} tone="manager" />

                  <div className="mx-auto mt-3 h-4 w-px bg-slate-300" />
                  <div className="h-px w-full bg-slate-300" />

                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {employees.length > 0 ? employees.map((employee) => (
                      <div key={employee.id}>
                        <div className="mx-auto h-4 w-px bg-slate-300" />
                        <PersonNode user={employee} tone="employee" />
                      </div>
                    )) : (
                      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-xs text-slate-500">
                        No employees mapped yet.
                      </div>
                    )}
                  </div>
                </div>
              )) : (
                hierarchy.topNodeEmployees.length > 0 ? (
                  <div className="col-span-full">
                    <div className="mx-auto h-6 w-px bg-slate-300" />
                    <div className="mx-auto h-px w-[60%] bg-slate-300" />
                    <div className="mx-auto mt-4 grid max-w-4xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {hierarchy.topNodeEmployees.map((employee) => (
                        <div key={employee.id}>
                          <div className="mx-auto h-4 w-px bg-slate-300" />
                          <PersonNode user={employee} tone="employee" />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="col-span-full rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
                    No manager records found. Add manager users to build hierarchy branches.
                  </div>
                )
              )}
            </div>
          </div>
        </SurfaceCard>

        <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-500">
          <Building2 className="h-3.5 w-3.5" />
          Department name is displayed under each person.
        </p>
      </div>
    </div>
  );
}
