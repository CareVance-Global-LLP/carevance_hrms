import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Plus, Search, Pencil, UserPlus, RotateCcw, Trash2 } from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import { FeedbackBanner, PageEmptyState, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { SelectInput, TextInput } from '@/components/ui/FormField';
import AssetFormModal from '@/components/assets/AssetFormModal';
import AssignAssetModal from '@/components/assets/AssignAssetModal';
import { assetsApi } from '@/services/assetsApi';
import { getApiErrorMessage } from '@/services/api';
import type { Asset, AssetFilters, AssetStatus } from '@/types/assets';

const formatDate = (value: string | null): string => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

export default function Assets() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<AssetStatus | ''>('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const [formModal, setFormModal] = useState<{ open: boolean; asset: Asset | null }>({ open: false, asset: null });
  const [assignModal, setAssignModal] = useState<{ open: boolean; asset: Asset | null }>({ open: false, asset: null });

  const filters: AssetFilters = useMemo(
    () => ({ search, status: statusFilter, category: categoryFilter }),
    [search, statusFilter, categoryFilter]
  );

  const assetsQuery = useQuery({
    queryKey: ['assets', filters],
    queryFn: async () => (await assetsApi.list(filters)).data.data,
  });

  const assets = assetsQuery.data ?? [];

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    assets.forEach((asset) => {
      if (asset.category) set.add(asset.category);
    });
    return Array.from(set).sort();
  }, [assets]);

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['assets'] }),
      queryClient.invalidateQueries({ queryKey: ['employee-assets'] }),
    ]);
  };

  const returnMutation = useMutation({
    mutationFn: (asset: Asset) => assetsApi.return(asset.id),
    onSuccess: async () => {
      setFeedback({ tone: 'success', message: 'Asset returned successfully.' });
      await invalidateAll();
    },
    onError: (err) => setFeedback({ tone: 'error', message: getApiErrorMessage(err, 'Could not return asset.') }),
  });

  const deleteMutation = useMutation({
    mutationFn: (asset: Asset) => assetsApi.remove(asset.id),
    onSuccess: async () => {
      setFeedback({ tone: 'success', message: 'Asset archived successfully.' });
      await invalidateAll();
    },
    onError: (err) => setFeedback({ tone: 'error', message: getApiErrorMessage(err, 'Could not archive asset.') }),
  });

  const handleReturn = (asset: Asset) => {
    if (window.confirm(`Return "${asset.name}" (${asset.asset_tag})?`)) {
      returnMutation.mutate(asset);
    }
  };

  const handleDelete = (asset: Asset) => {
    if (window.confirm(`Archive "${asset.name}" (${asset.asset_tag})? This removes it from the active registry.`)) {
      deleteMutation.mutate(asset);
    }
  };

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setCategoryFilter('');
  };

  const hasFilters = Boolean(search || statusFilter || categoryFilter);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="People"
        title="Assets"
        description="Company asset registry and employee assignments — laptops, phones, monitors, and more."
        actions={
          <Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => setFormModal({ open: true, asset: null })}>
            Add Asset
          </Button>
        }
      />

      {feedback ? (
        <FeedbackBanner tone={feedback.tone} message={feedback.message} onDismiss={() => setFeedback(null)} />
      ) : null}

      <SurfaceCard className="p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by tag, name, or serial number"
              className="pl-9"
            />
          </div>
          <div className="w-full md:w-48">
            <SelectInput value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as AssetStatus | '')}>
              <option value="">All statuses</option>
              <option value="available">Available</option>
              <option value="assigned">Assigned</option>
            </SelectInput>
          </div>
          <div className="w-full md:w-48">
            <SelectInput value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">All categories</option>
              {categoryOptions.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </SelectInput>
          </div>
          {hasFilters ? (
            <Button variant="secondary" onClick={clearFilters}>
              Clear
            </Button>
          ) : null}
        </div>
      </SurfaceCard>

      {assetsQuery.isLoading ? (
        <PageLoadingState label="Loading assets..." />
      ) : assetsQuery.isError ? (
        <PageErrorState
          message={getApiErrorMessage(assetsQuery.error, 'Failed to load assets.')}
          onRetry={() => void assetsQuery.refetch()}
        />
      ) : assets.length === 0 ? (
        <PageEmptyState
          title={hasFilters ? 'No assets match your filters' : 'No assets yet'}
          description={hasFilters ? 'Try adjusting your search or filters.' : 'Add your first company asset to get started.'}
          action={
            !hasFilters ? (
              <Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => setFormModal({ open: true, asset: null })}>
                Add Asset
              </Button>
            ) : (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            )
          }
        />
      ) : (
        <SurfaceCard className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  <th className="px-5 py-3">Tag</th>
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Category</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Assigned To</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {assets.map((asset) => (
                  <tr key={asset.id} className="transition hover:bg-slate-50/70">
                    <td className="px-5 py-3 font-medium text-slate-900">{asset.asset_tag}</td>
                    <td className="px-5 py-3 text-slate-700">
                      <div className="flex items-center gap-2">
                        <Package className="h-4 w-4 shrink-0 text-slate-400" />
                        <span>{asset.name}</span>
                      </div>
                      {asset.serial_number ? (
                        <p className="mt-0.5 text-xs text-slate-400">SN: {asset.serial_number}</p>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 text-slate-600 capitalize">{asset.category}</td>
                    <td className="px-5 py-3">
                      <StatusBadge tone={asset.status === 'assigned' ? 'info' : 'success'}>
                        {asset.status}
                      </StatusBadge>
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {asset.assigned_to ? (
                        <div>
                          <p className="font-medium text-slate-900">{asset.assigned_to.name}</p>
                          <p className="text-xs text-slate-400">Since {formatDate(asset.assigned_to.assigned_date)}</p>
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          iconLeft={<Pencil className="h-3.5 w-3.5" />}
                          onClick={() => setFormModal({ open: true, asset })}
                        >
                          Edit
                        </Button>
                        {asset.status === 'assigned' ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            iconLeft={<RotateCcw className="h-3.5 w-3.5" />}
                            onClick={() => handleReturn(asset)}
                            disabled={returnMutation.isPending}
                          >
                            Return
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            iconLeft={<UserPlus className="h-3.5 w-3.5" />}
                            onClick={() => setAssignModal({ open: true, asset })}
                          >
                            Assign
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          iconLeft={<Trash2 className="h-3.5 w-3.5" />}
                          onClick={() => handleDelete(asset)}
                          disabled={deleteMutation.isPending}
                        >
                          Archive
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SurfaceCard>
      )}

      <AssetFormModal
        isOpen={formModal.open}
        asset={formModal.asset}
        onClose={() => setFormModal({ open: false, asset: null })}
        onSuccess={() =>
          setFeedback({
            tone: 'success',
            message: formModal.asset ? 'Asset updated successfully.' : 'Asset added successfully.',
          })
        }
      />

      <AssignAssetModal
        isOpen={assignModal.open}
        asset={assignModal.asset}
        onClose={() => setAssignModal({ open: false, asset: null })}
        onSuccess={() => setFeedback({ tone: 'success', message: 'Asset assigned successfully.' })}
      />
    </div>
  );
}
