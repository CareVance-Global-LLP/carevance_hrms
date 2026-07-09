import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { cn } from '@/utils/cn';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function currentMonthValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

interface MonthPickerProps {
  /** Selected month as YYYY-MM. Empty string means "all months". */
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * Reusable month picker with a trigger button and a portaled dropdown
 * containing a year selector (< >) and a 4×3 (Jan–Dec) month grid.
 *
 * - Selected month: blue fill.
 * - Current real month: subtle blue ring.
 * - Empty value renders an "All months" placeholder.
 */
export default function MonthPicker({ value, onChange, className }: MonthPickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const [displayYear, setDisplayYear] = useState<number>(() =>
    value ? parseInt(value.split('-')[0], 10) : new Date().getFullYear(),
  );

  // Keep the visible grid year in sync with the selected month.
  useEffect(() => {
    if (value) setDisplayYear(parseInt(value.split('-')[0], 10));
  }, [value]);

  // Position the portaled panel under (or above) the trigger.
  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const calculate = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const panelHeight = 260;
      const spaceBelow = window.innerHeight - rect.bottom;
      const top =
        spaceBelow >= panelHeight || spaceBelow >= rect.top
          ? rect.bottom + 4
          : rect.top - panelHeight - 4;
      setPanelPos({ top, left: rect.left, width: Math.max(rect.width, 256) });
    };
    calculate();
    requestAnimationFrame(calculate);
  }, [open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (containerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on scroll/resize.
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

  const current = currentMonthValue();
  const [vYear, vMon] = (value || '').split('-');
  const label =
    vYear && vMon ? `${LONG_MONTH_NAMES[parseInt(vMon, 10) - 1]}, ${vYear}` : 'All months';

  const months = Array.from({ length: 12 }, (_, i) => ({
    mm: `${displayYear}-${String(i + 1).padStart(2, '0')}`,
    name: MONTH_NAMES[i],
  }));

  return (
    <div className={cn('relative', className)} ref={containerRef}>
      <button
        type="button"
        ref={buttonRef}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100',
          open && 'border-blue-400 ring-2 ring-blue-100',
        )}
      >
        <Calendar className="h-4 w-4 text-slate-500" />
        <span className={cn('whitespace-nowrap', !value && 'text-slate-400')}>{label}</span>
        <ChevronDown className={cn('h-4 w-4 text-slate-500 transition-transform', open && 'rotate-180')} />
      </button>

      {open && panelPos
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              style={{ position: 'fixed', top: panelPos.top, left: panelPos.left, width: panelPos.width, zIndex: 9999 }}
              className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
            >
              <div className="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setDisplayYear((y) => y - 1)}
                  className="rounded-md p-1.5 text-slate-600 transition-colors hover:bg-slate-100"
                  aria-label="Previous year"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-semibold text-slate-700 tabular-nums">{displayYear}</span>
                <button
                  type="button"
                  onClick={() => setDisplayYear((y) => y + 1)}
                  className="rounded-md p-1.5 text-slate-600 transition-colors hover:bg-slate-100"
                  aria-label="Next year"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {months.map(({ mm, name }) => {
                  const isSelected = mm === value;
                  const isCurrent = mm === current;
                  return (
                    <button
                      key={mm}
                      type="button"
                      onClick={() => {
                        onChange(mm);
                        setOpen(false);
                      }}
                      className={cn(
                        'flex items-center justify-center gap-1 rounded-md border py-2 text-xs font-semibold transition-all',
                        isSelected
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                        isCurrent && !isSelected && 'ring-1 ring-blue-400 border-blue-300',
                      )}
                    >
                      {name}
                      {isSelected && <Check className="h-3 w-3" />}
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
