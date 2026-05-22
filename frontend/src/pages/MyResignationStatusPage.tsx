import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { resignationApi } from '@/services/api';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { PageLoadingState, PageEmptyState } from '@/components/ui/PageState';
import { Calendar, CheckCircle2, Clock, AlertTriangle, ArrowRight, History } from 'lucide-react';
import { hasAdminAccess } from '@/lib/permissions';
import { Navigate } from 'react-router-dom';

interface ResignationData {
  id: number;
  last_working_date: string;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  submitted_at: string;
  approved_at?: string;
  approved_by?: string;
  rejected_at?: string;
  rejection_reason?: string;
  cancelled_at?: string;
}

export default function MyResignationStatusPage() {
  const { user } = useAuth();
  const [currentResignation, setCurrentResignation] = useState<ResignationData | null>(null);
  const [resignationHistory, setResignationHistory] = useState<ResignationData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'current' | 'history'>('current');

  // Redirect admin users - they don't need this
  if (hasAdminAccess(user)) {
    return <Navigate to="/dashboard" replace />;
  }

  useEffect(() => {
    const loadResignationData = async () => {
      try {
        // Load current resignation
        const currentResponse = await resignationApi.getMyResignation();
        const currentData = currentResponse.data as any;
        if (currentData && currentData.resignation) {
          setCurrentResignation(currentData.resignation);
        }

        // Load resignation history
        const historyResponse = await resignationApi.getMyResignationHistory();
        const historyData = historyResponse.data as any;
        if (historyData && Array.isArray(historyData.resignations)) {
          setResignationHistory(historyData.resignations);
        }
      } catch {
        // No data found
        setCurrentResignation(null);
        setResignationHistory([]);
      } finally {
        setIsLoading(false);
      }
    };

    void loadResignationData();
  }, []);

  if (isLoading) {
    return <PageLoadingState label="Loading resignation data..." />;
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
        return 'Pending Approval';
    }
  };

  const hasAnyResignations = currentResignation || resignationHistory.length > 0;

  if (!hasAnyResignations) {
    return (
      <div className="min-h-screen bg-slate-50/50 pb-8">
        <PageHeader
          title="My Resignation"
          description="View your resignation status and history"
        />

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <SurfaceCard className="p-6">
            <PageEmptyState
              title="No Resignation Found"
              description="You haven't submitted a resignation request yet."
            />
          </SurfaceCard>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/50 pb-8">
      <PageHeader
        title="My Resignation"
        description="View your resignation status and history"
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Tabs */}
        <div className="mb-6 flex border-b border-slate-200">
          <button
            onClick={() => setActiveTab('current')}
            className={`px-4 py-2 text-sm font-medium transition ${
              activeTab === 'current'
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Current Status
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 text-sm font-medium transition ${
              activeTab === 'history'
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            History ({resignationHistory.length})
          </button>
        </div>

        <SurfaceCard className="p-6">
          {activeTab === 'current' && (
            <>
              {currentResignation ? (
                <>
                  <div className={`rounded-lg border p-8 text-center ${getStatusColor(currentResignation.status)}`}>
                    <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-white">
                      {getStatusIcon(currentResignation.status)}
                    </div>
                    <h2 className="text-2xl font-bold">{getStatusText(currentResignation.status)}</h2>
                    <p className="mt-2 text-sm opacity-80">
                      Your resignation request is currently <strong>{getStatusText(currentResignation.status).toLowerCase()}</strong>
                    </p>
                  </div>

                  <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center gap-2 text-slate-600">
                        <Calendar className="h-4 w-4" />
                        <span className="text-sm font-medium">Last Working Date</span>
                      </div>
                      <p className="mt-2 text-lg font-semibold text-slate-900">
                        {currentResignation.last_working_date}
                      </p>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center gap-2 text-slate-600">
                        <Clock className="h-4 w-4" />
                        <span className="text-sm font-medium">Submitted On</span>
                      </div>
                      <p className="mt-2 text-lg font-semibold text-slate-900">
                        {new Date(currentResignation.submitted_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  {currentResignation.reason && (
                    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <p className="text-sm font-medium text-slate-600">Reason for Resignation</p>
                      <p className="mt-2 text-slate-900">{currentResignation.reason}</p>
                    </div>
                  )}

                  {currentResignation.status === 'approved' && currentResignation.approved_by && (
                    <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                      <p className="text-sm font-medium text-emerald-700">Approved By</p>
                      <p className="mt-1 text-emerald-900">{currentResignation.approved_by}</p>
                      {currentResignation.approved_at && (
                        <p className="mt-1 text-sm text-emerald-600">
                          On {new Date(currentResignation.approved_at).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  )}

                  {currentResignation.status === 'rejected' && currentResignation.rejection_reason && (
                    <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4">
                      <p className="text-sm font-medium text-rose-700">Rejection Reason</p>
                      <p className="mt-1 text-rose-900">{currentResignation.rejection_reason}</p>
                    </div>
                  )}

                  {currentResignation.status === 'pending' && (
                    <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
                        <div>
                          <p className="font-medium text-amber-900">What happens next?</p>
                          <ul className="mt-2 list-inside list-disc text-sm text-amber-700">
                            <li>HR will review your resignation request</li>
                            <li>You may be contacted for an exit interview</li>
                            <li>Handover process will be coordinated</li>
                            <li>Exit formalities will be scheduled</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="py-12 text-center">
                  <Clock className="mx-auto h-12 w-12 text-slate-300" />
                  <h3 className="mt-4 text-lg font-medium text-slate-900">No Active Resignation</h3>
                  <p className="mt-2 text-sm text-slate-500">You don't have an active resignation request.</p>
                </div>
              )}
            </>
          )}

          {activeTab === 'history' && (
            <>
              {resignationHistory.length > 0 ? (
                <div className="divide-y divide-slate-200">
                  {resignationHistory.map((resignation) => (
                    <div
                      key={resignation.id}
                      className="flex items-center justify-between py-4 first:pt-0 last:pb-0"
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
                            <>Approved: {new Date(resignation.approved_at).toLocaleDateString()}</>
                          )}
                          {resignation.status === 'rejected' && resignation.rejected_at && (
                            <>Rejected: {new Date(resignation.rejected_at).toLocaleDateString()}</>
                          )}
                          {resignation.status === 'cancelled' && resignation.cancelled_at && (
                            <>Cancelled: {new Date(resignation.cancelled_at).toLocaleDateString()}</>
                          )}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center">
                  <History className="mx-auto h-12 w-12 text-slate-300" />
                  <h3 className="mt-4 text-lg font-medium text-slate-900">No History</h3>
                  <p className="mt-2 text-sm text-slate-500">You haven't submitted any resignation requests yet.</p>
                </div>
              )}
            </>
          )}
        </SurfaceCard>
      </div>
    </div>
  );
}
