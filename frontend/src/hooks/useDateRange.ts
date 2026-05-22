import { useState, useEffect, useCallback, useMemo } from 'react';

export type DatePreset = 'today' | 'last_2_days' | 'last_5_days' | 'last_7_days' | 'last_15_days' | 'last_month' | 'custom';

export interface DateRange {
  startDate: string;
  endDate: string;
}

const toIsoDate = (date: Date) => date.toISOString().split('T')[0];

const getPresetDates = (preset: DatePreset): DateRange => {
  const end = new Date();
  const start = new Date();

  switch (preset) {
    case 'today':
      break;
    case 'last_2_days':
      start.setDate(start.getDate() - 2);
      break;
    case 'last_5_days':
      start.setDate(start.getDate() - 5);
      break;
    case 'last_7_days':
      start.setDate(start.getDate() - 7);
      break;
    case 'last_15_days':
      start.setDate(start.getDate() - 15);
      break;
    case 'last_month':
      start.setMonth(start.getMonth() - 1);
      break;
    default:
      break;
  }

  return {
    startDate: toIsoDate(start),
    endDate: toIsoDate(end),
  };
};

interface UseDateRangeOptions {
  defaultPreset?: DatePreset;
  storageKey?: string;
}

export function useDateRange(options: UseDateRangeOptions = {}) {
  const { defaultPreset = 'today', storageKey } = options;
  
  const [preset, setPreset] = useState<DatePreset>(() => {
    if (storageKey) {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) return saved as DatePreset;
    }
    return defaultPreset;
  });

  const [customRange, setCustomRange] = useState<DateRange>(() => {
    const { startDate, endDate } = getPresetDates(defaultPreset);
    return { startDate, endDate };
  });

  const dateRange = useMemo(() => {
    if (preset === 'custom') {
      return customRange;
    }
    return getPresetDates(preset);
  }, [preset, customRange]);

  const setDatePreset = useCallback((newPreset: DatePreset) => {
    setPreset(newPreset);
    if (storageKey) {
      sessionStorage.setItem(storageKey, newPreset);
    }
    if (newPreset !== 'custom') {
      const { startDate, endDate } = getPresetDates(newPreset);
      setCustomRange({ startDate, endDate });
    }
  }, [storageKey]);

  const setCustomDateRange = useCallback((range: Partial<DateRange>) => {
    setPreset('custom');
    if (storageKey) {
      sessionStorage.setItem(storageKey, 'custom');
    }
    setCustomRange(prev => ({
      startDate: range.startDate ?? prev.startDate,
      endDate: range.endDate ?? prev.endDate,
    }));
  }, [storageKey]);

  const refreshRange = useCallback(() => {
    if (preset !== 'custom') {
      const { startDate, endDate } = getPresetDates(preset);
      setCustomRange({ startDate, endDate });
    }
  }, [preset]);

  return {
    preset,
    dateRange,
    setDatePreset,
    setCustomDateRange,
    refreshRange,
    isCustom: preset === 'custom',
  };
}
