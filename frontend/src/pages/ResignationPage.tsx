import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { resignationApi } from '@/services/api';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import Button from '@/components/ui/Button';
import { FeedbackBanner } from '@/components/ui/PageState';
import { FieldLabel, TextInput, TextareaInput } from '@/components/ui/FormField';
import { AlertTriangle, UserMinus, CheckCircle2, Clock } from 'lucide-react';
import { hasAdminAccess } from '@/lib/permissions';
import { Navigate } from 'react-router-dom';

export default function ResignationPage() {
  const { user } = useAuth();
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [resignationReason, setResignationReason] = useState('');
  const [resignationLastDate, setResignationLastDate] = useState('');
  const [isSubmittingResignation, setIsSubmittingResignation] = useState(false);
  const [resignationStatus, setResignationStatus] = useState<'none' | 'pending' | 'approved' | 'rejected'>('none');
  const [showResignationConfirm, setShowResignationConfirm] = useState(false);

  // Redirect admin users - they don't need resignation
  if (hasAdminAccess(user)) {
    return <Navigate to="/dashboard" replace />;
  }

  // Load user's resignation status on mount
  useEffect(() => {
    const loadResignationStatus = async () => {
      try {
        const response = await resignationApi.getMyResignation();
        const data = response.data as any;
        if (data && data.resignation) {
          setResignationStatus(data.resignation.status || 'none');
          setResignationLastDate(data.resignation.last_working_date || '');
          setResignationReason(data.resignation.reason || '');
        }
      } catch {
        // No active resignation found, keep status as 'none'
        setResignationStatus('none');
      }
    };

    void loadResignationStatus();
  }, []);

  const submitResignation = async () => {
    setFeedback(null);
    setIsSubmittingResignation(true);

    try {
      await resignationApi.submit({
        last_working_date: resignationLastDate,
        reason: resignationReason,
      });

      setResignationStatus('pending');
      setShowResignationConfirm(false);
      setFeedback({ tone: 'success', message: 'Your resignation has been submitted successfully. HR will contact you shortly.' });
    } catch (e: any) {
      setFeedback({ tone: 'error', message: e?.response?.data?.message || 'Failed to submit resignation. Please try again.' });
    } finally {
      setIsSubmittingResignation(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/50 pb-8">
      <PageHeader
        title="Submit Resignation"
        description="Submit your resignation request to HR and your manager"
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SurfaceCard className="p-6">
          {feedback && <FeedbackBanner tone={feedback.tone} message={feedback.message} className="mb-6" />}

          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 mb-6">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
            <div>
              <h2 className="text-lg font-semibold text-amber-900">Submit Resignation</h2>
              <p className="mt-1 text-sm text-amber-700">
                Use this form to submit your resignation. Your manager and HR will be notified.
                The standard notice period is 30 days unless otherwise specified in your contract.
              </p>
            </div>
          </div>

          {resignationStatus === 'none' && (
            <div className="space-y-4">
              <div>
                <FieldLabel>Last Working Date</FieldLabel>
                <TextInput
                  type="date"
                  value={resignationLastDate}
                  onChange={(e) => setResignationLastDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Select your intended last working day. This should align with your notice period.
                </p>
              </div>

              <div>
                <FieldLabel>Reason for Resignation</FieldLabel>
                <TextareaInput
                  value={resignationReason}
                  onChange={(e) => setResignationReason(e.target.value)}
                  placeholder="Please provide your reason for leaving (optional)"
                  rows={4}
                  maxLength={1000}
                />
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h4 className="text-sm font-semibold text-slate-900">Important Notes:</h4>
                <ul className="mt-2 list-inside list-disc text-sm text-slate-600 space-y-1">
                  <li>Your resignation request will be sent to your reporting manager and HR team.</li>
                  <li>You may be required to complete a handover process before your last day.</li>
                  <li>Exit formalities and clearance will be coordinated by HR.</li>
                  <li>You can track the status of your resignation on this page.</li>
                </ul>
              </div>

              <Button
                onClick={() => setShowResignationConfirm(true)}
                disabled={!resignationLastDate || isSubmittingResignation}
              >
                {isSubmittingResignation ? 'Submitting...' : 'Submit Resignation'}
              </Button>
            </div>
          )}

          {resignationStatus === 'pending' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center">
              <UserMinus className="mx-auto h-12 w-12 text-amber-600" />
              <h3 className="mt-4 text-lg font-semibold text-amber-900">Resignation Submitted</h3>
              <p className="mt-2 text-sm text-amber-700">
                Your resignation request is pending approval. HR will contact you shortly to discuss next steps.
              </p>
              <div className="mt-4 rounded-lg border border-amber-200 bg-white p-4 text-left max-w-md mx-auto">
                <p className="text-sm"><strong>Last Working Date:</strong> {resignationLastDate}</p>
                <p className="mt-1 text-sm"><strong>Status:</strong> <span className="text-amber-600">Pending Approval</span></p>
              </div>
            </div>
          )}

          {resignationStatus === 'approved' && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
              <h3 className="mt-4 text-lg font-semibold text-emerald-900">Resignation Approved</h3>
              <p className="mt-2 text-sm text-emerald-700">
                Your resignation has been approved. Please coordinate with HR for exit formalities.
              </p>
              <div className="mt-4 rounded-lg border border-emerald-200 bg-white p-4 text-left max-w-md mx-auto">
                <p className="text-sm"><strong>Last Working Date:</strong> {resignationLastDate}</p>
                <p className="mt-1 text-sm"><strong>Status:</strong> <span className="text-emerald-600">Approved</span></p>
              </div>
            </div>
          )}

          {resignationStatus === 'rejected' && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-center">
              <Clock className="mx-auto h-12 w-12 text-rose-600" />
              <h3 className="mt-4 text-lg font-semibold text-rose-900">Resignation Rejected</h3>
              <p className="mt-2 text-sm text-rose-700">
                Your resignation request has been rejected. Please contact HR for more information.
              </p>
            </div>
          )}

          {showResignationConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <SurfaceCard className="w-full max-w-md p-6">
                <h3 className="text-lg font-semibold text-slate-900">Confirm Resignation</h3>
                <p className="mt-2 text-sm text-slate-600">
                  Are you sure you want to submit your resignation? This action cannot be undone.
                </p>
                <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
                  <p><strong>Last Working Date:</strong> {resignationLastDate}</p>
                  {resignationReason && <p className="mt-1"><strong>Reason:</strong> {resignationReason}</p>}
                </div>
                <div className="mt-6 flex gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => setShowResignationConfirm(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={submitResignation}
                    disabled={isSubmittingResignation}
                  >
                    {isSubmittingResignation ? 'Submitting...' : 'Confirm Resignation'}
                  </Button>
                </div>
              </SurfaceCard>
            </div>
          )}
        </SurfaceCard>
      </div>
    </div>
  );
}
