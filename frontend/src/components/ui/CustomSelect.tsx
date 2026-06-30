import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/utils/cn';
type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

interface CustomSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  dropDirection?: 'auto' | 'up' | 'down';
}

export default function CustomSelect({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  disabled = false,
  className,
  id,
  dropDirection = 'auto',
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const selectedOption = options.find((opt) => opt.value === value) || null;

  // Calculate position when opening
  useEffect(() => {
    if (open && buttonRef.current) {
      const calculatePosition = () => {
        const rect = buttonRef.current?.getBoundingClientRect();
        if (!rect) return;
        const panelHeight = 300; // max-h-72 = 18rem
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;

        let top: number;
        if (dropDirection === 'down') {
          top = rect.bottom + 4;
        } else if (dropDirection === 'up') {
          top = rect.top - panelHeight - 4;
        } else if (spaceBelow >= panelHeight) {
          top = rect.bottom + 4;
        } else if (spaceAbove >= panelHeight) {
          top = rect.top - panelHeight - 4;
        } else {
          top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - panelHeight - 8));
        }

        setPanelPos({
          top,
          left: rect.left,
          width: rect.width,
        });
      };

      // Calculate immediately and again after a frame to ensure correct position
      calculatePosition();
      requestAnimationFrame(calculatePosition);
    }
  }, [open, dropDirection]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (
        containerRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  // Close on scroll/resize
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        ref={buttonRef}
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400',
          open && 'border-blue-400 bg-white ring-2 ring-blue-100',
          className
        )}
      >
        <span className={cn('truncate', !selectedOption && 'text-gray-400')}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-gray-500 transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>

      {open && panelPos
        ? createPortal(
            <div
              ref={panelRef}
              style={{
                position: 'fixed',
                top: panelPos.top,
                left: panelPos.left,
                width: panelPos.width,
                zIndex: 9999,
              }}
              role="listbox"
              className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
            >
              <div className="max-h-72 overflow-auto py-1.5">
                {options.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-gray-500">
                    No options available
                  </div>
                ) : (
                  options.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={value === option.value}
                      disabled={option.disabled}
                      onClick={() => {
                        onChange(option.value);
                        setOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition hover:bg-blue-50',
                        option.disabled && 'cursor-not-allowed opacity-50'
                      )}
                    >
                      <span className="truncate text-sm font-medium text-gray-900">
                        {option.label}
                      </span>
                      {value === option.value ? (
                        <Check className="h-4 w-4 shrink-0 text-blue-600" />
                      ) : null}
                    </button>
                  ))
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
