import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { resignationApi } from '@/services/api';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { PageLoadingState, PageEmptyState } from '@/components/ui/PageState';
import { CheckCircle2, Clock, AlertTriangle, Calendar, ArrowRight } from 'lucide-react';
import { hasAdminAccess } from '@/lib/permissions';
import { Navigate } from 'react-router-dom';

interface ResignationHistoryItem {
  id: number;
  last_working_date: string;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  submitted_at: string;
  approved_at?: string;
  rejected_at?: string;
  cancelled_at?: string;
}

export default function ResignationHistoryPage() {
  const { user } = useAuth();
  const [resignations, setResignations] = useState<ResignationHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Redirect admin users - they don't need this
  if (hasAdminAccess(user)) {
    return <Navigate to="/dashboard" replace />;
  }

  useEffect(() => {
    const loadResignationHistory = async () => {
      try {
        // Get resignation history
        const response = await resignationApi.getMyResignationHistory();
        const data = response.data as any;
        if (data && Array.isArray(data.resignations)) {
          setResignations(data.resignations);
        }
      } catch {
        setResignations([]);
      } finally {
        setIsLoading(false);
      }
    };

    void loadResignationHistory();
  }, []);

  if (isLoading) {
    return <PageLoadingState label="Loading resignation history..." />;
  }

  if (resignations.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50/50 pb-8">
        <PageHeader
          title="Resignation History"
          description="View your resignation request history"
        />

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <SurfaceCard className="p-6">
            <PageEmptyState
              title="No Resignation History"
              description="You haven't submitted any resignation requests yet."
            />
          </SurfaceCard>
        </div>
      </div>
    );
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'approved':
        return <CheckCircle2 className="h-5 w-5 text-emerald-600" />;
      case 'rejected':
        return <AlertTriangle className="h-5 w-5 text-rose-600" />;
      case 'cancelled':
        return <AlertTriangle className="h-5 w-5 text-slate-600" />;
      case 'pending':
      default:
        return <Clock className="h-5 w-5 text-amber-600" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved':
        return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'rejected':
        return 'bg-rose-100 text-rose-700 border-rose-200';
      case 'cancelled':
        return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'pending':
      default:
        return 'bg-amber-100 text-amber-700 border-amber-200';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'approved':
        return 'Approved';
      case 'rejected':
        return 'Rejected';
      case 'cancelled':
        return 'Cancelled';
      case 'pending':
      default:
        return 'Pending';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/50 pb-8">
      <PageHeader
        title="Resignation History"
        description="View all your resignation requests"
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SurfaceCard className="p-0 overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Resignation Requests ({resignations.length})
            </h3>
          </div>

          <div className="divide-y divide-slate-200">
            {resignations.map((resignation) => (
              <div
                key={resignation.id}
                className="flex items-center justify-between p-4 hover:bg-slate-50/50"
              >
                <div className="flex items-start gap-4">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full border ${getStatusColor(resignation.status)}`}>
                    {getStatusIcon(resignation.status)}
                  </div>
                  
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      Resignation Request #{resignation.id}
                    </p>
                    <div className="mt-1 flex items-center gap-4 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        Last Day: {resignation.last_working_date}
                      </span>
                      <span className="flex items-center gap-1">
                        <ArrowRight className="h-3 w-3" />
                        Submitted: {new Date(resignation.submitted_at).toLocaleDateString()}
                      </span>
                    </div>
                    {resignation.reason && (
                      <p className="mt-1 text-xs text-slate-600 line-clamp-1">
                        Reason: {resignation.reason}
                      </p>
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${getStatusColor(resignation.status)}`}>
                    {getStatusText(resignation.status)}
                  </span>
                  <p className="mt-1 text-xs text-slate-500">
                    {resignation.status === 'approved' && resignation.approved_at && (
                      <>Approved on {new Date(resignation.approved_at).toLocaleDateString()}</>
                    )}
                    {resignation.status === 'rejected' && resignation.rejected_at && (
                      <>Rejected on {new Date(resignation.rejected_at).toLocaleDateString()}</>
                    )}
                    {resignation.status === 'cancelled' && resignation.cancelled_at && (
                      <>Cancelled on {new Date(resignation.cancelled_at).toLocaleDateString()}</>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
}
