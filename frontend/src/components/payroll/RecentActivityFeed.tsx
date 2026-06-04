import { History, User, FileText, DollarSign, CheckCircle, Clock, ChevronRight } from 'lucide-react';

interface Activity {
  id: string;
  type: string;
  title: string;
  description: string;
  user: string;
  timestamp: string;
  time_ago: string;
}

interface RecentActivityFeedProps {
  activities: Activity[] | null;
  loading?: boolean;
  onViewAll?: () => void;
  onActivityClick?: (activity: Activity) => void;
}

const activityIcons: Record<string, { icon: any; bg: string; color: string }> = {
  payroll_run: { 
    icon: DollarSign, 
    bg: 'bg-blue-50', 
    color: 'text-blue-600' 
  },
  tax_declaration: { 
    icon: FileText, 
    bg: 'bg-violet-50', 
    color: 'text-violet-600' 
  },
  loan: { 
    icon: DollarSign, 
    bg: 'bg-amber-50', 
    color: 'text-amber-600' 
  },
  payment: { 
    icon: CheckCircle, 
    bg: 'bg-emerald-50', 
    color: 'text-emerald-600' 
  },
  settings: { 
    icon: User, 
    bg: 'bg-slate-50', 
    color: 'text-slate-600' 
  },
};

export default function RecentActivityFeed({
  activities,
  loading = false,
  onViewAll,
  onActivityClick
}: RecentActivityFeedProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl p-5 border border-slate-200 animate-pulse">
        <div className="h-4 w-32 bg-slate-200 rounded mb-4"></div>
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 bg-slate-100 rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  if (!activities || activities.length === 0) {
    return (
      <div className="bg-white rounded-xl p-5 border border-slate-200">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-1.5 bg-slate-100 rounded-lg">
            <History className="h-4 w-4 text-slate-600" />
          </div>
          <h3 className="text-base font-semibold text-slate-900">Recent Activity</h3>
        </div>
        <div className="p-4 bg-slate-50 rounded-lg text-center">
          <History className="h-8 w-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">No recent activity</p>
        </div>
      </div>
    );
  }

  const visibleActivities = activities.slice(0, 5);

  return (
    <div className="bg-white rounded-xl p-5 border border-slate-200">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-blue-100 rounded-lg">
            <History className="h-4 w-4 text-blue-600" />
          </div>
          <h3 className="text-base font-semibold text-slate-900">Recent Activity</h3>
        </div>
        <button 
          onClick={onViewAll || (() => alert('Full activity history coming soon'))}
          className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
        >
          View All
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>

      <div className="space-y-3">
        {visibleActivities.map((activity) => {
          const config = activityIcons[activity.type] || activityIcons.settings;
          const IconComponent = config.icon;
          
          return (
            <div 
              key={activity.id}
              className="flex items-start gap-3 p-2 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
              onClick={() => onActivityClick?.(activity) || console.log('Activity clicked:', activity)}
            >
              <div className={`p-2 rounded-lg ${config.bg} flex-shrink-0`}>
                <IconComponent className={`h-3.5 w-3.5 ${config.color}`} />
              </div>
              
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 line-clamp-1">{activity.title}</p>
                <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{activity.description}</p>
                
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                    <User className="h-2.5 w-2.5" />
                    {activity.user}
                  </span>
                  <span className="text-slate-300">|</span>
                  <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                    <Clock className="h-2.5 w-2.5" />
                    {activity.time_ago}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {activities.length > 5 && (
        <div className="mt-3 pt-3 border-t border-slate-100 text-center">
          <button
            onClick={onViewAll || (() => alert('Full activity history coming soon'))}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium"
          >
            +{activities.length - 5} more activities
          </button>
        </div>
      )}
    </div>
  );
}
