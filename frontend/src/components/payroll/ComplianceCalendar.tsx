import { 
  Calendar, 
  AlertCircle, 
  Clock, 
  CheckCircle,
  FileText,
  ChevronRight
} from 'lucide-react';

interface ComplianceDeadline {
  id: string;
  title: string;
  date: string;
  type: 'pf' | 'esi' | 'pt' | 'tds' | 'other';
  description: string;
  urgency: 'overdue' | 'critical' | 'warning' | 'normal';
  urgency_label: string;
  days_remaining: number;
}

interface ComplianceCalendarProps {
  deadlines: ComplianceDeadline[] | null;
  loading?: boolean;
  onViewAll?: () => void;
  onViewDeadline?: (deadline: ComplianceDeadline) => void;
}

const typeConfig: Record<string, { label: string; color: string; bg: string; border: string }> = {
  pf: { 
    label: 'Provident Fund', 
    color: 'text-blue-700', 
    bg: 'bg-blue-50',
    border: 'border-blue-200'
  },
  esi: { 
    label: 'ESI', 
    color: 'text-violet-700', 
    bg: 'bg-violet-50',
    border: 'border-violet-200'
  },
  pt: { 
    label: 'Professional Tax', 
    color: 'text-amber-700', 
    bg: 'bg-amber-50',
    border: 'border-amber-200'
  },
  tds: { 
    label: 'TDS', 
    color: 'text-rose-700', 
    bg: 'bg-rose-50',
    border: 'border-rose-200'
  },
  other: { 
    label: 'Other', 
    color: 'text-slate-700', 
    bg: 'bg-slate-50',
    border: 'border-slate-200'
  },
};

const urgencyConfig: Record<string, { bg: string; text: string; border: string; icon: React.ReactNode }> = {
  overdue: { 
    bg: 'bg-rose-50', 
    text: 'text-rose-700',
    border: 'border-rose-200',
    icon: <AlertCircle className="h-3 w-3" />
  },
  critical: { 
    bg: 'bg-rose-50', 
    text: 'text-rose-600',
    border: 'border-rose-100',
    icon: <Clock className="h-3 w-3" />
  },
  warning: { 
    bg: 'bg-amber-50', 
    text: 'text-amber-600',
    border: 'border-amber-100',
    icon: <Clock className="h-3 w-3" />
  },
  normal: { 
    bg: 'bg-slate-50', 
    text: 'text-slate-600',
    border: 'border-slate-100',
    icon: <Calendar className="h-3 w-3" />
  },
};

export default function ComplianceCalendar({
  deadlines,
  loading = false,
  onViewAll,
  onViewDeadline
}: ComplianceCalendarProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl p-5 border border-slate-200 animate-pulse">
        <div className="h-4 w-32 bg-slate-200 rounded mb-4"></div>
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 bg-slate-100 rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  if (!deadlines || deadlines.length === 0) {
    return (
      <div className="bg-white rounded-xl p-5 border border-slate-200">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-1.5 bg-emerald-100 rounded-lg">
            <CheckCircle className="h-4 w-4 text-emerald-600" />
          </div>
          <h3 className="text-base font-semibold text-slate-900">Compliance Calendar</h3>
        </div>
        <div className="p-4 bg-slate-50 rounded-lg text-center">
          <Calendar className="h-8 w-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">No upcoming deadlines</p>
          <button
            onClick={() => alert('Compliance settings coming soon')}
            className="mt-3 text-xs text-blue-600 hover:text-blue-700 font-medium"
          >
            Configure deadlines
          </button>
        </div>
      </div>
    );
  }

  // Show only first 4 deadlines
  const visibleDeadlines = deadlines.slice(0, 4);

  return (
    <div className="bg-white rounded-xl p-5 border border-slate-200">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-blue-100 rounded-lg">
            <Calendar className="h-4 w-4 text-blue-600" />
          </div>
          <h3 className="text-base font-semibold text-slate-900">Compliance</h3>
        </div>
        <button 
          onClick={onViewAll || (() => alert('Full compliance calendar coming soon'))}
          className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
        >
          View All
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>

      {/* Deadlines List */}
      <div className="space-y-2">
        {visibleDeadlines.map((deadline) => {
          const typeConf = typeConfig[deadline.type] || typeConfig.other;
          const urgencyConf = urgencyConfig[deadline.urgency] || urgencyConfig.normal;
          
          // Format date nicely
          const dateObj = new Date(deadline.date);
          const day = dateObj.getDate();
          const month = dateObj.toLocaleDateString('en-IN', { month: 'short' });
          
          return (
            <div 
              key={deadline.id}
              className={`p-3 rounded-lg border transition-all hover:shadow-sm ${
                deadline.urgency === 'overdue' || deadline.urgency === 'critical'
                  ? 'bg-rose-50/50 border-rose-100' 
                  : 'bg-white border-slate-100 hover:border-slate-200'
              }`}
            >
              <div className="flex items-center gap-3">
                {/* Date Box */}
                <div className={`flex-shrink-0 w-12 h-12 rounded-lg ${typeConf.bg} ${typeConf.border} border flex flex-col items-center justify-center`}>
                  <span className={`text-xs font-bold ${typeConf.color}`}>{day}</span>
                  <span className={`text-[10px] uppercase ${typeConf.color} opacity-75`}>{month}</span>
                </div>
                
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-medium text-slate-900 truncate">{deadline.title}</h4>
                  </div>
                  <p className="text-xs text-slate-500 truncate mt-0.5">{deadline.description}</p>
                  
                  {/* Days Left Badge */}
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium ${urgencyConf.bg} ${urgencyConf.text}`}>
                      {urgencyConf.icon}
                      {deadline.urgency_label}
                    </span>
                  </div>
                </div>

                {/* Action Icon */}
                <button 
                  onClick={() => onViewDeadline?.(deadline) || alert(`View ${deadline.title} details coming soon`)}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <FileText className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary Footer */}
      {deadlines.length > 4 && (
        <div className="mt-3 pt-3 border-t border-slate-100 text-center">
          <button
            onClick={onViewAll || (() => alert('Full compliance calendar coming soon'))}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium"
          >
            +{deadlines.length - 4} more deadlines
          </button>
        </div>
      )}
    </div>
  );
}
