import { cn } from '@/utils/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Optional tone so a three-way classification can read as good / bad / neutral. */
  tone?: 'brand' | 'success' | 'danger' | 'neutral';
}

interface SegmentedControlProps<T extends string> {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
}

const selectedTone: Record<NonNullable<SegmentedOption<string>['tone']>, string> = {
  brand: 'bg-blue-600 text-on-brand',
  success: 'bg-emerald-600 text-white',
  danger: 'bg-red-600 text-white',
  neutral: 'bg-surface-inverse text-on-inverse',
};

/**
 * A radiogroup that shows every choice at once. Used wherever the old page had
 * a dropdown over three-to-six short options — one click instead of three.
 */
export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'md',
  disabled,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-surface-sunken p-1',
        disabled && 'opacity-60',
        className
      )}
    >
      {options.map((option) => {
        const isSelected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-lg font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:cursor-not-allowed',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
              isSelected
                ? selectedTone[option.tone || 'brand']
                : 'text-slate-600 hover:bg-surface-card hover:text-slate-900'
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
