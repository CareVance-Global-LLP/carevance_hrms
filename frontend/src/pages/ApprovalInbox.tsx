import { useEffect, useMemo, useState } from 'react';
import { attendanceTimeEditApi, leaveApi } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { canReviewApprovalRequest } from '@/lib/permissions';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import MetricCard from '@/components/dashboard/MetricCard';
import Button from '@/components/ui/Button';
import { FeedbackBanner, PageEmptyState, PageLoadingState } from '@/components/ui/PageState';
import { CheckCircle2, Clock3, Inbox, XCircle } from 'lucide-react';

const formatDuration = (seconds: number) => {
  const safe = Number.isFinite(Number(seconds)) ? Number(seconds) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${hours}h ${minutes}m`;
};

type InboxItem =
  | {
      kind: 'leave';
      id: number;
      submitted_at: string;
      title: string;
      description: string;
      employee_name: string;
      employee_email: string;
      status: string;
      onApprove: () => Promise<void>;
      onReject: () => Promise<void>;
    }
  | {
      kind: 'time_edit';
      id: number;
      submitted_at: string;
      title: string;
      description: string;
      employee_name: string;
      employee_email: string;
      status: string;
      onApprove: () => Promise<void>;
      onReject: () => Promise<void>;
    };

export default function ApprovalInbox() {
  const { user } = useAuth();
  const [leaveRequests, setLeaveRequests] = useState<any[]>([]);
  const [timeEditRequests, setTimeEditRequests] = useState<any[]>([]);
  const [activeFilter, setActiveFilter] = useState<'all' | 'leave' | 'time_edit'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const load = async () => {
    setIsLoading(true);
    try {
      const [leaveResponse, timeEditResponse] = await Promise.all([
        leaveApi.list({ status: 'pending' }),
        attendanceTimeEditApi.list({ status: 'pending' }),
      ]);

      setLeaveRequests(leaveResponse.data?.data || []);
      setTimeEditRequests(timeEditResponse.data?.data || []);
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to load approval inbox.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleAction = async (action: () => Promise<void>, successMessage: string) => {
    setFeedback(null);
    try {
      await action();
      setFeedback({ tone: 'success', message: successMessage });
      await load();
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Approval action failed.' });
    }
  };

  const items = useMemo<InboxItem[]>(() => {
    const reviewableLeaveRequests = leaveRequests.filter((item) => canReviewApprovalRequest(user, item.user));
    const reviewableTimeEditRequests = timeEditRequests.filter((item) => canReviewApprovalRequest(user, item.user));

    const leaveItems = reviewableLeaveRequests.map((item) => ({
      kind: 'leave' as const,
      id: item.id,
      submitted_at: item.created_at,
      title: `Leave request: ${item.start_date} to ${item.end_date}`,
      description: item.reason || 'No reason provided.',
      employee_name: item.user?.name || 'Unknown',
      employee_email: item.user?.email || '',
      status: item.status,
      onApprove: async () => {
        await leaveApi.approve(item.id);
      },
      onReject: async () => {
        await leaveApi.reject(item.id);
      },
    }));

    const timeEditItems = reviewableTimeEditRequests.map((item) => ({
      kind: 'time_edit' as const,
      id: item.id,
      submitted_at: item.created_at,
      title: `Time edit request: ${item.attendance_date}`,
      description: `${formatDuration(Number(item.extra_seconds || 0))} requested${item.message ? ` - ${item.message}` : ''}`,
      employee_name: item.user?.name || 'Unknown',
      employee_email: item.user?.email || '',
      status: item.status,
      onApprove: async () => {
        await attendanceTimeEditApi.approve(item.id);
      },
      onReject: async () => {
        await attendanceTimeEditApi.reject(item.id);
      },
    }));

    return [...leaveItems, ...timeEditItems].sort((a, b) => +new Date(b.submitted_at) - +new Date(a.submitted_at));
  }, [leaveRequests, timeEditRequests, user]);

  const reviewableLeaveCount = useMemo(
    () => leaveRequests.filter((item) => canReviewApprovalRequest(user, item.user)).length,
    [leaveRequests, user]
  );
  const reviewableTimeEditCount = useMemo(
    () => timeEditRequests.filter((item) => canReviewApprovalRequest(user, item.user)).length,
    [timeEditRequests, user]
  );

  const filteredItems = items.filter((item) => activeFilter === 'all' || item.kind === activeFilter);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations workflow"
        title="Approval Inbox"
        description="Review pending leave and attendance adjustment requests from one focused queue."
        actions={<Button onClick={load} variant="secondary">Refresh Inbox</Button>}
      />

      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard label="Pending Total" value={items.length} icon={Inbox} accent="sky" />
        <MetricCard label="Leave Requests" value={reviewableLeaveCount} icon={Clock3} accent="amber" />
        <MetricCard label="Time Edits" value={reviewableTimeEditCount} icon={CheckCircle2} accent="emerald" />
      </div>

      <SurfaceCard className="p-4">
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'all', label: 'All requests' },
            { id: 'leave', label: 'Leave only' },
            { id: 'time_edit', label: 'Time edits only' },
          ].map((filter) => (
            <button
              key={filter.id}
              onClick={() => setActiveFilter(filter.id as 'all' | 'leave' | 'time_edit')}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${
                activeFilter === filter.id ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </SurfaceCard>

      {isLoading ? (
        <PageLoadingState label="Loading approval inbox..." />
      ) : filteredItems.length === 0 ? (
        <PageEmptyState
          title="Inbox is clear"
          description="No pending approvals match the current filter."
        />
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => (
            <SurfaceCard key={`${item.kind}-${item.id}`} className="p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      item.kind === 'leave' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      {item.kind === 'leave' ? 'Leave' : 'Time Edit'}
                    </span>
                    <span className="text-xs text-slate-500">
                      Submitted {new Date(item.submitted_at).toLocaleString()}
                    </span>
                  </div>
                  <h2 className="text-lg font-semibold text-slate-950">{item.title}</h2>
                  <p className="text-sm text-slate-600">{item.employee_name} - {item.employee_email}</p>
                  <p className="text-sm text-slate-600">{item.description}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    className="bg-emerald-600 shadow-sm hover:bg-emerald-700"
                    onClick={() => handleAction(item.onApprove, `${item.employee_name}'s request approved.`)}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => handleAction(item.onReject, `${item.employee_name}'s request rejected.`)}
                  >
                    <XCircle className="h-4 w-4" />
                    Reject
                  </Button>
                </div>
              </div>
            </SurfaceCard>
          ))}
        </div>
      )}
    </div>
  );
}
