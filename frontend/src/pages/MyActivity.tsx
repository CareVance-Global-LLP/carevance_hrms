import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Clock, Eye, Info, ShieldCheck, Trash2 } from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { PageErrorState, PageLoadingState, PageEmptyState } from '@/components/ui/PageState';
import { useAuth } from '@/contexts/AuthContext';
import { activityApi, screenshotApi } from '@/services/api';
import { resolveTrackerPolicy } from '@/lib/trackerPolicy';
import { reportSilentError } from '@/lib/reportSilentError';

/**
 * What the tracker recorded about you — for you.
 *
 * The monitoring console has always existed for managers; the person being
 * monitored had no way to see their own data at all. That is a right under the
 * DPDP Act and GDPR Article 15 rather than a courtesy, and it is also the
 * cheapest trust signal the product can offer: the same screenshots, the same
 * idle log, shown to the person they are about.
 *
 * Deliberately NOT a reskin of MonitoringWorkspace. That page is a supervision
 * tool — user pickers, bulk delete, cross-team filters. This one answers a
 * different question ("what do you have on me?") and so it leads with the
 * policy in force, not with a filter bar.
 */

const RANGE_OPTIONS = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
] as const;

const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatDuration = (seconds?: number | null) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${total}s`;
};

const minutesLabel = (minutes: number) => {
  if (minutes === 1) return 'every minute';
  if (minutes < 60) return `every ${minutes} minutes`;
  const hours = minutes / 60;
  return `every ${hours === 1 ? 'hour' : `${hours} hours`}`;
};

/** One screenshot tile. Fetches its own signed image and revokes it on unmount. */
function ScreenshotTile({
  shot,
  canDelete,
  onDelete,
  isDeleting,
}: {
  shot: any;
  canDelete: boolean;
  onDelete: (shot: any) => void;
  isDeleting: boolean;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked = false;
    let url: string | null = null;

    const signedPath = shot?.file_url || shot?.url || shot?.signed_url;
    if (!signedPath) {
      setFailed(true);
      return undefined;
    }

    screenshotApi
      .fetchFileObjectUrl(signedPath)
      .then((next) => {
        if (revoked) {
          URL.revokeObjectURL(next);
          return;
        }
        url = next;
        setObjectUrl(next);
      })
      .catch((error) => {
        reportSilentError('my-activity-screenshot', error);
        setFailed(true);
      });

    return () => {
      revoked = true;
      // The object URL is ours to release; leaving it allocated leaks the
      // decoded image for as long as the tab lives.
      if (url) URL.revokeObjectURL(url);
    };
  }, [shot?.id, shot?.file_url, shot?.url, shot?.signed_url]);

  return (
    <figure className="m-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="aspect-video w-full bg-slate-100">
        {objectUrl && !failed ? (
          <img
            src={objectUrl}
            alt={`Screen captured at ${formatDateTime(shot?.captured_at || shot?.created_at)}`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
            {failed ? 'Image unavailable' : 'Loading…'}
          </div>
        )}
      </div>
      <figcaption className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-slate-500">
        <span>{formatDateTime(shot?.captured_at || shot?.created_at)}</span>
        {canDelete && (
          <button
            type="button"
            onClick={() => onDelete(shot)}
            disabled={isDeleting}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-slate-500 transition hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Delete
          </button>
        )}
      </figcaption>
    </figure>
  );
}

export default function MyActivity() {
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [rangeDays, setRangeDays] = useState<number>(7);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const policy = useMemo(() => resolveTrackerPolicy(user as any), [user]);

  const range = useMemo(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (rangeDays - 1));
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return { start_date: iso(start), end_date: iso(end) };
  }, [rangeDays]);

  const {
    data: screenshots,
    isLoading: isScreenshotsLoading,
    isError: isScreenshotsError,
  } = useQuery({
    queryKey: ['my-activity', 'screenshots', range.start_date, range.end_date],
    // No user_id: the API scopes a non-manager to their own captures already,
    // and passing one would invite the page to be pointed at someone else.
    queryFn: async () => (await screenshotApi.getAll({ ...range, per_page: 24 })).data,
    enabled: isAuthenticated && !isAuthLoading,
  });

  const { data: idleRows, isLoading: isIdleLoading } = useQuery({
    queryKey: ['my-activity', 'idle', range.start_date, range.end_date],
    queryFn: async () => {
      const res = await activityApi.getAll({ ...range, per_page: 10 } as any);
      const rows = (res.data as any)?.data ?? res.data ?? [];
      return (Array.isArray(rows) ? rows : []).filter((row: any) => row?.type === 'idle');
    },
    enabled: isAuthenticated && !isAuthLoading,
  });

  const deleteScreenshot = useMutation({
    mutationFn: async (shot: any) => (await screenshotApi.delete(shot.id)).data,
    onSuccess: (data) => {
      const removed = Number(data?.tracked_seconds_removed) || 0;
      setDeleteNotice(
        removed > 0
          ? `Screenshot deleted. ${formatDuration(removed)} of tracked time was removed with it.`
          : 'Screenshot deleted.'
      );
      queryClient.invalidateQueries({ queryKey: ['my-activity', 'screenshots'] });
    },
    onError: (error) => {
      reportSilentError('my-activity-delete', error);
      setDeleteNotice('That screenshot could not be deleted. Please try again.');
    },
  });

  const handleDelete = (shot: any) => {
    // The confirm states the cost up front. Deleting a capture also gives back
    // the minutes it stood for, and someone should never discover that after
    // the fact by finding their timesheet shorter than they expected.
    const cost = formatDuration(policy.capture_interval_minutes * 60);
    const confirmed = window.confirm(
      `Delete this screenshot?

