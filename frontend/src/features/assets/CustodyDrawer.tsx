import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import SlideOver from '@/features/employees/SlideOver';
import { assetsApi } from '@/services/assetsApi';
import type { Asset, AssetDetail } from '@/types/assets';
import { cn } from '@/utils/cn';
import { formatDate, formatDuration } from './assetUtils';

interface CustodyDrawerProps {
  asset: Asset;
  onClose: () => void;
}

/**
 * Where this asset has been.
 *
 * `GET /assets/{id}` has always returned every assignment with the person who
 * received it, the person who authorised it, and the date it came back. The
 * endpoint, the `AssetDetail` type and the history type all existed; nothing
 * ever called them. This is that data, finally on screen.
 */
export default function CustodyDrawer({ asset, onClose }: CustodyDrawerProps) {
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError('');

    assetsApi
      .get(asset.id)
      .then((response) => {
        if (!cancelled) setDetail(response.data.data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this asset’s history.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [asset.id]);

  const history = detail?.history ?? [];

  return (
    <SlideOver
      open
      onClose={onClose}
      title={asset.name}
      subtitle={`${asset.asset_tag}${asset.serial_number ? ` · SN ${asset.serial_number}` : ''}`}
    >
      <div className="space-y-5">
        <dl className="grid grid-cols-2 gap-2">
          {[
            { label: 'Category', value: asset.category || '—' },
            { label: 'Status', value: asset.status === 'assigned' ? 'Assigned' : 'Available' },
            { label: 'Purchased', value: formatDate(asset.purchase_date) },
            { label: 'In service', value: formatDuration(asset.purchase_date) },
          ].map((fact) => (
            <div key={fact.label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">{fact.label}</dt>
              <dd className="mt-1 truncate text-sm font-medium capitalize text-slate-950">{fact.value}</dd>
            </div>
          ))}
        </dl>

        <section>
          <h3 className="text-sm font-semibold text-slate-700">Chain of custody</h3>

          {isLoading ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-slate-600">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Loading history...
            </p>
          ) : error ? (
            <p className="mt-3 text-sm text-rose-700">{error}</p>
          ) : history.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">
              This asset has never been assigned — it has been in the store since it was added.
            </p>
          ) : (
            <ol className="mt-3 space-y-4 border-l-2 border-slate-200 pl-4">
              {history.map((entry) => (
                <li key={entry.id} className="relative">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute -left-[22px] top-1.5 h-2.5 w-2.5 rounded-full border-2',
                      entry.is_active ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-surface-card'
                    )}
                  />
                  <p className="text-sm font-semibold text-slate-950">{entry.user?.name ?? 'Unknown holder'}</p>
                  <p className="mt-0.5 text-xs tabular-nums text-slate-600">
                    {formatDate(entry.assigned_date)}
                    {entry.is_active ? (
                      <>
                        {' → '}
                        <span className="font-semibold text-blue-700">now</span>
                        {' · '}
                        {formatDuration(entry.assigned_date)}
                      </>
                    ) : (
                      <> → {formatDate(entry.returned_date)}</>
                    )}
                  </p>
                  {entry.assigned_by ? (
                    <p className="mt-0.5 text-xs text-slate-600">Assigned by {entry.assigned_by.name}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </SlideOver>
  );
}
