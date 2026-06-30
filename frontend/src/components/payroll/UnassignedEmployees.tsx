import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, UserX, Users, ArrowLeft, Loader2 } from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';

interface UnassignedEmployeesProps {
  onBack: () => void;
}

export default function UnassignedEmployees({ onBack }: UnassignedEmployeesProps) {
  const [search, setSearch] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['payroll', 'unassigned-employees'],
    queryFn: () => payrollApi.getUnassignedEmployees().then((r) => r.data),
  });

  const employees = data?.employees ?? [];

  const filtered = useMemo(() => {
    if (!search) return employees;
    const q = search.toLowerCase();
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        (e.designation ?? '').toLowerCase().includes(q) ||
        (e.employee_code ?? '').toLowerCase().includes(q),
    );
  }, [employees, search]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            iconLeft={<ArrowLeft className="h-4 w-4" />}
          >
            Back to Payroll
          </Button>
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Unassigned Employees</h1>
        <p className="mt-1 max-w-3xl text-xs text-slate-500">
          Employees who are not assigned to any pay group. Assign them to a pay group to include them in payroll processing.
        </p>
      </div>

      <SurfaceCard className="p-4">
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, designation..."
            className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
        </div>
      </SurfaceCard>

      {isLoading && (
        <div className="flex items-center justify-center py-12 text-slate-500">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          Loading employees...
        </div>
      )}

      {error && (
        <SurfaceCard className="p-6 text-center text-rose-600">
          Failed to load employees. Please try again.
        </SurfaceCard>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <SurfaceCard className="p-12 text-center">
          <Users className="h-12 w-12 mx-auto text-slate-300" />
          <h3 className="mt-4 text-lg font-medium text-slate-900">
            {search ? 'No matching employees' : 'All employees are assigned'}
          </h3>
          <p className="mt-2 text-sm text-slate-500">
            {search
              ? 'Try a different search term.'
              : 'Every employee in your organization is already assigned to a pay group.'}
          </p>
        </SurfaceCard>
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <SurfaceCard className="p-0 overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">
              {filtered.length} Unassigned Employee{filtered.length === 1 ? '' : 's'}
            </h3>
          </div>
          <div className="divide-y divide-slate-200">
            {filtered.map((emp) => (
              <div
                key={emp.id}
                className="flex items-center justify-between p-4 hover:bg-slate-50/50"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                    {emp.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900">{emp.name}</p>
                    <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
                      <span>{emp.email}</span>
                      {emp.designation && <span>· {emp.designation}</span>}
                      {emp.employee_code && <span>· {emp.employee_code}</span>}
                    </div>
                  </div>
                </div>
                <UserX className="h-4 w-4 text-slate-400" />
              </div>
            ))}
          </div>
        </SurfaceCard>
      )}
    </div>
  );
}
