import { useMemo } from 'react';
import { Calendar } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { DatePreset } from '@/hooks/useDateRange';

interface DateRangePickerProps {
  preset: DatePreset;
  startDate: string;
  endDate: string;
  onPresetChange: (preset: DatePreset) => void;
  onDateChange: (type: 'start' | 'end', date: string) => void;
  className?: string;
}

const PRESET_OPTIONS: { value: DatePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'last_2_days', label: 'Last 2 Days' },
  { value: 'last_7_days', label: 'Last 7 Days' },
  { value: 'last_15_days', label: 'Last 15 Days' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'custom', label: 'Custom Range' },
];

export function DateRangePicker({
  preset,
  startDate,
  endDate,
  onPresetChange,
  onDateChange,
  className,
}: DateRangePickerProps) {
  const isCustom = preset === 'custom';

  const minDate = useMemo(() => {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 1);
    return date.toISOString().split('T')[0];
  }, []);

  const maxDate = useMemo(() => {
    return new Date().toISOString().split('T')[0];
  }, []);

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {PRESET_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => onPresetChange(value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition',
              preset === value
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {isCustom && (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5">
            <Calendar className="h-3.5 w-3.5 text-slate-400" />
            <input
              type="date"
              value={startDate}
              min={minDate}
              max={endDate}
              onChange={(e) => onDateChange('start', e.target.value)}
              className="bg-transparent text-xs outline-none"
            />
          </div>
          <span className="text-xs text-slate-400">to</span>
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5">
            <Calendar className="h-3.5 w-3.5 text-slate-400" />
            <input
              type="date"
              value={endDate}
              min={startDate}
              max={maxDate}
              onChange={(e) => onDateChange('end', e.target.value)}
              className="bg-transparent text-xs outline-none"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Simpler preset-only version
interface DatePresetPickerProps {
  preset: DatePreset;
  onChange: (preset: DatePreset) => void;
  className?: string;
  options?: DatePreset[];
}

export function DatePresetPicker({
  preset,
  onChange,
  className,
  options = ['today', 'last_7_days', 'last_month'],
}: DatePresetPickerProps) {
  const availableOptions = useMemo(() => {
    return PRESET_OPTIONS.filter(opt => options.includes(opt.value));
  }, [options]);

  return (
    <div className={cn('flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1', className)}>
      {availableOptions.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-medium transition',
            preset === value
              ? 'bg-blue-600 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
