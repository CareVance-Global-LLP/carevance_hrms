import { useQuery } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';

export interface EmployeeLite {
  id: number;
  name: string;
  email?: string;
  [k: string]: unknown;
}

/**
 * Shared employees query.
 *
 * Six pages previously called `payrollApi.getEmployees()` independently with
 * `useQuery({ queryKey: ['payroll-employees'] })`, which meant the same
 * payload was fetched six times across the tab shell and each page owned its
 * own copy of the data. The shell now owns the cache; pages read from it.
 */
export function useEmployees() {
  return useQuery({
    queryKey: ['payroll-employees'],
    queryFn: () => payrollApi.getEmployees().then((res) => res.data ?? []),
    staleTime: 5 * 60 * 1000,
  });
}
