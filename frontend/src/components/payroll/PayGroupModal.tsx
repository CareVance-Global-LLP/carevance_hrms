import { useState, useEffect, useMemo, useDeferredValue } from 'react';
import {
  X,
  Loader2,
  CheckCircle,
  Search,
  Users,
  UserX,
  ChevronDown,
} from 'lucide-react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import type { AllEmployee } from '@/types';

interface PayGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  monthYear: string;
  onCreated: (payGroupId: number, payGroupName: string) => void;
}

const PAGE_SIZE = 50;

interface EmployeesPage {
  employees: AllEmployee[];
  total: number;
  current_page: number;
  last_page: number;
  per_page: number;
}

export default function PayGroupModal({
  isOpen,
  onClose,
  monthYear: _monthYear,
  onCreated,
}: PayGroupModalProps) {
  // ALL useState hooks at the top
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  const [step, setStep] = useState<'configure' | 'success'>('configure');
  const [createdName, setCreatedName] = useState<string>('');

  // useDeferredValue keeps the typing experience smooth when the
  // employee list is large — the input updates immediately, the
  // network refetch is deferred.
  const deferredSearch = useDeferredValue(search);

  const queryClient = useQueryClient();

  // Reset state every time the modal opens. We reset to page 1 and
  // clear the accumulated pages so the user starts fresh.
  useEffect(() => {
    if (isOpen) {
      setName('');
      setSearch('');
      setSelectedIds(new Set());
      setPage(1);
      setStep('configure');
      setCreatedName('');
    }
  }, [isOpen]);

  // When filters change, jump back to page 1.
  useEffect(() => {
    setPage(1);
  }, [deferredSearch]);

  // Employees for the picker. Refetches on filter / page change.
  // We use `placeholderData: keepPreviousData` so a "Load More"
  // click doesn't blank the table during the next-page fetch.
  const employeesQuery = useQuery({
    queryKey: ['payroll', 'all-employees', deferredSearch, page],
    queryFn: () =>
      payrollApi
        .getAllEmployees({
          search: deferredSearch || undefined,
          page,
          per_page: PAGE_SIZE,
        })
        .then((r) => r.data as EmployeesPage),
    enabled: isOpen,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });

  const employees: AllEmployee[] = useMemo(
    () => employeesQuery.data?.employees ?? [],
    [employeesQuery.data],
  );
  const total = employeesQuery.data?.total ?? 0;
  const lastPage = employeesQuery.data?.last_page ?? 1;
  const showingFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(page * PAGE_SIZE, total);
  const hasMore = page < lastPage;
  // isPlaceholderData is true while the previous page is being shown
  // (i.e. during a "Load More" fetch). The "Loading more…" footer
  // spinner should appear then, not on the first load.
  const isLoadingMore =
    employeesQuery.isFetching && employeesQuery.isPlaceholderData;

  // Create mutation.
  const createMutation = useMutation({
    mutationFn: (payload: { name: string; user_ids: number[] }) =>
      payrollApi.assignEmployeesToPayGroup(payload).then((r) => r.data),
    onSuccess: (data) => {
      setCreatedName(data?.pay_group_name ?? name);
      setStep('success');
      // Refresh the pay-groups list (used elsewhere) and the
      // employee summaries so the new assignments are visible.
      queryClient.invalidateQueries({ queryKey: ['payroll', 'pay-groups'] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'all-employees'] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'dashboard'] });
    },
    onError: (err) => {
      // Stay on the configure step so the user can retry.
      // eslint-disable-next-line no-console
      console.error('Failed to create pay group', err);
    },
  });

  // Auto-close after the success view is shown briefly.
  useEffect(() => {
    if (step !== 'success') return;
    const t = setTimeout(() => {
      onCreated(createMutation.data?.pay_group_id ?? 0, createdName);
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const visibleIds = useMemo(
    () => new Set(employees.map((e) => e.id)),
    [employees],
  );

  const allVisibleSelected = useMemo(() => {
    if (employees.length === 0) return false;
    return employees.every((e) => selectedIds.has(e.id));
  }, [employees, selectedIds]);

  const someVisibleSelected = useMemo(
    () => employees.some((e) => selectedIds.has(e.id)),
    [employees, selectedIds],
  );

  function toggleOne(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        // Deselect the visible ones (keep ones not currently visible
        // — they live on other pages or were selected before).
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  }

  function loadMore() {
    if (hasMore && !employeesQuery.isFetching) {
      setPage((p) => p + 1);
    }
  }

  function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed || selectedIds.size === 0) return;
    createMutation.mutate({
      name: trimmed,
      user_ids: Array.from(selectedIds),
    });
  }

  if (!isOpen) return null;

  const canSubmit =
    name.trim().length > 0 &&
    selectedIds.size > 0 &&
    !createMutation.isPending;

  const apiErrorMessage = createMutation.isError
    ? getApiErrorMessage(
        createMutation.error,
        'Failed to create pay group. Please try again.',
      )
    : null;

  const employeesErrorMessage = employeesQuery.isError
    ? getApiErrorMessage(
        employeesQuery.error,
        'Failed to load employees. Please close and reopen the modal.',
      )
    : null;

  // Show the skeleton only on the very first page load (no data yet).
  // For subsequent "Load More" clicks, we keep the existing rows on
  // screen and show a small spinner below.
  const showInitialSkeleton =
    employeesQuery.isLoading && employees.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-6xl max-h-[95vh] flex flex-col">
        <header className="flex items-center justify-between p-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-600" />
            Create Pay Group
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {step === 'success' ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="rounded-full bg-emerald-50 p-3 mb-4">
              <CheckCircle className="h-10 w-10 text-emerald-600" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 mb-1">
              Pay group created
            </h3>
            <p className="text-sm text-slate-600">
              <span className="font-medium">{createdName}</span> was created
              with {selectedIds.size} employee
              {selectedIds.size === 1 ? '' : 's'} assigned.
            </p>
          </div>
        ) : (
          <>
            <div className="p-4 space-y-4 flex flex-col flex-1 min-h-0">
              {/* Name */}
              <div>
                <label
                  htmlFor="pay-group-name"
                  className="block text-xs font-medium text-slate-600 mb-1"
                >
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="pay-group-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Engineering Monthly"
                  maxLength={120}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Search */}
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by name, email, or designation..."
                    className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Select all row + result count */}
              <div className="flex items-center justify-between border-b border-slate-200 pb-2 gap-3 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected;
                    }}
                    onChange={toggleAllVisible}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="font-medium">
                    Select All ({selectedIds.size} of {total})
                  </span>
                </label>
                <div className="flex items-center gap-3">
                  {total > 0 && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                      Showing {showingFrom}–{showingTo} of {total} employees
                    </span>
                  )}
                  {selectedIds.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedIds(new Set())}
                      className="text-xs text-slate-500 hover:text-slate-700 underline"
                    >
                      Clear selection
                    </button>
                  )}
                </div>
              </div>

              {/* Employee list (table-style, fills remaining height) */}
              <div className="flex-1 min-h-0 border border-slate-200 rounded-lg overflow-hidden flex flex-col bg-white">
                {/* Sticky table-style header */}
                <div className="sticky top-0 z-10 grid grid-cols-[auto_minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,1fr)] gap-3 items-center px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 bg-slate-50 border-b border-slate-200">
                  <div className="w-4" />
                  <div>Name</div>
                  <div>Email</div>
                  <div>Designation</div>
                </div>

                {/* Body (scrollable) */}
                <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                  {showInitialSkeleton && <SkeletonRows count={10} />}

                  {!showInitialSkeleton && employeesErrorMessage && (
                    <div className="p-6 text-sm text-red-600 bg-red-50 border-b border-red-100">
                      {employeesErrorMessage}
                    </div>
                  )}

                  {!showInitialSkeleton &&
                    !employeesErrorMessage &&
                    employees.length === 0 && (
                      <div className="flex flex-col items-center justify-center p-10 text-center">
                        <div className="rounded-full bg-slate-100 p-3 mb-3">
                          <UserX className="h-6 w-6 text-slate-400" />
                        </div>
                        <h4 className="text-sm font-medium text-slate-700 mb-1">
                          No employees found
                        </h4>
                        <p className="text-xs text-slate-500 max-w-xs">
                          {deferredSearch
                            ? 'Try a different search term.'
                            : 'No employees are available in this organization yet.'}
                        </p>
                      </div>
                    )}

                  {!showInitialSkeleton &&
                    !employeesErrorMessage &&
                    employees.map((emp) => {
                      const checked = selectedIds.has(emp.id);
                      return (
                        <label
                          key={emp.id}
                          className={`grid grid-cols-[auto_minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,1fr)] gap-3 items-center px-3 py-2.5 cursor-pointer hover:bg-slate-50 transition-colors ${
                            checked ? 'bg-blue-50' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleOne(emp.id)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          <div className="text-sm font-medium text-slate-900 truncate">
                            {emp.name}
                          </div>
                          <div className="text-xs text-slate-500 truncate">
                            {emp.email}
                          </div>
                          <div className="text-xs text-slate-500 truncate">
                            {emp.designation ?? emp.role}
                          </div>
                        </label>
                      );
                    })}

                  {isLoadingMore && (
                    <div className="flex items-center justify-center py-3 text-sm text-slate-500">
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Loading more…
                    </div>
                  )}
                </div>

                {/* Pagination footer */}
                {total > 0 && (
                  <div className="px-3 py-2 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-600">
                    <span>
                      Page {page} of {lastPage}
                    </span>
                    {hasMore ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={loadMore}
                        disabled={employeesQuery.isFetching}
                      >
                        Load More
                        <ChevronDown className="h-4 w-4 ml-1" />
                      </Button>
                    ) : (
                      <span className="text-slate-400">End of results</span>
                    )}
                  </div>
                )}
              </div>

              {apiErrorMessage && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
                  {apiErrorMessage}
                </div>
              )}
            </div>

            <footer className="p-4 border-t border-slate-200 flex items-center justify-between gap-3">
              <span className="text-sm text-slate-600">
                {selectedIds.size} employee
                {selectedIds.size === 1 ? '' : 's'} selected
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={!canSubmit}>
                  {createMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      Creating...
                    </>
                  ) : (
                    'Create & Assign'
                  )}
                </Button>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Skeleton placeholder rows shown while the first page of employees
 * loads. Mirrors the column widths of the real rows so the layout
 * doesn't jump.
 */
function SkeletonRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[auto_minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,1fr)] gap-3 items-center px-3 py-2.5 animate-pulse"
        >
          <div className="h-4 w-4 bg-slate-200 rounded" />
          <div className="h-3 bg-slate-200 rounded w-3/4" />
          <div className="h-3 bg-slate-200 rounded w-2/3" />
          <div className="h-3 bg-slate-200 rounded w-2/3" />
          <div className="h-3 bg-slate-200 rounded w-1/2" />
        </div>
      ))}
    </>
  );
}
