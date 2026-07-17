import { useState, useEffect } from 'react';
import {
  X,
  Loader2,
  CheckCircle,
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
import EmployeePickerList from './EmployeePickerList';

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
  const [step, setStep] = useState<'select' | 'success'>('select');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [assignedCount, setAssignedCount] = useState(0);

  const queryClient = useQueryClient();

  useEffect(() => {
    if (isOpen) {
      setSelectedIds([]);
      setStep('select');
      setAssignedCount(0);
    }
  }, [isOpen]);

  const assignMutation = useMutation({
    mutationFn: (userIds: number[]) =>
      payrollApi
        .assignEmployeeToExistingPayGroup({
          pay_group_id: payGroupId,
          user_ids: userIds,
        })
        .then((r) => r.data),
    onSuccess: (data) => {
      setAssignedCount(data?.assigned_count ?? selectedIds.length);
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

  const apiErrorMessage = assignMutation.isError
    ? getApiErrorMessage(
        assignMutation.error,
        'Failed to assign employees. Please try again.',
      )
    : null;

  if (!isOpen) return null;

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
<EmployeePickerList
             isOpen={true}
             onClose={onClose}
             title={`Add Employee to ${payGroupName}`}
             emptyMessage="All employees are already assigned to pay groups"
             onConfirm={(ids) => {
               setSelectedIds(ids);
               assignMutation.mutate(ids);
             }}
             isConfirming={assignMutation.isPending}
             queryKey={['payroll', 'unassigned-employees']}
             queryFn={() => payrollApi.getUnassignedEmployees().then((r) => ({
               employees: r.data?.employees ?? [],
               total: r.data?.employees?.length ?? 0,
               last_page: 1,
             }))}
             showPagination={false}
           />
        )}

        {step === 'select' && apiErrorMessage && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 mx-4 mb-4">
            {apiErrorMessage}
          </div>
        )}
      </div>
    </div>
  );
}