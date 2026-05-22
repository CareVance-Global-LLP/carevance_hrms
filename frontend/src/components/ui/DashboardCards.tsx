import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/utils/cn';

interface DashboardCardProps {
  children: ReactNode;
  className?: string;
  id?: string;
}

export function DashboardCard({ children, className, id }: DashboardCardProps) {
  return (
    <section 
      id={id} 
      className={cn(
        'rounded-lg border border-slate-200 bg-white shadow-sm',
        className
      )}
    >
      {children}
    </section>
  );
}

// Section Title Component
interface SectionTitleProps {
  title: string;
  action?: ReactNode;
  description?: string;
}

export function SectionTitle({ title, action, description }: SectionTitleProps) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div>
        <h2 className="text-[15px] font-semibold text-slate-950">{title}</h2>
        {description && (
          <p className="mt-1 text-xs text-slate-500">{description}</p>
        )}
      </div>
      {action ?? <span />}
    </div>
  );
}

// KPI Card Component
interface KpiCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  tint: string;
  to?: string;
  trend?: {
    value: number;
    label: string;
  };
}

export function KpiCard({ 
  label, 
  value, 
  hint, 
  icon: Icon, 
  tint, 
  to,
  trend 
}: KpiCardProps) {
  const content = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 truncate">
          {value}
        </p>
        {hint && <p className="mt-2 text-[11px] text-slate-500">{hint}</p>}
        {trend && (
          <p className={cn(
            'mt-1 text-[11px]',
            trend.value >= 0 ? 'text-emerald-600' : 'text-rose-600'
          )}>
            {trend.value >= 0 ? '+' : ''}{trend.value}% {trend.label}
          </p>
        )}
      </div>
      <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', tint)}>
        <Icon className="h-5 w-5" />
      </div>
    </div>
  );

  if (to) {
    return (
      <Link 
        to={to} 
        className="block rounded-lg transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        <DashboardCard className="p-4">{content}</DashboardCard>
      </Link>
    );
  }

  return <DashboardCard className="p-4">{content}</DashboardCard>;
}

// Metric Card (Larger version for detailed metrics)
interface MetricCardProps {
  label: string;
  value: string | number;
  hint?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  className?: string;
}

export function MetricCard({ 
  label, 
  value, 
  hint, 
  trend, 
  trendValue,
  className 
}: MetricCardProps) {
  return (
    <DashboardCard className={cn('p-4', className)}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-slate-950">{value}</p>
      <div className="mt-2 flex items-center gap-2">
        {trend && trend !== 'neutral' && (
          <span className={cn(
            'text-xs font-medium',
            trend === 'up' ? 'text-emerald-600' : 'text-rose-600'
          )}>
            {trend === 'up' ? '↑' : '↓'} {trendValue}
          </span>
        )}
        {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
      </div>
    </DashboardCard>
  );
}

// Quick Action Card
interface QuickActionProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  to?: string;
  variant?: 'default' | 'primary' | 'danger';
}

export function QuickAction({ 
  icon: Icon, 
  label, 
  onClick, 
  to,
  variant = 'default' 
}: QuickActionProps) {
  const variantClasses = {
    default: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    primary: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100',
    danger: 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100',
  };

  const className = cn(
    'flex items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium transition',
    variantClasses[variant]
  );

  const content = (
    <>
      <Icon className="h-5 w-5 shrink-0" />
      <span className="truncate">{label}</span>
    </>
  );

  if (to) {
    return (
      <Link to={to} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

// Empty State Component
interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon: Icon, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center">
      {Icon && <Icon className="h-12 w-12 text-slate-300" />}
      <h3 className="mt-4 text-sm font-medium text-slate-900">{title}</h3>
      {description && (
        <p className="mt-1 text-xs text-slate-500 max-w-xs">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
