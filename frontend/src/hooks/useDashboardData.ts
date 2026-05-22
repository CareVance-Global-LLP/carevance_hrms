import { useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

interface UseDashboardDataOptions<T> {
  queryKey: string;
  fetchFn: (params: { startDate: string; endDate: string }) => Promise<T>;
  defaultDateRange: { startDate: string; endDate: string };
}

export function useDashboardData<T>(options: UseDashboardDataOptions<T>) {
  const { queryKey, fetchFn, defaultDateRange } = options;
  const queryClient = useQueryClient();

  const [dateRange, setDateRange] = useState(defaultDateRange);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [queryKey, dateRange.startDate, dateRange.endDate],
    queryFn: () => fetchFn(dateRange),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [queryKey] });
  }, [queryClient, queryKey]);

  const updateDateRange = useCallback((newRange: { startDate: string; endDate: string }) => {
    setDateRange(newRange);
  }, []);

  const stats = useMemo(() => {
    if (!data) return null;
    return {
      hasData: true,
      isEmpty: Array.isArray(data) ? data.length === 0 : false,
    };
  }, [data]);

  return {
    data,
    isLoading,
    error,
    dateRange,
    updateDateRange,
    refresh,
    refetch,
    stats,
  };
}

// Hook for real-time data with auto-refresh
interface UseRealtimeDataOptions<T> {
  queryKey: string;
  fetchFn: () => Promise<T>;
  refreshInterval?: number;
}

export function useRealtimeData<T>(options: UseRealtimeDataOptions<T>) {
  const { queryKey, fetchFn, refreshInterval = 30000 } = options;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [queryKey],
    queryFn: fetchFn,
    refetchInterval: refreshInterval,
    staleTime: refreshInterval / 2,
  });

  return {
    data,
    isLoading,
    error,
    refetch,
  };
}
