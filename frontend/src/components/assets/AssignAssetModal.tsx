import { useEffect, useState } from 'react';
import { X, UserPlus } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { assetsApi } from '@/services/assetsApi';
import { userApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import { FieldLabel } from '@/components/ui/FormField';
import EmployeeSelect from '@/components/ui/EmployeeSelect';
import type { Asset } from '@/types/assets';

interface AssignAssetModalProps {
  isOpen: boolean;
  onClose: () => void;
  asset: Asset | null;
  onSuccess?: () => void;
}

export default function AssignAssetModal({ isOpen, onClose, asset, onSuccess }: AssignAssetModalProps) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedId('');
      setError(null);
    }
  }, [isOpen]);

  const employeesQuery = useQuery({
    queryKey: ['assets-employee-picker'],
    queryFn: async () => (await userApi.getAll({ simple: true })).data,
    enabled: isOpen,
    staleTime: 60_000,
  });

  const employees = (employeesQuery.data ?? []).map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role_name ?? u.role ?? null,
  }));

  const mutation = useMutation({
    mutationFn: () => {
      if (!asset || typeof selectedId !== 'number') {
        throw new Error('Select an employee first.');
      }
      return assetsApi.assign(asset.id, selectedId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['assets'] });
      if (asset) {
        await queryClient.invalidateQueries({ queryKey: ['asset', asset.id] });
      }
      await queryClient.invalidateQueries({ queryKey: ['employee-assets'] });
      onSuccess?.();
      onClose();
    },
    onError: (err) => {
      setError(getApiErrorMessage(err, 'Could not assign asset. Please try again.'));
    },
  });

  if (!isOpen || !asset) return null;

  const canSubmit = typeof selectedId === 'number' && !mutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col">
        <header className="flex items-center justify-between p-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-[#5D969D]" />
            Assign Asset
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="p-5 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">{asset.name}</p>
            <p className="text-xs text-slate-500">
              {asset.asset_tag} &middot; {asset.category}
            </p>
          </div>

          {error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          <div>
            <FieldLabel>Assign To Employee</FieldLabel>
            <EmployeeSelect
              employees={employees}
              value={selectedId}
              onChange={(value) => setSelectedId(value)}
              placeholder={employeesQuery.isLoading ? 'Loading employees...' : 'Choose employee'}
              disabled={employeesQuery.isLoading}
            />
            {employeesQuery.isError ? (
              <p className="mt-1 text-xs text-rose-600">Could not load employees. Please reopen the dialog.</p>
            ) : null}
          </div>
        </div>

        <footer className="flex items-center justify-end gap-3 border-t border-slate-200 p-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={() => mutation.mutate()} disabled={!canSubmit} loading={mutation.isPending}>
            Assign
          </Button>
        </footer>
      </div>
    </div>
  );
}
