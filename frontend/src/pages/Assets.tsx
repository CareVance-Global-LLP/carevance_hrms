import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Package, Pencil, Plus, RotateCcw, Search, Trash2, UserPlus } from 'lucide-react';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import StatusBadge from '@/components/ui/StatusBadge';
import { FeedbackBanner, PageEmptyState, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { SelectInput } from '@/components/ui/FormField';
import AssetFormModal from '@/components/assets/AssetFormModal';
import AssignAssetModal from '@/components/assets/AssignAssetModal';
import CustodyDrawer from '@/features/assets/CustodyDrawer';
import {
  LONG_HOLD_MONTHS,
  formatDuration,
  getHeldMonths,
  sortAssets,
  type AssetSortKey,
  type SortDirection,
} from '@/features/assets/assetUtils';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { assetsApi } from '@/services/assetsApi';
import { getApiErrorMessage } from '@/services/api';
import { useComposeAction } from '@/hooks/useComposeAction';
import { COMPOSE_KEYS } from '@/lib/commandRegistry';
import type { Asset, AssetStatus } from '@/types/assets';
import { cn } from '@/utils/cn';

const PAGE_SIZE = 25;

interface Column {
  key: AssetSortKey | null;
  label: string;
  className?: string;
}

const COLUMNS: Column[] = [
  { key: 'asset_tag', label: 'Tag' },
  { key: 'name', label: 'Asset' },
  { key: 'category', label: 'Category' },
  { key: 'status', label: 'Status' },
  { key: null, label: 'Held by' },
  { key: 'held', label: 'Held for' },
  { key: 'service', label: 'In service' },
];

export default function Assets() {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<AssetStatus | ''>('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: AssetSortKey; direction: SortDirection }>({
    key: 'asset_tag',
    direction: 'asc',
  });

  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [formModal, setFormModal] = useState<{ open: boolean; asset: Asset | null }>({ open: false, asset: null });
  const [assignModal, setAssignModal] = useState<{ open: boolean; asset: Asset | null }>({ open: false, asset: null });
  const [custodyAsset, setCustodyAsset] = useState<Asset | null>(null);
  const [pendingReturn, setPendingReturn] = useState<Asset | null>(null);
  const [pendingArchive, setPendingArchive] = useState<Asset | null>(null);

  useComposeAction(COMPOSE_KEYS.asset, () => setFormModal({ open: true, asset: null }));

  // Search trails the input, so typing no longer fires a request per keystroke.
  const debouncedSearch = useDebouncedValue(search, 300);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter, categoryFilter]);

  const assetsQuery = useQuery({
    queryKey: ['assets', { search: debouncedSearch, status: statusFilter, category: categoryFilter, page }],
    queryFn: async () =>
      (
        await assetsApi.list({
          search: debouncedSearch,
          status: statusFilter,
          category: categoryFilter,
          page,
          per_page: PAGE_SIZE,
        })
      ).data,
  });

  const assets = assetsQuery.data?.data ?? [];
  // Categories come from the server across the whole organization. Deriving
  // them from the rows on screen meant choosing "Laptop" left "Laptop" as the
  // only option, with no way back except clearing every filter.
  const categoryOptions = assetsQuery.data?.categories ?? [];
  const meta = assetsQuery.data?.meta;

  const visible = useMemo(() => sortAssets(assets, sort.key, sort.direction), [assets, sort]);

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['assets'] }),
      queryClient.invalidateQueries({ queryKey: ['employee-assets'] }),
    ]);
  };

  const returnMutation = useMutation({
    mutationFn: (asset: Asset) => assetsApi.return(asset.id),
    onSuccess: async () => {
      setFeedback({ tone: 'success', message: 'Asset returned to the store.' });
      setPendingReturn(null);
      await invalidateAll();
    },
    onError: (error) => setFeedback({ tone: 'error', message: getApiErrorMessage(error, 'Could not return asset.') }),
  });

  const deleteMutation = useMutation({
    mutationFn: (asset: Asset) => assetsApi.remove(asset.id),
    onSuccess: async () => {
      setFeedback({ tone: 'success', message: 'Asset archived.' });
      setPendingArchive(null);
      await invalidateAll();
    },
    onError: (error) => setFeedback({ tone: 'error', message: getApiErrorMessage(error, 'Could not archive asset.') }),
  });

  const toggleSort = (key: AssetSortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: key === 'held' || key === 'service' ? 'desc' : 'asc' }
    );
  };

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setCategoryFilter('');
  };

  const hasFilters = Boolean(search || statusFilter || categoryFilter);
  const total = meta?.total ?? assets.length;
  const longHolds = assets.filter((asset) => (getHeldMonths(asset) ?? 0) >= LONG_HOLD_MONTHS).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-[-0.03em] text-slate-950">Assets</h1>
        <p className="text-sm text-slate-600">
          <span className="font-medium text-slate-700">{total}</span> in the register
          {longHolds > 0 ? (
            <>
              {' · '}
              <span className="font-medium text-amber-700">{longHolds}</span> held over a year
            </>
          ) : null}
        </p>
      </div>

      {feedback ? (
        <FeedbackBanner tone={feedback.tone} message={feedback.message} onDismiss={() => setFeedback(null)} />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label="Search assets"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by tag, name, or serial number"
            className="min-h-10 w-full rounded-lg border border-slate-200 bg-surface-card pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-600 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-sky-300"
          />
        </div>

        <SelectInput
          className="w-40"
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as AssetStatus | '')}
        >
          <option value="">All statuses</option>
          <option value="available">Available</option>
          <option value="assigned">Assigned</option>
        </SelectInput>

        <SelectInput
          className="w-44"
          aria-label="Filter by category"
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}
        >
          <option value="">All categories</option>
          {categoryOptions.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </SelectInput>

        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear
          </Button>
        ) : null}

        <Button size="sm" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setFormModal({ open: true, asset: null })}>
          Add asset
        </Button>
      </div>

      {assetsQuery.isLoading ? (
        <PageLoadingState label="Loading assets..." />
      ) : assetsQuery.isError ? (
        <PageErrorState
          message={getApiErrorMessage(assetsQuery.error, 'Failed to load assets.')}
          onRetry={() => void assetsQuery.refetch()}
        />
      ) : visible.length === 0 ? (
        <PageEmptyState
          title={hasFilters ? 'No assets match your filters' : 'No assets yet'}
          description={hasFilters ? 'Try a different search or filter.' : 'Add your first company asset to get started.'}
          action={
            hasFilters ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => setFormModal({ open: true, asset: null })}>
                Add asset
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-surface-card">
            <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  {COLUMNS.map((column) => {
                    const active = column.key && sort.key === column.key;
                    return (
                      <th
                        key={column.label}
                        scope="col"
                        aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                        className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600"
                      >
                        {column.key ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(column.key as AssetSortKey)}
                            className="inline-flex items-center gap-1 transition hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                          >
                            {column.label}
                            {active ? (
                              sort.direction === 'asc' ? (
                                <ArrowUp className="h-3 w-3" aria-hidden="true" />
                              ) : (
                                <ArrowDown className="h-3 w-3" aria-hidden="true" />
                              )
                            ) : null}
                          </button>
                        ) : (
                          column.label
                        )}
                      </th>
                    );
                  })}
                  <th scope="col" className="px-3 py-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((asset) => {
                  const heldMonths = getHeldMonths(asset);
                  const longHold = (heldMonths ?? 0) >= LONG_HOLD_MONTHS;

                  return (
                    <tr key={asset.id} className="group border-b border-slate-100 transition last:border-0 hover:bg-blue-50/40">
                      <td className="px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => setCustodyAsset(asset)}
                          className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-xs text-slate-800 transition hover:border-blue-300 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                          title="View chain of custody"
                        >
                          {asset.asset_tag}
                        </button>
                      </td>
                      <td className="px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => setCustodyAsset(asset)}
                          className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                        >
                          <span className="flex items-center gap-2 font-medium text-slate-950">
                            <Package className="h-3.5 w-3.5 shrink-0 text-slate-600" aria-hidden="true" />
                            {asset.name}
                          </span>
                          {asset.serial_number ? (
                            <span className="mt-0.5 block text-xs text-slate-600">SN {asset.serial_number}</span>
                          ) : null}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 capitalize text-slate-700">{asset.category}</td>
                      <td className="px-3 py-2.5">
                        <StatusBadge tone={asset.status === 'assigned' ? 'info' : 'success'}>{asset.status}</StatusBadge>
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">
                        {asset.assigned_to ? asset.assigned_to.name : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={cn(
                            'text-xs tabular-nums',
                            longHold ? 'font-semibold text-amber-700' : 'text-slate-600'
                          )}
                          title={longHold ? 'Held longer than a standard refresh cycle' : undefined}
                        >
                          {asset.assigned_to ? formatDuration(asset.assigned_to.assigned_date) : '—'}
                        </span>
                      </td>
                      {/* Purchase date has been collected by the form since day
                          one and rendered nowhere until now. */}
                      <td className="px-3 py-2.5 text-xs tabular-nums text-slate-600">
                        {formatDuration(asset.purchase_date)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-0.5 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
                          <button
                            type="button"
                            aria-label={`Edit ${asset.name}`}
                            onClick={() => setFormModal({ open: true, asset })}
                            className="rounded p-1.5 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {asset.status === 'assigned' ? (
                            <button
                              type="button"
                              aria-label={`Return ${asset.name}`}
                              onClick={() => setPendingReturn(asset)}
                              className="rounded p-1.5 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              aria-label={`Assign ${asset.name}`}
                              onClick={() => setAssignModal({ open: true, asset })}
                              className="rounded p-1.5 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
                            >
                              <UserPlus className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {/* Kept a gap from the routine actions — this used to
                              sit flush against Edit. */}
                          <button
                            type="button"
                            aria-label={`Archive ${asset.name}`}
                            onClick={() => setPendingArchive(asset)}
                            className="ml-1.5 rounded p-1.5 text-slate-600 transition hover:bg-rose-50 hover:text-rose-700"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {meta && meta.last_page > 1 ? (
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-surface-card px-3 py-2 text-sm text-slate-600">
              <span>
                Page {meta.current_page} of {meta.last_page} · {meta.total} assets
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={meta.current_page <= 1 || assetsQuery.isFetching}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={meta.current_page >= meta.last_page || assetsQuery.isFetching}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}

      <AssetFormModal
        isOpen={formModal.open}
        asset={formModal.asset}
        onClose={() => setFormModal({ open: false, asset: null })}
        onSuccess={() =>
          setFeedback({
            tone: 'success',
            message: formModal.asset ? 'Asset updated.' : 'Asset added.',
          })
        }
      />

      <AssignAssetModal
        isOpen={assignModal.open}
        asset={assignModal.asset}
        onClose={() => setAssignModal({ open: false, asset: null })}
        onSuccess={() => setFeedback({ tone: 'success', message: 'Asset assigned.' })}
      />

      {custodyAsset ? <CustodyDrawer asset={custodyAsset} onClose={() => setCustodyAsset(null)} /> : null}

      <ConfirmDialog
        isOpen={Boolean(pendingReturn)}
        title="Return this asset?"
        message={
          pendingReturn
            ? `"${pendingReturn.name}" (${pendingReturn.asset_tag}) goes back to the store and ${
                pendingReturn.assigned_to?.name ?? 'the current holder'
              } stops holding it. The assignment stays in its history.`
            : ''
        }
        confirmLabel="Return asset"
        isLoading={returnMutation.isPending}
        onClose={() => setPendingReturn(null)}
        onConfirm={() => {
          if (pendingReturn) returnMutation.mutate(pendingReturn);
        }}
      />

      <ConfirmDialog
        isOpen={Boolean(pendingArchive)}
        tone="danger"
        title="Archive this asset?"
        message={
          pendingArchive
            ? `"${pendingArchive.name}" (${pendingArchive.asset_tag}) is removed from the active register. Its assignment history is kept.`
            : ''
        }
        confirmLabel="Archive asset"
        isLoading={deleteMutation.isPending}
        onClose={() => setPendingArchive(null)}
        onConfirm={() => {
          if (pendingArchive) deleteMutation.mutate(pendingArchive);
        }}
      />
    </div>
  );
}
