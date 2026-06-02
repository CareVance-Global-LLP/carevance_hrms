import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { leaveApi, attendanceTimeEditApi, resignationApi } from '@/services/api';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { Calendar, Clock, UserMinus, ArrowRight, AlertCircle, CheckCircle2, FileText } from 'lucide-react';

interface PendingCounts {
  leave: number;
  timeEdit: number;
  resignation: number;
}

export default function PendingApprovalsCard() {
  const navigate = useNavigate();

  const { data: pendingCounts, isLoading } = useQuery<PendingCounts>({
    queryKey: ['pending-approvals', 'counts'],
    queryFn: async () => {
      const [leaveRes, timeEditRes, resignationRes] = await Promise.all([
        leaveApi.list({ status: 'pending', limit: 100 }),
        attendanceTimeEditApi.list({ status: 'pending' }),
        resignationApi.list({ status: 'pending' })
      ]);

      return {
        leave: leaveRes.data.data?.length || 0,
        timeEdit: timeEditRes.data.data?.length || 0,
        resignation: resignationRes.data.data?.length || 0
      };
    },
    refetchInterval: 30000,
  });

  const totalPending = (pendingCounts?.leave || 0) + (pendingCounts?.timeEdit || 0) + (pendingCounts?.resignation || 0);

  const approvalItems = [
    {
      icon: Calendar,
      label: 'Leave Requests',
      count: pendingCounts?.leave || 0,
      description: 'Pending approval from your team',
      color: 'blue',
      link: '/approval-inbox?section=leave'
    },
    {
      icon: Clock,
      label: 'Time Edit Requests',
      count: pendingCounts?.timeEdit || 0,
      description: 'Attendance time adjustments',
      color: 'amber',
      link: '/approval-inbox?section=time-edit'
    },
    {
      icon: UserMinus,
      label: 'Resignations',
      count: pendingCounts?.resignation || 0,
      description: 'Employee resignation requests',
      color: 'rose',
      link: '/approval-inbox?section=resignation'
    }
  ];

  if (isLoading) {
    return (
      <SurfaceCard className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-900">Pending Approvals</h3>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse flex items-center gap-4 p-3 rounded-lg bg-slate-50">
              <div className="w-10 h-10 rounded-full bg-slate-200"></div>
              <div className="flex-1">
                <div className="h-4 w-32 bg-slate-200 rounded mb-2"></div>
                <div className="h-3 w-48 bg-slate-200 rounded"></div>
              </div>
            </div>
          ))}
        </div>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard className="p-6 hover:shadow-lg transition-shadow">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <div className="relative">
            <FileText className="h-5 w-5 text-blue-600" />
            {totalPending > 0 && (
              <span className="absolute -top-1 -right-1 h-2.5 w-2.5 bg-red-500 rounded-full animate-pulse"></span>
            )}
          </div>
          <h3 className="text-lg font-semibold text-slate-900">Pending Approvals</h3>
        </div>
        <button
          onClick={() => navigate('/approval-inbox')}
          className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
        >
          View All
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3">
        {approvalItems.map((item) => {
          const Icon = item.icon;
          const hasItems = item.count > 0;
          
          return (
            <div
              key={item.label}
              onClick={() => navigate(item.link)}
              className={`group flex items-center gap-4 p-3 rounded-lg cursor-pointer transition-all ${
                hasItems 
                  ? 'bg-white border border-slate-200 hover:border-blue-300 hover:shadow-sm' 
                  : 'bg-slate-50/50 border border-transparent'
              }`}
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                item.color === 'blue' ? 'bg-blue-100 text-blue-600' :
                item.color === 'amber' ? 'bg-amber-100 text-amber-600' :
                'bg-rose-100 text-rose-600'
              }`}>
                <Icon className="h-5 w-5" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className={`font-medium ${hasItems ? 'text-slate-900' : 'text-slate-500'}`}>
                    {item.label}
                  </p>
                  {hasItems ? (
                    <span className="text-lg font-bold text-slate-900">
                      {item.count}
                    </span>
                  ) : (
                    <span className="text-sm text-slate-400">—</span>
                  )}
                </div>
                <p className={`text-sm truncate ${hasItems ? 'text-slate-500' : 'text-slate-400'}`}>
                  {hasItems ? item.description : 'No pending requests'}
                </p>
              </div>

              {hasItems && (
                <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-blue-500 transition-colors" />
              )}
            </div>
          );
        })}
      </div>

      {totalPending > 0 ? (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="flex items-center gap-2 text-sm">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            <span className="text-slate-600">
              <strong>{totalPending}</strong> total request{totalPending !== 1 ? 's' : ''} awaiting your action
            </span>
          </div>
        </div>
      ) : (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <span className="text-slate-500">All caught up! No pending approvals.</span>
          </div>
        </div>
      )}
    </SurfaceCard>
  );
}
