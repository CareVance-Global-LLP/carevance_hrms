import { useState, useEffect, useMemo, useDeferredValue } from 'react';
import {
  X,
  Loader2,
  CheckCircle,
  Search,
  Users,
  UserX,
} from 'lucide-react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import type { AllEmployee } from '@/types';

interface AddEmployeeToPayGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  payGroupId: number;
  payGroupName: string;
  onSuccess: () => void;
}

export default function AddEmployeeToPayGroupModal({
  isOpen,
  onClose,
  payGroupId,
  payGroupName,
  onSuccess,
}: AddEmployeeToPayGroupModalProps) {
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [step, setStep] = useState<'select' | 'success'>('select');
  const [assignedCount, setAssignedCount] = useState(0);

  const deferredSearch = useDeferredValue(search);

  const queryClient = useQueryClient();

  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setSelectedIds(new Set());
      setStep('select');
      setAssignedCount(0);
    }
  }, [isOpen]);

  const unassignedQuery = useQuery({
    queryKey: ['payroll', 'unassigned-employees', deferredSearch],
    queryFn: () => payrollApi.getUnassignedEmployees().then((r) => r.data),
    enabled: isOpen,
    staleTime: 30_000,
  });

  const employees: AllEmployee[] = useMemo(() => {
    const list = unassignedQuery.data?.employees ?? [];
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        (e.designation ?? '').toLowerCase().includes(q),
    );
  }, [unassignedQuery.data, deferredSearch]);

  const assignMutation = useMutation({
    mutationFn: (userIds: number[]) =>
      payrollApi
        .assignEmployeeToExistingPayGroup({
          pay_group_id: payGroupId,
          user_ids: userIds,
        })
        .then((r) => r.data),
    onSuccess: (data) => {
      setAssignedCount(data?.assigned_count ?? selectedIds.size);
      setStep('success');
      queryClient.invalidateQueries({
        queryKey: ['payroll', 'pay-group', payGroupId, 'employees'],
      });
      queryClient.invalidateQueries({
        queryKey: ['payroll', 'unassigned-employees'],
      });
      queryClient.invalidateQueries({
        queryKey: ['payroll', 'dashboard'],
      });
    },
    onError: (err) => {
      console.error('Failed to assign employees', err);
    },
  });

  useEffect(() => {
    if (step !== 'success') return;
    const t = setTimeout(() => {
      onSuccess();
    }, 1500);
    return () => clearTimeout(t);
  }, [step, onSuccess]);

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

  function handleSubmit() {
    if (selectedIds.size === 0 || assignMutation.isPending) return;
    assignMutation.mutate(Array.from(selectedIds));
  }

  if (!isOpen) return null;

  const canSubmit = selectedIds.size > 0 && !assignMutation.isPending;

  const apiErrorMessage =
    assignMutation.isError
      ? getApiErrorMessage(
          assignMutation.error,
          'Failed to assign employees. Please try again.',
        )
      : null;

  const fetchErrorMessage =
    unassignedQuery.isError
      ? getApiErrorMessage(
          unassignedQuery.error,
          'Failed to load employees. Please close and reopen.',
        )
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <header className="flex items-center justify-between p-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-600" />
            Add Employee to {payGroupName}
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
              Employees added
            </h3>
            <p className="text-sm text-slate-600">
              {assignedCount} employee{assignedCount === 1 ? '' : 's'} assigned to{' '}
              <span className="font-medium">{payGroupName}</span>.
            </p>
          </div>
        ) : (
          <>
            <div className="p-4 space-y-4 flex flex-col flex-1 min-h-0">
              <div className="relative">
                <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, email, or designation..."
                  className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="flex items-center justify-between border-b border-slate-200 pb-2 gap-3 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el)
                        el.indeterminate =
                          !allVisibleSelected && someVisibleSelected;
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
                <div className="sticky top-0 z-10 grid grid-cols-[auto_minmax(0,1.5fr)_minmax(0,1.5fr)_minmax(0,1fr)] gap-3 items-center px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 bg-slate-50 border-b border-slate-200">
                  <div className="w-4" />
                  <div>Name</div>
                  <div>Email</div>
                  <div>Designation</div>
                </div>

                <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                  {unassignedQuery.isLoading && employees.length === 0 && (
                    <div className="p-6 text-sm text-slate-500 text-center">
                      <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                      Loading employees…
                    </div>
                  )}

                  {!unassignedQuery.isLoading && fetchErrorMessage && (
                    <div className="p-6 text-sm text-red-600 bg-red-50 border-b border-red-100">
                      {fetchErrorMessage}
                    </div>
                  )}

                  {!unassignedQuery.isLoading &&
                    !fetchErrorMessage &&
                    employees.length === 0 && (
                      <div className="flex flex-col items-center justify-center p-10 text-center">
                        <div className="rounded-full bg-slate-100 p-3 mb-3">
                          <UserX className="h-6 w-6 text-slate-400" />
                        </div>
                        <h4 className="text-sm font-medium text-slate-700 mb-1">
                          All employees are already assigned to pay groups
                        </h4>
                        <p className="text-xs text-slate-500 max-w-xs">
                          {deferredSearch
                            ? 'Try a different search term.'
                            : 'There are no unassigned employees in this organization.'}
                        </p>
                      </div>
                    )}

                  {!unassignedQuery.isLoading &&
                    !fetchErrorMessage &&
                    employees.map((emp) => {
                      const checked = selectedIds.has(emp.id);
                      return (
                        <label
                          key={emp.id}
                          className={`grid grid-cols-[auto_minmax(0,1.5fr)_minmax(0,1.5fr)_minmax(0,1fr)] gap-3 items-center px-3 py-2.5 cursor-pointer hover:bg-slate-50 transition-colors ${
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
                </div>
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
                <Button onClick={handleSubmit} disabled={!canSubmit}>
                  {assignMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      Assigning…
                    </>
                  ) : (
                    'Add to Pay Group'
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
