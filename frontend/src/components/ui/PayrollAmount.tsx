import { cn } from '@/utils/cn';

type AmountVariant = 'default' | 'success' | 'danger' | 'muted';

const variantClasses: Record<AmountVariant, string> = {
  default: 'text-slate-900',
  success: 'text-emerald-600',
  danger: 'text-rose-600',
  muted: 'text-slate-500',
};

interface PayrollAmountProps {
  amount: number | string | null | undefined;
  variant?: AmountVariant;
  className?: string;
  compact?: boolean;
  showSymbol?: boolean;
}

export default function PayrollAmount({ 
  amount, 
  variant = 'default', 
  className, 
  compact = false,
  showSymbol = true,
}: PayrollAmountProps) {
  const value = Number(amount ?? 0);
  const isNaN = !isFinite(value);
  const displayValue = isNaN ? 0 : value;
  
  const formatted = showSymbol 
    ? `₹${displayValue.toLocaleString('en-IN', { minimumFractionDigits: compact ? 0 : 2, maximumFractionDigits: compact ? 0 : 2 })}`
    : displayValue.toLocaleString('en-IN', { minimumFractionDigits: compact ? 0 : 2, maximumFractionDigits: compact ? 0 : 2 });

  return (
    <span className={cn(
      'font-semibold tabular-nums',
      variantClasses[variant],
      compact ? 'text-sm' : 'text-base',
      className
    )}>
      {formatted}
    </span>
  );
}

export function formatPayrollAmount(
  amount: number | string | null | undefined,
  options: { 
    compact?: boolean; 
    showSymbol?: boolean; 
    fallback?: string;
  } = {}
): string {
  const { compact = false, showSymbol = true, fallback = '₹0' } = options;
  const value = Number(amount ?? 0);
  
  if (!isFinite(value)) {
    return fallback;
  }
  
  if (showSymbol) {
    return `₹${value.toLocaleString('en-IN', { 
      minimumFractionDigits: compact ? 0 : 2, 
      maximumFractionDigits: compact ? 0 : 2 
    })}`;
  }
  
  return value.toLocaleString('en-IN', { 
    minimumFractionDigits: compact ? 0 : 2, 
    maximumFractionDigits: compact ? 0 : 2 
  });
}