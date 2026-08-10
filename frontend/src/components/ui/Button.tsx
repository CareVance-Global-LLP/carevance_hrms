import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/utils/cn';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

// `on-brand` flips with the theme: white on the teal fill in light mode, and
// near-black on the lightened teal used in dark mode, where white would only
// reach 2.3:1. The literal hexes these replaced could not follow the theme.
const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-blue-600 text-on-brand shadow-sm hover:bg-blue-500 active:bg-blue-700',
  secondary:
    'border border-slate-300 bg-surface-card text-slate-700 shadow-sm hover:border-blue-400/60 hover:bg-blue-50/60',
  ghost:
    'text-slate-600 hover:bg-blue-50/70 hover:text-slate-950',
  danger:
    'bg-red-600 text-white shadow-sm hover:bg-red-500',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'min-h-9 rounded-lg px-3 text-xs font-semibold',
  md: 'min-h-10 rounded-lg px-4 text-sm font-semibold',
  lg: 'min-h-11 rounded-lg px-5 text-sm font-semibold',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
}

export default function Button({
  children,
  className,
  disabled,
  iconLeft,
  iconRight,
  loading = false,
  size = 'md',
  type = 'button',
  variant = 'primary',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-60',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    >
      {loading ? (
        <span className="shrink-0">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        </span>
      ) : iconLeft ? (
        <span className="shrink-0">{iconLeft}</span>
      ) : null}
      {children}
      {iconRight ? <span className="shrink-0">{iconRight}</span> : null}
    </button>
  );
}
