import { 
  AlertCircle, 
  CheckCircle, 
  Info, 
  XCircle,
  X,
  ArrowRight,
  Users,
  FileText,
  DollarSign,
  Bell
} from 'lucide-react';
import Button from '@/components/ui/Button';

interface Alert {
  id: string;
  type: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  action: string;
  action_url: string;
  count: number;
}

interface ActionableAlertsPanelProps {
  alerts: Alert[] | null;
  onDismiss?: (alertId: string) => void;
  onAction?: (alert: Alert) => void;
  loading?: boolean;
}

const alertConfig: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
  critical: { 
    color: 'text-rose-600', 
    bg: 'bg-rose-50',
    icon: <XCircle className="h-5 w-5" />
  },
  warning: { 
    color: 'text-amber-600', 
    bg: 'bg-amber-50',
    icon: <AlertCircle className="h-5 w-5" />
  },
  info: { 
    color: 'text-blue-600', 
    bg: 'bg-blue-50',
    icon: <Info className="h-5 w-5" />
  },
};

export default function ActionableAlertsPanel({
  alerts,
  onDismiss,
  onAction,
  loading = false
}: ActionableAlertsPanelProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl p-6 border border-slate-200 animate-pulse">
        <div className="h-48 bg-slate-200 rounded-lg"></div>
      </div>
    );
  }

  if (!alerts || alerts.length === 0) {
    return (
      <div className="bg-white rounded-xl p-6 border border-slate-200">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-emerald-100 rounded-lg">
            <CheckCircle className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900">All Clear</h3>
            <p className="text-sm text-slate-500">No pending actions required</p>
          </div>
        </div>
        <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100">
          <p className="text-sm text-emerald-700 text-center">
            Great job! Your payroll is up to date and there are no pending tasks.
          </p>
        </div>
      </div>
    );
  }

  // Group alerts by type
  const groupedAlerts = alerts.reduce((acc, alert) => {
    if (!acc[alert.type]) acc[alert.type] = [];
    acc[alert.type].push(alert);
    return acc;
  }, {} as Record<string, Alert[]>);

  const handleAction = (alert: Alert) => {
    onAction?.(alert);
  };

  return (
    <div className="bg-white rounded-xl p-6 border border-slate-200">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-100 rounded-lg">
            <Bell className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Action Required</h3>
            <p className="text-sm text-slate-500">{alerts.length} pending task{alerts.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        
        {/* Summary badges */}
        <div className="flex items-center gap-2">
          {groupedAlerts.critical && (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-rose-100 text-rose-700">
              <XCircle className="h-3 w-3" />
              {groupedAlerts.critical.length} Critical
            </span>
          )}
          {groupedAlerts.warning && (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700">
              <AlertCircle className="h-3 w-3" />
              {groupedAlerts.warning.length} Warning
            </span>
          )}
        </div>
      </div>

      {/* Alerts List */}
      <div className="space-y-3">
        {alerts.map((alert) => {
          const config = alertConfig[alert.type];
          
          return (
            <div 
              key={alert.id}
              className={`p-4 rounded-lg border transition-colors ${
                alert.type === 'critical' 
                  ? 'bg-rose-50 border-rose-200' 
                  : alert.type === 'warning'
                    ? 'bg-amber-50 border-amber-200'
                    : 'bg-blue-50 border-blue-200'
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Icon */}
                <div className={`p-2 rounded-lg ${config.bg} ${config.color} flex-shrink-0`}>
                  {config.icon}
                </div>
                
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-medium text-slate-900">{alert.title}</h4>
                      <p className="text-sm text-slate-600 mt-0.5">{alert.message}</p>
                    </div>
                    
                    {/* Dismiss button */}
                    {onDismiss && (
                      <button 
                        onClick={() => onDismiss(alert.id)}
                        className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  
                  {/* Action Button */}
                  <div className="mt-3">
                    <Button 
                      variant={alert.type === 'critical' ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => handleAction(alert)}
                      iconRight={<ArrowRight className="h-4 w-4" />}
                    >
                      {alert.action}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary Footer */}
      <div className="mt-4 pt-4 border-t border-slate-200">
        <p className="text-xs text-slate-400 text-center">
          Complete these tasks to ensure smooth payroll processing
        </p>
      </div>
    </div>
  );
}
