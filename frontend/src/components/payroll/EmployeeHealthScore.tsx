import { Heart, AlertCircle, ChevronRight } from 'lucide-react';
import Button from '@/components/ui/Button';

interface HealthMetric {
  name: string;
  key: string;
  completed: number;
  total: number;
  percentage: number;
}

interface EmployeeHealthScoreProps {
  data: {
    overall_score: number;
    total_employees: number;
    metrics: HealthMetric[];
    status: 'excellent' | 'good' | 'fair' | 'poor';
  } | null;
  loading?: boolean;
  onViewDetails?: () => void;
  onFixRecords?: () => void;
}

const statusConfig = {
  excellent: { 
    color: 'text-emerald-600', 
    bg: 'bg-emerald-50', 
    border: 'border-emerald-200'
  },
  good: { 
    color: 'text-blue-600', 
    bg: 'bg-blue-50', 
    border: 'border-blue-200'
  },
  fair: { 
    color: 'text-amber-600', 
    bg: 'bg-amber-50', 
    border: 'border-amber-200'
  },
  poor: { 
    color: 'text-rose-600', 
    bg: 'bg-rose-50', 
    border: 'border-rose-200'
  },
};

export default function EmployeeHealthScore({
  data,
  loading = false,
  onViewDetails,
  onFixRecords
}: EmployeeHealthScoreProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl p-5 border border-slate-200 animate-pulse">
        <div className="h-4 w-32 bg-slate-200 rounded mb-4"></div>
        <div className="h-32 bg-slate-100 rounded-lg"></div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-white rounded-xl p-5 border border-slate-200">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-1.5 bg-slate-100 rounded-lg">
            <Heart className="h-4 w-4 text-slate-600" />
          </div>
          <h3 className="text-base font-semibold text-slate-900">Data Health</h3>
        </div>
        <p className="text-sm text-slate-500 text-center py-4">No data available</p>
      </div>
    );
  }

  const status = statusConfig[data.status];
  const topMetrics = data.metrics.slice(0, 3);

  return (
    <div className="bg-white rounded-xl p-5 border border-slate-200">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg ${status.bg}`}>
            <Heart className={`h-4 w-4 ${status.color}`} />
          </div>
          <h3 className="text-base font-semibold text-slate-900">Data Health</h3>
        </div>
        <button 
          onClick={onViewDetails || (() => alert('Employee health details coming soon'))}
          className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
        >
          Details
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>

      <div className={`p-4 rounded-lg ${status.bg} ${status.border} border mb-4`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-600 mb-0.5">Overall Score</p>
            <div className="flex items-baseline gap-1">
              <span className={`text-2xl font-bold ${status.color}`}>
                {data.overall_score}%
              </span>
              <span className="text-xs text-slate-500">complete</span>
            </div>
          </div>
          
          <div className="relative w-14 h-14">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
              <path
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="#e2e8f0"
                strokeWidth="4"
              />
              <path
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="currentColor"
                strokeWidth="4"
                strokeDasharray={`${data.overall_score}, 100`}
                className={status.color}
              />
            </svg>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {topMetrics.map((metric) => (
          <div key={metric.key}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-600">{metric.name}</span>
              <span className={`text-xs font-medium ${
                metric.percentage >= 90 ? 'text-emerald-600' :
                metric.percentage >= 70 ? 'text-blue-600' :
                metric.percentage >= 50 ? 'text-amber-600' : 'text-rose-600'
              }`}>
                {metric.percentage}%
              </span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-300 ${
                  metric.percentage >= 90 ? 'bg-emerald-500' :
                  metric.percentage >= 70 ? 'bg-blue-500' :
                  metric.percentage >= 50 ? 'bg-amber-500' : 'bg-rose-500'
                }`}
                style={{ width: `${metric.percentage}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {data.metrics.some(m => m.percentage < 100) && (
        <Button 
          variant="secondary" 
          size="sm"
          className="w-full mt-4"
          iconLeft={<AlertCircle className="h-3.5 w-3.5" />}
          onClick={onFixRecords || (() => alert('Fix incomplete records feature coming soon'))}
        >
          Fix Incomplete Records
        </Button>
      )}
    </div>
  );
}
