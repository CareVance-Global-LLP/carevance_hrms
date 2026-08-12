import {
  Children,
  forwardRef,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/utils/cn';
import useFloatingDropdown from '@/components/ui/useFloatingDropdown';

// Every input, select and textarea in the app renders from this one string.
// `border-strong` rather than `border-slate-200` because a control boundary has
// to clear 3:1 against its surface, which a hairline divider colour does not.
const baseControlClassName =
  'w-full rounded-lg border border-border-strong bg-surface-card px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-300/30 disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-slate-400';

export function FieldLabel({
  children,
  hint,
  className,
  labelClassName,
  htmlFor,
}: {
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
  labelClassName?: string;
  /**
   * The id of the control this labels.
   *
   * Without it the `<label>` is decoration: a screen reader reaches the field
   * and announces "edit text, blank", because the visible caption is not
   * associated with anything. Chrome's own audit reports these as "No label
   * associated with a form field". Pass it together with the same `id` on the
   * control — `useId()` in the calling component is the easiest source.
   */
  htmlFor?: string;
}) {
  return (
    <div className={cn('mb-1.5 flex min-h-[1.2rem] items-center justify-between gap-3', className)}>
      <label
        htmlFor={htmlFor}
        className={cn('block min-w-0 flex-1 truncate whitespace-nowrap text-xs font-semibold uppercase tracking-[0.2em] text-slate-500', labelClassName)}
      >
        {children}
      </label>
      {hint ? <span className="shrink-0 text-xs text-slate-400">{hint}</span> : null}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  {
    className,
    ...props
  },
  ref
) {
  return <input ref={ref} className={cn(baseControlClassName, className)} {...props} />;
});

export function SelectInput({
  children,
  className,
  value,
  defaultValue,
  onChange,
  disabled,
  name,
  id,
  'aria-label': ariaLabel,
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const [open, setOpen] = useState(false);
  const [internalValue, setInternalValue] = useState<string>(() => String(value ?? defaultValue ?? ''));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const controlledValue = value !== undefined ? String(value) : internalValue;
  const { panelRef, panelStyle } = useFloatingDropdown(buttonRef, open);
  const options = useMemo(() => (
    Children.toArray(children)
      .filter(isValidElement)
      .map((child) => {
        const optionProps = child.props as {
          value?: string | number;
          children?: ReactNode;
          disabled?: boolean;
        };
        const optionValue = String(optionProps.value ?? '');
        return {
          value: optionValue,
          label: Children.toArray(optionProps.children).join(''),
          disabled: Boolean(optionProps.disabled),
        };
      })
  ), [children]);
  const selectedOption = options.find((option) => option.value === controlledValue) || options[0] || null;

  useEffect(() => {
    if (value !== undefined) {
      setInternalValue(String(value));
    }
  }, [value]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (
        target
        && containerRef.current
        && !containerRef.current.contains(target)
        && panelRef.current
        && !panelRef.current.contains(target)
      ) {
        setOpen(false);
      } else if (target && containerRef.current && !containerRef.current.contains(target) && !panelRef.current) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const emitChange = (nextValue: string) => {
    setInternalValue(nextValue);
    onChange?.({
      target: { value: nextValue, name },
      currentTarget: { value: nextValue, name },
    } as unknown as React.ChangeEvent<HTMLSelectElement>);
  };

  return (
    <div className="relative" ref={containerRef}>
      {name ? <input type="hidden" name={name} value={controlledValue} /> : null}
      <button
        type="button"
        id={id}
        ref={buttonRef}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          baseControlClassName,
          'flex items-center justify-between gap-3 text-left',
          open && 'border-sky-400 ring-2 ring-sky-300/30',
          className
        )}
      >
        <span className="truncate">{selectedOption?.label || 'Select'}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-500 transition', open && 'rotate-180')} />
      </button>

      {open && panelStyle ? createPortal(
        <div
          ref={panelRef}
          style={panelStyle}
          role="listbox"
          aria-label={ariaLabel}
          className="max-h-72 overflow-auto rounded-lg border border-slate-200 bg-surface-raised p-2 shadow-modal"
        >
          {options.map((option) => {
            const isSelected = option.value === controlledValue;

            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={option.disabled}
                onClick={() => {
                  if (option.disabled) return;
                  emitChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded-lg px-3.5 py-2.5 text-left text-sm transition',
                  isSelected ? 'bg-sky-50 text-sky-800' : 'text-slate-700 hover:bg-slate-50 hover:text-slate-950',
                  option.disabled && 'cursor-not-allowed opacity-50'
                )}
              >
                <span className="truncate">{option.label}</span>
                {isSelected ? <Check className="h-4 w-4 shrink-0 text-sky-600" /> : null}
              </button>
            );
          })}
        </div>,
        document.body
      ) : null}
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
        /*
         * Off-track was `bg-slate-200`, which theme.css remaps to a near-black
         * neutral in dark mode — measured at rgb(33,44,52) against a knob of
         * rgb(30,42,51), roughly 1.03:1. The switch was invisible when off.
         * slate-400 keeps a mid tone in both themes.
         */
        checked ? 'border-sky-400 bg-sky-500/90' : 'border-slate-400 bg-slate-400/60'
      )}
    >
      <span
        className={cn(
          /*
           * Literal white on purpose, not `bg-white`.
           *
           * bg-white is remapped dark by theme.css, which is right for a panel
           * and wrong for a switch knob — the knob has to read as the moving
           * part against both a grey off-track and a sky on-track. iOS and
           * Material both keep it light in dark mode for the same reason. No
           * existing token holds: on-brand flips with the theme and
           * surface-inverse is dark in light mode.
           */
          'inline-block h-5 w-5 rounded-full bg-[#ffffff] shadow-sm transition duration-300',
          checked ? 'translate-x-6' : 'translate-x-1'
        )}
      />
    </button>
  );
}
