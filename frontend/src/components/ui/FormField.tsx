import {
  Children,
  isValidElement,
  useEffect,
  useLayoutEffect,
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
  value,
  defaultValue,
  onChange,
  disabled,
  name,
  id,
  'aria-label': ariaLabel,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const [open, setOpen] = useState(false);
  const [internalValue, setInternalValue] = useState<string>(() => String(value ?? defaultValue ?? ''));
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0, width: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const controlledValue = value !== undefined ? String(value) : internalValue;
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
      const clickedTrigger = Boolean(target && containerRef.current?.contains(target));
      const clickedMenu = Boolean(target && menuRef.current?.contains(target));

      if (target && !clickedTrigger && !clickedMenu) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  useLayoutEffect(() => {
    if (!open || !containerRef.current) {
      return;
    }

    const updatePosition = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setMenuPosition({
        left: rect.left,
        top: rect.bottom + 8,
        width: rect.width,
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

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
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          baseControlClassName,
          'flex items-center justify-between gap-3 text-left',
          open && 'border-sky-300 bg-white ring-2 ring-sky-300/25',
          className
        )}
      >
        <span className="truncate">{selectedOption?.label || 'Select'}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-500 transition', open && 'rotate-180')} />
      </button>

      {open && typeof document !== 'undefined' ? createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label={ariaLabel}
          className="fixed z-[9999] max-h-72 overflow-auto rounded-[24px] border border-slate-200 bg-white p-2 shadow-[0_24px_70px_-32px_rgba(15,23,42,0.32)]"
          style={{ left: menuPosition.left, top: menuPosition.top, width: menuPosition.width }}
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
                  'flex w-full items-center justify-between gap-3 rounded-[18px] px-3.5 py-2.5 text-left text-sm transition',
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
