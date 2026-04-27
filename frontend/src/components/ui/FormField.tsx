import {
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/utils/cn';

const baseControlClassName =
  'w-full rounded-[20px] border border-slate-200/90 bg-white/85 px-3.5 py-2.5 text-sm text-slate-900 shadow-[0_16px_30px_-24px_rgba(15,23,42,0.25)] outline-none transition duration-300 placeholder:text-slate-400 focus:border-sky-300 focus:bg-white focus:ring-2 focus:ring-sky-300/25 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400';

export function FieldLabel({
  children,
  hint,
  className,
  labelClassName,
}: {
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
  labelClassName?: string;
}) {
  return (
    <div className={cn('mb-1.5 flex min-h-[1.2rem] items-center justify-between gap-3', className)}>
      <label className={cn('block min-w-0 flex-1 truncate whitespace-nowrap text-xs font-semibold uppercase tracking-[0.2em] text-slate-500', labelClassName)}>
        {children}
      </label>
      {hint ? <span className="shrink-0 text-xs text-slate-400">{hint}</span> : null}
    </div>
  );
}

export function TextInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(baseControlClassName, className)} {...props} />;
}

export function SelectInput({
  children,
  className,
  disabled,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        disabled={disabled}
        className={cn(
          baseControlClassName,
          'appearance-none pr-10',
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
    </div>
  );
}

export function TextareaInput({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(baseControlClassName, className)} {...props} />;
}

export function ToggleInput({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-7 w-12 items-center rounded-full border transition duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-60',
        checked ? 'border-sky-400 bg-sky-500/90' : 'border-slate-200 bg-slate-200'
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 rounded-full bg-white shadow-sm transition duration-300',
          checked ? 'translate-x-6' : 'translate-x-1'
        )}
      />
    </button>
  );
}
