import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/utils/cn';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-[#5D969D] text-white shadow-sm hover:bg-[#4A7A80] active:bg-[#3D656B]',
  secondary:
    'border border-[rgba(155,148,152,0.3)] bg-white text-slate-700 shadow-sm hover:border-[rgba(93,150,157,0.4)] hover:bg-[rgba(93,150,157,0.04)]',
  ghost:
    'text-slate-600 hover:bg-[rgba(93,150,157,0.06)] hover:text-slate-950',
  danger:
    'bg-red-600 text-white shadow-sm hover:bg-red-700',
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
