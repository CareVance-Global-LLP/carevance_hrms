import { cn } from '@/utils/cn';

type PayrollRunStatus = 
  | 'draft' 
  | 'processing' 
  | 'processed' 
  | 'locked' 
  | 'approved' 
  | 'released' 
  | 'disbursed' 
  | 'paid' 
  | 'not_started';

const statusConfig: Record<PayrollRunStatus, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: 'text-slate-600', bg: 'bg-slate-100' },
  processing: { label: 'Processing', color: 'text-blue-600', bg: 'bg-blue-100' },
  processed: { label: 'Processed', color: 'text-blue-600', bg: 'bg-blue-100' },
  locked: { label: 'Locked', color: 'text-amber-600', bg: 'bg-amber-100' },
  approved: { label: 'Approved', color: 'text-emerald-600', bg: 'bg-emerald-100' },
  released: { label: 'Released', color: 'text-violet-600', bg: 'bg-violet-100' },
  disbursed: { label: 'Disbursed', color: 'text-emerald-700', bg: 'bg-emerald-200' },
  paid: { label: 'Paid', color: 'text-emerald-700', bg: 'bg-emerald-200' },
  not_started: { label: 'Not Started', color: 'text-slate-400', bg: 'bg-slate-100' },
};

interface PayrollStatusBadgeProps {
  status: PayrollRunStatus;
  className?: string;
  size?: 'sm' | 'md';
}

export default function PayrollStatusBadge({ 
  status, 
  className, 
  size = 'md' 
}: PayrollStatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.not_started;
  
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-[11px]',
    md: 'px-3 py-1 text-xs',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium',
        config.bg,
        config.color,
        sizeClasses[size],
        className
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {config.label}
    </span>
  );
}