The tracked time it covers (up to ${cost}) will be removed from your timesheet as well. This cannot be undone.`
    );
    if (!confirmed) return;
    deleteScreenshot.mutate(shot);
  };

  if (isAuthLoading) return <PageLoadingState label="Loading your activity…" />;
  if (!isAuthenticated) return <PageErrorState message="Please log in to view this page." />;

  const shots: any[] = (screenshots as any)?.data ?? [];
  const retentionDays = policy.screenshot_retention_days;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My activity"
        description="Everything the desktop tracker has recorded about you, and the rules it follows."
      />

      {/* The notice comes first, deliberately: someone opening this page is
          asking what is collected, not browsing a gallery. */}
      <SurfaceCard>
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary-600" aria-hidden="true" />
          <div className="space-y-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">What is tracked, and for how long</h2>
              <p className="mt-1 text-sm text-slate-600">
                These settings are set by your organisation. They apply only while a timer is running.
              </p>
            </div>
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Screen captures</dt>
                <dd className="mt-1 text-sm text-slate-900">{minutesLabel(policy.capture_interval_minutes)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Kept for</dt>
                <dd className="mt-1 text-sm text-slate-900">{retentionDays} days, then deleted</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Timer stops after</dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {formatDuration(policy.idle_auto_stop_threshold_seconds)} idle
                </dd>
              </div>
            </dl>
            {(policy.privacy.blocked_apps.length > 0 || policy.privacy.skip_on_private_browsing) && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-600">
                  <Info className="mr-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden="true" />
                  No screenshot is taken while
                  {policy.privacy.skip_on_private_browsing ? ' a private browsing window' : ''}
                  {policy.privacy.skip_on_private_browsing && policy.privacy.blocked_apps.length > 0 ? ' or ' : ''}
                  {policy.privacy.blocked_apps.length > 0
                    ? `a password manager (${policy.privacy.blocked_apps.slice(0, 3).join(', ')}${
                        policy.privacy.blocked_apps.length > 3 ? ', …' : ''
                      })`
                    : ''}
                  {' '}is in front.
                </p>
              </div>
            )}
          </div>
        </div>
      </SurfaceCard>

      <div className="flex flex-wrap items-center gap-2">
        {RANGE_OPTIONS.map((option) => (
          <button
            key={option.days}
            type="button"
            onClick={() => setRangeDays(option.days)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
              rangeDays === option.days
                ? 'border-primary-500 bg-primary-50 text-primary-700'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <SurfaceCard>
        <div className="mb-4 flex items-center gap-2">
          <Camera className="h-4 w-4 text-slate-500" aria-hidden="true" />
          <h2 className="text-base font-semibold text-slate-900">Your screenshots</h2>
          <span className="text-sm text-slate-500">
            {shots.length > 0 ? `${shots.length} in this range` : ''}
          </span>
        </div>

        {isScreenshotsLoading ? (
          <PageLoadingState label="Loading your screenshots…" />
        ) : isScreenshotsError ? (
          <PageErrorState message="Unable to load your screenshots right now." />
        ) : shots.length === 0 ? (
          <PageEmptyState
            title="No screenshots in this range"
            description="Screen captures only happen while your timer is running on the desktop app."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shots.map((shot) => (
              <ScreenshotTile
                key={shot.id}
                shot={shot}
                canDelete={policy.can_delete_own_screenshots}
                onDelete={handleDelete}
                isDeleting={deleteScreenshot.isPending}
              />
            ))}
          </div>
        )}

        {deleteNotice && (
          <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {deleteNotice}
          </p>
        )}

        <p className="mt-4 flex items-start gap-1.5 text-xs text-slate-500">
          <Trash2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Captures older than {retentionDays} days are deleted automatically.
            {policy.can_delete_own_screenshots
              ? ' You can also delete any capture yourself — the tracked time it covers is removed with it.'
              : ''}
          </span>
        </p>
      </SurfaceCard>

      <SurfaceCard>
        <div className="mb-4 flex items-center gap-2">
          <Clock className="h-4 w-4 text-slate-500" aria-hidden="true" />
          <h2 className="text-base font-semibold text-slate-900">Recent idle periods</h2>
        </div>

        {isIdleLoading ? (
          <PageLoadingState label="Loading your idle log…" />
        ) : !idleRows || idleRows.length === 0 ? (
          <PageEmptyState
            title="No idle periods recorded"
            description="Idle time is recorded when there is no keyboard or mouse input while a timer runs."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {idleRows.map((row: any) => (
              <li key={row.id} className="flex items-center justify-between gap-4 py-2.5">
                <span className="text-sm text-slate-700">{formatDateTime(row.recorded_at)}</span>
                <span className="text-sm font-medium tabular-nums text-slate-900">
                  {formatDuration(row.duration)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SurfaceCard>

      <p className="flex items-start gap-1.5 text-xs text-slate-500">
        <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          This is the same data your manager can see about you. If anything here looks wrong,
          raise it with your HR team.
        </span>
      </p>
    </div>
  );
}
