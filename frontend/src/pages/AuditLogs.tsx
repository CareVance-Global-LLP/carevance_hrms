import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import PageHeader from '@/components/dashboard/PageHeader';
import FilterPanel from '@/components/dashboard/FilterPanel';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import Button from '@/components/ui/Button';
import { PageEmptyState, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { FieldLabel, TextInput } from '@/components/ui/FormField';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatDateTime } from '@/lib/dateTime';
import { DEFAULT_APP_TIMEZONE } from '@/lib/timezones';
import { useAuth } from '@/contexts/AuthContext';
import { auditApi } from '@/services/api';

const prettifyAction = (value: string) =>
  value
    .split('.')
    .map((part) => part.replace(/_/g, ' '))
    .join(' / ');

type AuditLogsResponse = Awaited<ReturnType<typeof auditApi.list>>['data'];

export default function AuditLogs() {
  const { user } = useAuth();
  const viewerTimezone = (user?.settings as any)?.timezone || DEFAULT_APP_TIMEZONE;
  const [action, setAction] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [actorUserId, setActorUserId] = useState('');
  const [targetType, setTargetType] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<AuditLogsResponse>({
    queryKey: ['audit-logs', action, dateFrom, dateTo, actorUserId, targetType, page],
    queryFn: async () => {
      const response = await auditApi.list({
        action: action || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        actor_user_id: actorUserId ? Number(actorUserId) : undefined,
        target_type: targetType || undefined,
        page,
        per_page: 10,
      });

      return response.data;
    },
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Governance"
        title="Audit Logs"
        description="Review sensitive HRMS actions across authentication, payroll, invoices, attendance approvals, screenshots, and settings."
      />

      <FilterPanel className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <div>
          <FieldLabel>Action</FieldLabel>
          <TextInput
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
            placeholder="payroll.marked_paid"
          />
        </div>
        <div>
          <FieldLabel>Date From</FieldLabel>
          <TextInput
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div>
          <FieldLabel>Date To</FieldLabel>
          <TextInput
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div>
          <FieldLabel>Actor User ID</FieldLabel>
          <TextInput
            type="number"
            value={actorUserId}
            onChange={(e) => {
              setActorUserId(e.target.value);
              setPage(1);
            }}
            placeholder="12"
          />
        </div>
        <div>
          <FieldLabel>Target Type</FieldLabel>
          <TextInput
            value={targetType}
            onChange={(e) => {
              setTargetType(e.target.value);
              setPage(1);
            }}
            placeholder="Payroll"
          />
        </div>
      </FilterPanel>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-500">
          {data?.pagination ? `Page ${data.pagination.current_page} of ${data.pagination.last_page}` : 'Page 1 of 1'}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={page <= 1 || isLoading}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const lastPage = data?.pagination?.last_page ?? page;
              setPage((prev) => (prev < lastPage ? prev + 1 : prev));
            }}
            disabled={!data?.pagination || page >= (data.pagination?.last_page || 1) || isLoading}
          >
            Next
          </Button>
          <Button variant="secondary" onClick={() => refetch()} disabled={isFetching}>
            Refresh Logs
          </Button>
        </div>
      </div>

      {isLoading ? <PageLoadingState label="Loading audit logs..." /> : null}
      {isError ? <PageErrorState message="Failed to load audit logs." onRetry={() => refetch()} /> : null}

      {!isLoading && !isError ? (
        <SurfaceCard className="overflow-hidden">
          {!data?.data?.length ? (
            <div className="p-6">
              <PageEmptyState title="No audit logs found" description="Try broadening the filters or perform an audited action to populate the history." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">When</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Action</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Actor</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Target</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Metadata</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((log) => (
                    <tr key={log.id} className="border-b border-slate-100 align-top">
                      <td className="px-4 py-3 text-slate-600">
                        {formatDateTime(log.created_at, viewerTimezone)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge tone="info" className="normal-case tracking-normal">
                          {prettifyAction(log.action)}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <p className="font-medium text-slate-900">{log.actor?.name || 'System'}</p>
                        <p className="text-xs text-slate-500">{log.actor?.email || log.ip_address || '--'}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <p className="font-medium text-slate-900">{log.target_type || '--'}</p>
                        <p className="text-xs text-slate-500">{log.target_id ? `#${log.target_id}` : 'No target id'}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                    <pre className="max-w-[34rem] whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3">
                          {JSON.stringify(log.metadata || {}, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SurfaceCard>
      ) : null}
    </div>
  );
}
