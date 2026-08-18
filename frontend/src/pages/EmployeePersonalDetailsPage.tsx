import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Package } from 'lucide-react';
import Button from '@/components/ui/Button';
import { PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { employeeWorkspaceApi } from '@/services/api';
import { assetsApi } from '@/services/assetsApi';
import PayrollReadinessCard from '@/components/employees/PayrollReadinessCard';
import EmployeeDetailsSection from '@/components/EmployeeDetailsSection';

/**
 * One employee, as an admin sees them.
 *
 * This page used to carry its own copy of the personal-details, work-info,
 * government-ID, bank and document sections — around 500 lines duplicating
 * EmployeeDetailsSection almost exactly. The two copies had already drifted
 * apart: the component validated government IDs against lib/idValidation and
 * wrote lower-case id_type values, this page did neither and wrote upper-case
 * ones, so employee_government_ids holds both spellings for the same kind of
 * ID. Adding fields to both would have made that a three-way divergence.
 *
 * It now renders the component and keeps only what is genuinely its own: the
 * payroll-readiness card, and the assets assigned to this person.
 *
 * `editable` is the other half of the change. The duplicated block hardcoded
 * `canEditOwnProfile = false`, which meant an admin could not edit an
 * employee's personal details from anywhere in the application — the write
 * endpoint existed and only the employee's own Settings page ever called it.
 * Authorisation is the server's: PUT /employees/{id}/profile allows the owner
 * or a manager who can manage them, and this route is admin-gated on top.
 */
export default function EmployeePersonalDetailsPage() {
  const { employeeCode } = useParams();
  const navigate = useNavigate();

  // The route param is employeeCode — passed straight through, since the
  // backend resolves either a code or a numeric id.
  const id = employeeCode;

  const workspaceQuery = useQuery({
    queryKey: ['employee-workspace', id],
    queryFn: async () => (await employeeWorkspaceApi.getWorkspace(id)).data,
    enabled: Boolean(id),
  });

  const employeeUserId = workspaceQuery.data?.employee?.id;
  const employeeAssetsQuery = useQuery({
    queryKey: ['employee-assets', employeeUserId],
    queryFn: async () => (await assetsApi.employeeAssets(employeeUserId as number)).data.data,
    enabled: Boolean(employeeUserId),
  });

  if (workspaceQuery.isLoading) return <PageLoadingState label="Loading employee details..." />;
  if (workspaceQuery.isError || !workspaceQuery.data) {
    return (
      <PageErrorState
        message={(workspaceQuery.error as any)?.response?.data?.message || 'Failed to load employee details.'}
        onRetry={() => void workspaceQuery.refetch()}
      />
    );
  }

  const data = workspaceQuery.data;

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <Button variant="secondary" onClick={() => navigate('/employees')}>
          <ArrowLeft className="h-4 w-4" />
          Back to Employees
        </Button>
      </div>

      {/* Placed above the detail sections on purpose: if this person will not
          be paid, that is the most important thing on the page. */}
      <PayrollReadinessCard readiness={(data as any)?.payroll_readiness} />

      <EmployeeDetailsSection employeeCode={id} showHeader editable />

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-blue-600" />
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Assigned Assets</p>
        </div>
        <p className="mt-1 text-sm text-slate-500">Company assets currently assigned to this employee.</p>

        {employeeAssetsQuery.isLoading ? (
          <p className="mt-5 text-sm text-slate-500">Loading assets…</p>
        ) : employeeAssetsQuery.isError ? (
          <p className="mt-5 text-sm text-rose-600">Could not load assigned assets.</p>
        ) : (employeeAssetsQuery.data?.length ?? 0) === 0 ? (
          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-sm text-slate-500">No assets are currently assigned to this employee.</p>
          </div>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  <th className="py-2 pr-4">Tag</th>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Category</th>
                  <th className="py-2 pr-4">Assigned Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {employeeAssetsQuery.data?.map((item) => (
                  <tr key={item.assignment_id}>
                    <td className="py-2.5 pr-4 font-medium text-slate-900">{item.asset_tag}</td>
                    <td className="py-2.5 pr-4 text-slate-700">{item.name}</td>
                    <td className="py-2.5 pr-4 capitalize text-slate-600">{item.category}</td>
                    <td className="py-2.5 pr-4 text-slate-600">
                      {item.assigned_date
                        ? new Date(item.assigned_date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
