import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { productivityClassificationApi } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { hasStrictAdminAccess } from '@/lib/permissions';
import MonitoringAlertRules from '../components/MonitoringAlertRules';
import { useToast } from '@/components/ui/Toast';
import Button from '@/components/ui/Button';
import { TextInput } from '@/components/ui/FormField';
import type { ProductivityClassificationItem } from '@/types';
import SettingsCard from '../components/SettingsCard';
import SegmentedControl from '../components/SegmentedControl';
import { LIST_PAGE_SIZE } from '@/lib/pagination';

type Classification = 'productive' | 'neutral' | 'unproductive';

const CLASSIFICATION_OPTIONS = [
  { value: 'productive' as const, label: 'Productive', tone: 'success' as const },
  { value: 'neutral' as const, label: 'Neutral', tone: 'neutral' as const },
  { value: 'unproductive' as const, label: 'Unproductive', tone: 'danger' as const },
];

const PERIODS = [
  { value: '1', label: 'Today' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
];

export default function ProductivityPane() {
  const toast = useToast();
  const { user } = useAuth();
  const [items, setItems] = useState<ProductivityClassificationItem[]>([]);
  const [meta, setMeta] = useState<Record<string, any>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [days, setDays] = useState('7');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isBulkSaving, setIsBulkSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const res = await productivityClassificationApi.history({
        search: submittedSearch || undefined,
        classification: filter || undefined,
        days: Number(days),
        page,
        per_page: LIST_PAGE_SIZE,
      });
      setItems(res.data.data || []);
      setMeta(res.data.meta || {});
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to load productivity history');
    } finally {
      setIsLoading(false);
    }
  }, [submittedSearch, filter, days, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const classify = async (item: ProductivityClassificationItem, classification: Classification) => {
    try {
      await productivityClassificationApi.create({
        target_type: item.target_type,
        target_value: item.target_value,
        classification,
      });
      toast.show({ kind: 'success', message: `${item.display_label} → ${classification}` });
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to update');
    }
  };

  const applyBulk = async (classification: Classification) => {
    const targets = items.filter((item) => selected.has(item.id));
    if (targets.length === 0) {
      return;
    }
    setIsBulkSaving(true);
    setError('');
    try {
      await productivityClassificationApi.batchUpdate({
        classification,
        items: targets.map((item) => ({ target_type: item.target_type, target_value: item.target_value })),
      });
      setSelected(new Set());
      await load();
      toast.show({ kind: 'success', message: `${targets.length} item${targets.length === 1 ? '' : 's'} set to ${classification}` });
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to update');
    } finally {
      setIsBulkSaving(false);
    }
  };

  const counts = meta?.classifications as { productive?: number; unproductive?: number; neutral?: number } | undefined;
  const allSelected = items.length > 0 && selected.size === items.length;

  return (
    <div className="space-y-4">
      {/*
        Sits with productivity because that is what these alerts are about: the
        same figures this page classifies, said out loud when they cross a line.
      */}
      <MonitoringAlertRules canManage={hasStrictAdminAccess(user)} />

      <p className="text-sm text-slate-600">
        Domains and apps your team visited. Classifying one here changes every report that counts it.
      </p>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <TextInput
            type="search"
            value={search}
            placeholder="Search domains or apps…"
            aria-label="Search domains or apps"
            className="pl-9"
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                setPage(1);
                setSubmittedSearch(search);
              }
            }}
          />
        </div>
        <SegmentedControl
          size="sm"
          ariaLabel="Filter by classification"
          value={filter}
          onChange={(value) => { setFilter(value); setPage(1); }}
          options={[
            { value: '', label: meta?.total != null ? `All ${meta.total}` : 'All' },
            { value: 'productive', label: counts?.productive != null ? `${counts.productive} productive` : 'Productive', tone: 'success' },
            { value: 'unproductive', label: counts?.unproductive != null ? `${counts.unproductive} unproductive` : 'Unproductive', tone: 'danger' },
            { value: 'neutral', label: counts?.neutral != null ? `${counts.neutral} neutral` : 'Neutral', tone: 'neutral' },
          ]}
        />
        <SegmentedControl
          size="sm"
          ariaLabel="Period"
          value={days}
          onChange={(value) => { setDays(value); setPage(1); }}
          options={PERIODS}
        />
      </div>

      {selected.size > 0 ? (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5">
          <span className="text-xs font-semibold text-blue-700">{selected.size} selected</span>
          <SegmentedControl
            size="sm"
            ariaLabel="Set classification for selected"
            value={'' as string}
            disabled={isBulkSaving}
            onChange={(value) => void applyBulk(value as Classification)}
            options={CLASSIFICATION_OPTIONS}
          />
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      ) : null}

      <SettingsCard bodyClassName="-mx-1 overflow-x-auto px-1">
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((index) => (
              <div key={index} className="h-12 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-600">No items found for the selected period.</p>
        ) : (
          <table className="w-full min-w-[46rem] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                <th className="w-10 px-2 py-2.5">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    className="h-4 w-4 rounded border-slate-300"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)))}
                  />
                </th>
                <th className="px-2 py-2.5 font-bold">Name</th>
                <th className="w-24 px-2 py-2.5 font-bold">Type</th>
                <th className="w-[19rem] px-2 py-2.5 font-bold">Classification</th>
                <th className="w-20 px-2 py-2.5 font-bold">People</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isSelected = selected.has(item.id);
                return (
                  <tr key={item.id} className={`border-b border-slate-100 last:border-b-0 ${isSelected ? 'bg-blue-50' : ''}`}>
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.display_label}`}
                        className="h-4 w-4 rounded border-slate-300"
                        checked={isSelected}
                        onChange={() => {
                          const next = new Set(selected);
                          if (next.has(item.id)) {
                            next.delete(item.id);
                          } else {
                            next.add(item.id);
                          }
                          setSelected(next);
                        }}
                      />
                    </td>
                    <td className="max-w-[16rem] truncate px-2 py-2 font-medium text-slate-900" title={item.display_label}>
                      {item.display_label}
                    </td>
                    <td className="px-2 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                        item.target_type === 'domain' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {item.target_type}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <SegmentedControl
                        size="sm"
                        ariaLabel={`Classify ${item.display_label}`}
                        value={item.current_classification as Classification}
                        onChange={(value) => void classify(item, value)}
                        options={CLASSIFICATION_OPTIONS}
                      />
                    </td>
                    <td className="px-2 py-2 tabular-nums text-slate-600">{item.user_count}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </SettingsCard>

      {meta.total_pages > 1 ? (
        <div className="flex items-center justify-center gap-3">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
            Previous
          </Button>
          <span className="text-xs text-slate-600">Page {meta.page} of {meta.total_pages}</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= (meta.total_pages || 1)}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
