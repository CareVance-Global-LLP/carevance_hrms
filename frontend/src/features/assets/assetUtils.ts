import type { Asset } from '@/types/assets';

export const formatDate = (value: string | null | undefined): string => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

/** Months between `from` and now, or null when there is no usable date. */
const monthsSince = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const now = Date.now();
  if (parsed.getTime() > now) return 0;
  return Math.floor((now - parsed.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
};

/** `1y 2m`, `3m`, or an em dash. Compact enough to sit in a table cell. */
export const formatDuration = (value: string | null | undefined): string => {
  const months = monthsSince(value);
  if (months === null) return '—';
  if (months < 1) return '<1m';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years && rest) return `${years}y ${rest}m`;
  if (years) return `${years}y`;
  return `${rest}m`;
};

/**
 * How long the current holder has had it. A laptop out for fourteen months is a
 * refresh conversation — nothing on the old page could tell you that.
 */
export const getHeldMonths = (asset: Asset): number | null =>
  asset.assigned_to ? monthsSince(asset.assigned_to.assigned_date) : null;

export const getServiceMonths = (asset: Asset): number | null => monthsSince(asset.purchase_date);

/** Past this, a held asset is flagged. Roughly a standard refresh cycle. */
export const LONG_HOLD_MONTHS = 12;

export type AssetSortKey = 'asset_tag' | 'name' | 'category' | 'status' | 'held' | 'service';
export type SortDirection = 'asc' | 'desc';

export const sortAssets = (assets: Asset[], key: AssetSortKey, direction: SortDirection): Asset[] => {
  const factor = direction === 'asc' ? 1 : -1;

  // Nulls always sort last regardless of direction — an asset with no purchase
  // date is not "the oldest".
  const byNumber = (a: number | null, b: number | null) => {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return (a - b) * factor;
  };

  return [...assets].sort((a, b) => {
    switch (key) {
      case 'held':
        return byNumber(getHeldMonths(a), getHeldMonths(b));
      case 'service':
        return byNumber(getServiceMonths(a), getServiceMonths(b));
      case 'status':
        return a.status.localeCompare(b.status) * factor;
      case 'category':
        return (a.category || '').localeCompare(b.category || '') * factor;
      case 'name':
        return a.name.localeCompare(b.name) * factor;
      default:
        return a.asset_tag.localeCompare(b.asset_tag, undefined, { numeric: true }) * factor;
    }
  });
};
