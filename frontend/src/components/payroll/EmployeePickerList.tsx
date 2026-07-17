import { useState, useMemo, useEffect, useDeferredValue } from 'react';
import {
  X,
  Loader2,
  Search,
  Users,
  UserX,
  ChevronDown,
} from 'lucide-react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import Button from '@/components/ui/Button';

import type { AllEmployee } from '@/types';

interface EmployeePickerListProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  emptySearchMessage?: string;
  confirmLabel?: string;
  onConfirm: (selectedIds: number[]) => void;
  isConfirming?: boolean;
  queryKey: unknown[];
  queryFn: () => Promise<{ employees: AllEmployee[]; total?: number; last_page?: number }>;
  showPagination?: boolean;
  extraColumns?: (emp: AllEmployee) => React.ReactNode;
}

const PAGE_SIZE = 50;

export default function EmployeePickerList({
  isOpen,
  onClose,
  title = 'Select Employees',
  searchPlaceholder = 'Search by name, email, or designation...',
  emptyMessage = 'No employees available.',
  emptySearchMessage = 'Try a different search term.',
  confirmLabel = 'Confirm',
  onConfirm,
  isConfirming = false,
  queryKey,
  queryFn,
  showPagination = true,
  extraColumns,
}: EmployeePickerListProps) {
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);

  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setSelectedIds(new Set());
      setPage(1);
    }
  }, [isOpen]);

  useEffect(() => {
    setPage(1);
  }, [deferredSearch]);

  const employeesQuery = useQuery({
    queryKey: [...queryKey, deferredSearch, page],
    queryFn,
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
  const isLoadingMore =
    employeesQuery.isFetching && employeesQuery.isPlaceholderData;

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

  if (!isOpen) return null;

  const showInitialSkeleton =
    employeesQuery.isLoading && employees.length === 0;

  const errorMessage = employeesQuery.isError
    ? (employeesQuery.error as any)?.response?.data?.message ||
      (employeesQuery.error as Error)?.message ||
      'Failed to load employees. Please close and reopen.'
    : null;

  const columnCount = extraColumns ? 4 : 3;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col">
        <header className="flex items-center justify-between p-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-600" />
            {title}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="p-4 space-y-4 flex flex-col flex-1 min-h-0">
          <div className="relative">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

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
                Select All ({selectedIds.size} selected)
              </span>
            </label>
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

          <div className="flex-1 min-h-0 border border-slate-200 rounded-lg overflow-hidden flex flex-col bg-white">
            <div
              className="sticky top-0 z-10 grid gap-3 items-center px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 bg-slate-50 border-b border-slate-200"
              style={{
                gridTemplateColumns: extraColumns
                  ? 'auto minmax(0,1.2fr) minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr)'
                  : 'auto minmax(0,1.5fr) minmax(0,1.5fr) minmax(0,1fr)',
              }}
            >
              <div className="w-4" />
              <div>Name</div>
              <div>Email</div>
              <div>Designation</div>
              {extraColumns && <div>Actions</div>}
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {showInitialSkeleton && <SkeletonRows count={5} hasActions={!!extraColumns} />}

              {!showInitialSkeleton && errorMessage && (
                <div className="p-6 text-sm text-red-600 bg-red-50 border-b border-red-100">
                  {errorMessage}
                </div>
              )}

              {!showInitialSkeleton &&
                !errorMessage &&
                employees.length === 0 && (
                  <div className="flex flex-col items-center justify-center p-10 text-center">
                    <div className="rounded-full bg-slate-100 p-3 mb-3">
                      <UserX className="h-6 w-6 text-slate-400" />
                    </div>
                    <h4 className="text-sm font-medium text-slate-700 mb-1">
                      No employees found
                    </h4>
                    <p className="text-xs text-slate-500 max-w-xs">
                      {deferredSearch ? emptySearchMessage : emptyMessage}
                    </p>
                  </div>
                )}

              {!showInitialSkeleton &&
                !errorMessage &&
                employees.map((emp) => {
                  const checked = selectedIds.has(emp.id);
                  return (
                    <label
                      key={emp.id}
                      className={`grid gap-3 items-center px-3 py-2.5 cursor-pointer hover:bg-slate-50 transition-colors ${
                        checked ? 'bg-blue-50' : ''
                      }`}
                      style={{
                        gridTemplateColumns: extraColumns
                          ? 'auto minmax(0,1.2fr) minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr)'
                          : 'auto minmax(0,1.5fr) minmax(0,1.5fr) minmax(0,1fr)',
                      }}
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
                      {extraColumns && <div>{extraColumns(emp)}</div>}
                    </label>
                  );
                })}

              {isLoadingMore && (
                <div className="flex items-center justify-center py-3 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Loading more...
                </div>
              )}
            </div>

            {showPagination && total > 0 && (
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
        </div>

        <footer className="p-4 border-t border-slate-200 flex items-center justify-between gap-3">
          <span className="text-sm text-slate-600">
            {selectedIds.size} employee{selectedIds.size === 1 ? '' : 's'} selected
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => onConfirm(Array.from(selectedIds))}
              disabled={selectedIds.size === 0 || isConfirming}
            >
              {isConfirming ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  Processing...
                </>
              ) : (
                confirmLabel
              )}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function SkeletonRows({ count, hasActions }: { count: number; hasActions?: boolean }) {
  const colCount = hasActions ? 4 : 3;
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="grid gap-3 items-center px-3 py-2.5 animate-pulse"
          style={{
            gridTemplateColumns: hasActions
              ? 'auto minmax(0,1.2fr) minmax(0,1.5fr) minmax(0,1fr) minmax(0,1fr)'
              : 'auto minmax(0,1.5fr) minmax(0,1.5fr) minmax(0,1fr)',
          }}
        >
          <div className="h-4 w-4 bg-slate-200 rounded" />
          <div className="h-3 bg-slate-200 rounded w-3/4" />
          <div className="h-3 bg-slate-200 rounded w-2/3" />
          <div className="h-3 bg-slate-200 rounded w-2/3" />
          {hasActions && <div className="h-3 bg-slate-200 rounded w-1/2" />}
        </div>
      ))}
    </>
  );
}