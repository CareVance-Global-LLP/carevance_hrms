import { useEffect, useState } from 'react';
import { X, Package } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { assetsApi } from '@/services/assetsApi';
import { getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import { FieldLabel, TextInput } from '@/components/ui/FormField';
import type { Asset, CreateAssetPayload } from '@/types/assets';

interface AssetFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  asset?: Asset | null;
  onSuccess?: () => void;
}

type FormState = {
  asset_tag: string;
  name: string;
  category: string;
  serial_number: string;
  purchase_date: string;
};

const emptyForm: FormState = {
  asset_tag: '',
  name: '',
  category: '',
  serial_number: '',
  purchase_date: '',
};

export default function AssetFormModal({ isOpen, onClose, asset, onSuccess }: AssetFormModalProps) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(asset);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    if (asset) {
      setForm({
        asset_tag: asset.asset_tag ?? '',
        name: asset.name ?? '',
        category: asset.category ?? '',
        serial_number: asset.serial_number ?? '',
        purchase_date: asset.purchase_date ?? '',
      });
    } else {
      setForm(emptyForm);
    }
  }, [isOpen, asset]);

  const mutation = useMutation({
    mutationFn: () => {
      const payload: CreateAssetPayload = {
        asset_tag: form.asset_tag.trim(),
        name: form.name.trim(),
        category: form.category.trim(),
        serial_number: form.serial_number.trim() ? form.serial_number.trim() : null,
        purchase_date: form.purchase_date ? form.purchase_date : null,
      };
      return isEdit && asset
        ? assetsApi.update(asset.id, payload)
        : assetsApi.create(payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['assets'] });
      if (asset) {
        await queryClient.invalidateQueries({ queryKey: ['asset', asset.id] });
      }
      onSuccess?.();
      onClose();
    },
    onError: (err) => {
      setError(getApiErrorMessage(err, 'Could not save asset. Please try again.'));
    },
  });

  if (!isOpen) return null;

  const canSubmit = form.asset_tag.trim() && form.name.trim() && form.category.trim() && !mutation.isPending;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    mutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <header className="flex items-center justify-between p-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Package className="h-5 w-5 text-blue-600" />
            {isEdit ? 'Edit Asset' : 'Add Asset'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-600 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="p-5 space-y-4 overflow-y-auto">
            {error ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            ) : null}

            <div>
              <FieldLabel>Asset Tag</FieldLabel>
              <TextInput
                value={form.asset_tag}
                onChange={(e) => setForm((c) => ({ ...c, asset_tag: e.target.value }))}
                placeholder="e.g. LAP-0012"
                required
              />
            </div>

            <div>
              <FieldLabel>Name</FieldLabel>
              <TextInput
                value={form.name}
                onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
                placeholder="e.g. Dell Latitude 5440"
                required
              />
            </div>

            <div>
              <FieldLabel>Category</FieldLabel>
              <TextInput
                value={form.category}
                onChange={(e) => setForm((c) => ({ ...c, category: e.target.value }))}
                placeholder="e.g. laptop, phone, monitor, accessory"
                list="asset-category-suggestions"
                required
              />
              <datalist id="asset-category-suggestions">
                <option value="laptop" />
                <option value="phone" />
                <option value="monitor" />
                <option value="accessory" />
                <option value="tablet" />
                <option value="headset" />
              </datalist>
            </div>

            <div>
              <FieldLabel>Serial Number</FieldLabel>
              <TextInput
                value={form.serial_number}
                onChange={(e) => setForm((c) => ({ ...c, serial_number: e.target.value }))}
                placeholder="Optional"
              />
            </div>

            <div>
              <FieldLabel>Purchase Date</FieldLabel>
              <TextInput
                type="date"
                value={form.purchase_date}
                onChange={(e) => setForm((c) => ({ ...c, purchase_date: e.target.value }))}
              />
            </div>
          </div>

          <footer className="flex items-center justify-end gap-3 border-t border-slate-200 p-4">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit} loading={mutation.isPending}>
              {isEdit ? 'Save Changes' : 'Add Asset'}
            </Button>
          </footer>
        </form>
      </div>
    </div>
  );
}
