import { 
  Users, 
  TrendingUp, 
  TrendingDown, 
  TrendingFlat,
  ArrowUpRight,
  ArrowDownRight,
  Minus
} from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  trend?: {
    percentage: number;
    direction: 'up' | 'down' | 'neutral';
    is_positive?: boolean;
  };
  icon: React.ReactNode;
  iconBgColor: string;
  iconColor: string;
  loading?: boolean;
}

export default function EnhancedStatCard({
  title,
  value,
  subtitle,
  trend,
  icon,
  iconBgColor,
  iconColor,
  loading = false
}: StatCardProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl p-5 border border-slate-200 animate-pulse">
        <div className="h-20 bg-slate-200 rounded-lg"></div>
      </div>
    );
  }

  const getTrendIcon = () => {
    if (!trend) return null;
    if (trend.direction === 'up') {
      return trend.is_positive ? 
        <ArrowUpRight className="h-3 w-3" /> : 
        <TrendingUp className="h-3 w-3" />;
    }
    if (trend.direction === 'down') {
      return trend.is_positive ? 
        <ArrowDownRight className="h-3 w-3" /> : 
        <TrendingDown className="h-3 w-3" />;
    }
    return <Minus className="h-3 w-3" />;
  };

  const getTrendColor = () => {
    if (!trend) return 'text-slate-500';
    if (trend.direction === 'neutral') return 'text-slate-500';
    return trend.is_positive ? 'text-emerald-600' : 'text-rose-600';
  };

  return (
    <div className="bg-white rounded-xl p-5 border border-slate-200 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
          
          {/* Trend indicator */}
          {trend && (
            <div className={`flex items-center gap-1 mt-1 ${getTrendColor()}`}>
              {getTrendIcon()}
              <span className="text-xs font-medium">{trend.percentage}%</span>
              <span className="text-xs text-slate-400 ml-1">vs last month</span>
            </div>
          )}
          
          {/* Subtitle */}
          {subtitle && (
            <p className="text-xs text-slate-400 mt-1">{subtitle}</p>
          )}
        </div>
        
        {/* Icon */}
        <div className={`p-2 rounded-lg ${iconBgColor}`}>
          <div className={iconColor}>{icon}</div>
        </div>
      </div>
    </div>
  );
}
