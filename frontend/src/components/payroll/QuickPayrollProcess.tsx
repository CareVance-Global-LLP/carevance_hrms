import { useState } from 'react';
import {
  Zap,
  ClipboardCheck,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Users,
  DollarSign,
  ArrowRight,
  Clock,
  RefreshCw,
  Play,
  ChevronDown,
  ChevronUp,
  GitCompare,
  UserPlus,
  UserMinus,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';

interface QuickPayrollProcessProps {
  monthYear: string;
  onComplete: (run: any) => void;
  onClose: () => void;
}

type Step = 'idle' | 'validating' | 'detecting' | 'ready' | 'processing' | 'success' | 'error';

interface ValidationCheck {
  name: string;
  passed: boolean;
  value: any;
}

export default function QuickPayrollProcess({ monthYear, onComplete, onClose }: QuickPayrollProcessProps) {
  const [step, setStep] = useState<Step>('idle');
  const [showDetails, setShowDetails] = useState(false);
  const [changes, setChanges] = useState<Record<string, any>>({});
  const [validation, setValidation] = useState<ValidationCheck[]>([]);
  const [diffData, setDiffData] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [result, setResult] = useState<any>(null);

  const quickValidate = useMutation({
    mutationFn: () => payrollApi.quickValidatePayroll(monthYear).then(r => r.data),
    onSuccess: (data) => {
      setValidation(data.checks ? Object.values(data.checks) : []);
    },
  });

  const detectChanges = useMutation({
    mutationFn: () => payrollApi.detectPayrollChanges(monthYear).then(r => r.data),
    onSuccess: (data) => {
      setChanges(data.changes || {});
    },
  });

  const getDiff = useMutation({
    mutationFn: () => payrollApi.getPayrollDiff(monthYear).then(r => r.data),
    onSuccess: (data) => {
      if (data.has_prev) setDiffData(data);
    },
  });

  const quickProcess = useMutation({
    mutationFn: () => payrollApi.quickProcessPayroll(monthYear).then(r => r.data),
    onSuccess: (data) => {
      setResult(data.run);
      setStep('success');
      onComplete(data.run);
    },
    onError: (err: any) => {
      setErrorMessage(err?.response?.data?.message || err?.message || 'Processing failed');
      setStep('error');
    },
  });

  const handlePreRun = async () => {
    setStep('validating');
    setShowDetails(true);
    setErrorMessage('');

    try {
      await Promise.all([
        quickValidate.mutateAsync(),
        detectChanges.mutateAsync(),
        getDiff.mutateAsync(),
      ]);
      setStep('ready');
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.message || 'Pre-run checks failed');
      setStep('error');
    }
  };

  const handleQuickProcess = () => {
    setStep('processing');
    quickProcess.mutate();
  };

  const allChecksPassed = validation.length === 0 || validation.every(c => c.passed);
  const hasChanges = Object.keys(changes).length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Quick Payroll Process</h2>
          <p className="text-sm text-slate-500">{monthYear}</p>
        </div>
        <div className="flex items-center gap-2">
          {step === 'idle' && (
            <>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                iconLeft={<Zap className="h-4 w-4" />}
                onClick={handlePreRun}
              >
                Auto-Detect & Validate
              </Button>
            </>
          )}
          {(step === 'processing' || step === 'success') && (
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          )}
          {step === 'error' && (
            <Button variant="ghost" onClick={() => { setStep('idle'); setErrorMessage(''); }}>
              Try Again
            </Button>
          )}
        </div>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-2 text-sm">
        {[
          { key: 'validating', label: 'Validate', icon: ClipboardCheck },
          { key: 'detecting', label: 'Detect Changes', icon: GitCompare },
          { key: 'processing', label: 'Process', icon: Play },
          { key: 'success', label: 'Complete', icon: CheckCircle2 },
        ].map((s, i) => {
          const stepOrder = ['idle', 'validating', 'detecting', 'ready', 'processing', 'success', 'error'];
          const currentIdx = stepOrder.indexOf(step);
          const itemIdx = stepOrder.indexOf(s.key);
          const isDone = currentIdx > itemIdx;
          const isActive = currentIdx === itemIdx || (s.key === 'validating' && step === 'ready');

          return (
            <div key={s.key} className="flex items-center gap-2">
              {i > 0 && <div className={`h-px w-8 ${isDone ? 'bg-blue-500' : 'bg-slate-200'}`} />}
              <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${
                isDone ? 'bg-emerald-50 text-emerald-700' :
                isActive ? 'bg-blue-50 text-blue-700' :
                'bg-slate-50 text-slate-400'
              }`}>
                {isDone ? <CheckCircle2 className="h-3 w-3" /> : <s.icon className="h-3 w-3" />}
                {s.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* Loader */}
      {(step === 'validating' || step === 'processing') && (
        <SurfaceCard className="p-8 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-700">
            {step === 'validating' ? 'Running pre-validations...' : 'Processing payroll...'}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Auto-syncing attendance, leave, reimbursements, and calculating salaries
          </p>
        </SurfaceCard>
      )}

      {/* Validation Results */}
      {step === 'ready' && validation.length > 0 && (
        <SurfaceCard className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-900">Pre-Run Validation</h3>
            {allChecksPassed ? (
              <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" /> All checks passed
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                <AlertTriangle className="h-3.5 w-3.5" /> {validation.filter(c => !c.passed).length} issue(s)
              </span>
            )}
          </div>
          <div className="space-y-1.5">
            {validation.map((check, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-slate-50">
                <span className="text-sm text-slate-700">{check.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">{String(check.value)}</span>
                  {check.passed ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-amber-500" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </SurfaceCard>
      )}

      {/* Detected Changes */}
      {step === 'ready' && hasChanges && (
        <SurfaceCard className="p-5 border-amber-200">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center justify-between w-full"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <h3 className="text-sm font-semibold text-slate-900">Changes Detected</h3>
            </div>
            {showDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showDetails && (
            <div className="mt-3 space-y-2">
              {changes.new_joiners && changes.new_joiners.length > 0 && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <UserPlus className="h-4 w-4 text-emerald-500" />
                  <span>{changes.new_joiners.length} new joiner(s): {changes.new_joiners.join(', ')}</span>
                </div>
              )}
              {changes.exits && changes.exits.length > 0 && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <UserMinus className="h-4 w-4 text-rose-500" />
                  <span>{changes.exits.length} exit(s): {changes.exits.join(', ')}</span>
                </div>
              )}
              {changes.ctc_revisions && changes.ctc_revisions.length > 0 && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <TrendingUp className="h-4 w-4 text-blue-500" />
                  <span>{changes.ctc_revisions.length} CTC revision(s)</span>
                </div>
              )}
            </div>
          )}
        </SurfaceCard>
      )}

      {/* Payroll Diff */}
      {step === 'ready' && diffData && diffData.has_prev && (
        <SurfaceCard className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <GitCompare className="h-4 w-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-900">
              Month-over-Month Comparison
            </h3>
            <span className="text-xs text-slate-400">vs {diffData.prev_month}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Gross', value: diffData.diff.gross, prev: diffData.previous.total_gross },
              { label: 'Deductions', value: diffData.diff.deductions, prev: diffData.previous.total_deductions },
              { label: 'Net Pay', value: diffData.diff.net_pay, prev: diffData.previous.total_net_pay },
              { label: 'PF', value: diffData.diff.pf, prev: diffData.previous.total_pf },
            ].map((item, i) => {
              const isUp = item.value > 0;
              return (
                <div key={i} className="bg-slate-50 rounded-lg p-3">
                  <p className="text-xs text-slate-500">{item.label}</p>
                  <p className={`text-sm font-semibold ${isUp ? 'text-emerald-600' : item.value < 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                    {isUp ? '+' : ''}{item.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-xs text-slate-400">Prev: ₹{item.prev.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
                </div>
              );
            })}
          </div>
        </SurfaceCard>
      )}

      {/* Ready to Process */}
      {step === 'ready' && (
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            iconLeft={<Zap className="h-4 w-4" />}
            onClick={handleQuickProcess}
            disabled={!allChecksPassed}
            title={!allChecksPassed ? 'Fix validation issues first' : undefined}
          >
            {allChecksPassed ? 'Quick Process Payroll' : 'Issues Blocking Process'}
          </Button>
        </div>
      )}

      {/* Success */}
      {step === 'success' && result && (
        <SurfaceCard className="p-6 text-center border-emerald-200">
          <div className="h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="h-6 w-6 text-emerald-600" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-1">Payroll Processed Successfully</h3>
          <p className="text-sm text-slate-500 mb-4">{result.total_employees || 0} employees processed</p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-xl mx-auto">
            <div className="bg-slate-50 rounded-lg p-3">
              <Wallet className="h-4 w-4 text-slate-400 mx-auto mb-1" />
              <p className="text-xs text-slate-500">Gross</p>
              <p className="text-sm font-semibold">₹{(result.total_gross || 0).toLocaleString('en-IN')}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <DollarSign className="h-4 w-4 text-slate-400 mx-auto mb-1" />
              <p className="text-xs text-slate-500">Net Pay</p>
              <p className="text-sm font-semibold">₹{(result.total_net_pay || 0).toLocaleString('en-IN')}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <ArrowRight className="h-4 w-4 text-slate-400 mx-auto mb-1" />
              <p className="text-xs text-slate-500">Deductions</p>
              <p className="text-sm font-semibold">₹{(result.total_deductions || 0).toLocaleString('en-IN')}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <Users className="h-4 w-4 text-slate-400 mx-auto mb-1" />
              <p className="text-xs text-slate-500">Employees</p>
              <p className="text-sm font-semibold">{result.total_employees || 0}</p>
            </div>
          </div>
        </SurfaceCard>
      )}

      {/* Error */}
      {step === 'error' && (
        <SurfaceCard className="p-6 text-center border-rose-200">
          <div className="h-12 w-12 rounded-full bg-rose-100 flex items-center justify-center mx-auto mb-3">
            <AlertCircle className="h-6 w-6 text-rose-600" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-1">Processing Failed</h3>
          <p className="text-sm text-slate-500 mb-4">{errorMessage}</p>
          <div className="flex items-center justify-center gap-3">
            <Button variant="secondary" onClick={() => { setStep('idle'); setErrorMessage(''); }}>
              <RefreshCw className="h-4 w-4 mr-1.5" /> Retry
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </SurfaceCard>
      )}
    </div>
  );
}
