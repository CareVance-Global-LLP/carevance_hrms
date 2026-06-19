import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Check, Calendar } from 'lucide-react';
import { cn } from '@/utils/cn';

interface RunSummary {
  month_year: string;
  status: string;
}

interface MonthTimelineProps {
  selectedMonth: string; // YYYY-MM
  onMonthChange: (month: string) => void;
  runs?: RunSummary[];
  className?: string;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COMPLETED_STATUSES = new Set(['disbursed', 'paid']);

/**
 * Compute the Indian financial year (Apr-Mar) containing the given YYYY-MM.
 * Apr 2026 → FY 2026-27. Mar 2027 → FY 2026-27.
 */
function financialYearOf(monthYear: string): { label: string; months: string[] } {
  const [yStr, mStr] = monthYear.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);
  const fyStart = month >= 4 ? year : year - 1;
  const fyEnd = fyStart + 1;
  return {
    label: `FY ${fyStart}-${String(fyEnd).slice(-2)}`,
    // Apr=4 .. Mar=3 next year
    months: [
      `${fyStart}-04`, `${fyStart}-05`, `${fyStart}-06`, `${fyStart}-07`,
      `${fyStart}-08`, `${fyStart}-09`, `${fyStart}-10`, `${fyStart}-11`,
      `${fyStart}-12`, `${fyEnd}-01`, `${fyEnd}-02`, `${fyEnd}-03`,
    ],
  };
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function runStatusForMonth(monthYear: string, runs: RunSummary[] | undefined): {
  status: 'completed' | 'pending' | 'upcoming';
  runStatus?: string;
} {
  if (!runs) return { status: 'upcoming' };
  const match = runs.find((r) => r.month_year === monthYear);
  if (!match) return { status: 'upcoming' };
  if (COMPLETED_STATUSES.has(match.status)) return { status: 'completed', runStatus: match.status };
  return { status: 'pending', runStatus: match.status };
}

/**
 * Horizontal scrollable month pill strip showing the Indian financial year.
 *
 * - Each month pill shows month name + year, with a status badge.
 * - Click a pill to switch the dashboard's selected month.
 * - Auto-scrolls to center the current month on mount.
 * - Selected pill gets a blue ring; current month also gets a blue ring.
 */
export default function MonthTimeline({
  selectedMonth,
  onMonthChange,
  runs,
  className,
}: MonthTimelineProps) {
  const fy = useMemo(() => financialYearOf(selectedMonth), [selectedMonth]);
  const currentMonthStr = useMemo(() => currentMonth(), []);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const selectedPillRef = useRef<HTMLButtonElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Determine if selected month is in the current FY — if not, show next/prev
  const selectedInFY = fy.months.includes(selectedMonth);

  // Use the selected month's FY as the displayed range. If selected month is
  // not in any FY we render (shouldn't happen), default to current month.
  const displayedMonths = selectedInFY
    ? fy.months
    : (() => financialYearOf(currentMonthStr).months)();

  const updateScrollButtons = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    updateScrollButtons();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateScrollButtons, { passive: true });
    const ro = new ResizeObserver(updateScrollButtons);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', updateScrollButtons);
      ro.disconnect();
    };
  }, [updateScrollButtons]);

  // Auto-center the selected pill on mount and when selectedMonth changes
  useEffect(() => {
    const pill = selectedPillRef.current;
    const container = scrollRef.current;
    if (!pill || !container) return;
    const pillRect = pill.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const offset = (pillRect.left - containerRect.left) - (containerRect.width / 2) + (pillRect.width / 2);
    container.scrollBy({ left: offset, behavior: 'smooth' });
  }, [selectedMonth]);

  const scrollBy = (delta: number) => {
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  };

  return (
    <div className={cn('w-full', className)}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <Calendar className="h-4 w-4 text-slate-500" />
          {fy.label}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => scrollBy(-200)}
            disabled={!canScrollLeft}
            className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Scroll months left"
          >
            <ChevronLeft className="h-4 w-4 text-slate-600" />
          </button>
          <button
            type="button"
            onClick={() => scrollBy(200)}
            disabled={!canScrollRight}
            className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Scroll months right"
          >
            <ChevronRight className="h-4 w-4 text-slate-600" />
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin scroll-smooth"
        style={{ scrollbarWidth: 'thin' }}
      >
        {displayedMonths.map((mm) => {
          const [, mStr] = mm.split('-');
          const monthIdx = parseInt(mStr, 10);
          const [yStr] = mm.split('-');
          const label = `${MONTH_NAMES[monthIdx - 1]} ${yStr}`;
          const { status, runStatus } = runStatusForMonth(mm, runs);
          const isSelected = mm === selectedMonth;
          const isCurrent = mm === currentMonthStr;

          return (
            <button
              key={mm}
              ref={isSelected ? selectedPillRef : null}
              type="button"
              onClick={() => onMonthChange(mm)}
              className={cn(
                'flex-shrink-0 flex flex-col items-center justify-center px-4 py-2 rounded-xl border-2 transition-all min-w-[88px]',
                'hover:shadow-sm',
                isSelected
                  ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                  : isCurrent
                    ? 'border-blue-300 bg-white ring-1 ring-blue-100'
                    : 'border-slate-200 bg-white',
              )}
              aria-current={isSelected ? 'true' : undefined}
            >
              <span className={cn(
                'text-xs font-semibold',
                isSelected ? 'text-blue-700' : 'text-slate-700',
              )}>
                {label}
              </span>
              <span className={cn(
                'mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider',
                status === 'completed' && 'bg-emerald-100 text-emerald-700',
                status === 'pending' && 'bg-amber-100 text-amber-700',
                status === 'upcoming' && 'bg-slate-100 text-slate-500',
              )}>
                {status === 'completed' && <Check className="h-3 w-3" />}
                {status === 'completed' ? 'Done' :
                 status === 'pending' ? (runStatus ?? 'Pending') :
                 'Upcoming'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
