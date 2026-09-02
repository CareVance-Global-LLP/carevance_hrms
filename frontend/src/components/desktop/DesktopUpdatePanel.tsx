import Button from '@/components/ui/Button';
import { useDesktopUpdater } from '@/hooks/useDesktopUpdater';
import { Download, RefreshCw, Rocket, Sparkles } from 'lucide-react';
import { brandLabel } from '@/config/brand';

const STATUS_LABELS: Record<DesktopUpdateState['status'], string> = {
  disabled: 'Updates Off',
  idle: 'Ready',
  checking: 'Checking',
  available: 'Update Ready',
  current: 'Up To Date',
  downloading: 'Downloading',
  downloaded: 'Install Ready',
  error: 'Update Error',
};

const formatReleaseDate = (releaseDate: string | null) => {
  if (!releaseDate) {
    return '';
  }

  const parsed = new Date(releaseDate);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  return parsed.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

export default function DesktopUpdatePanel() {
  const {
    state,
    isActionPending,
    actionError,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
  } = useDesktopUpdater();

  const hasUpdate = state.status === 'available' || state.status === 'downloading' || state.status === 'downloaded';
  const releaseDateLabel = formatReleaseDate(state.releaseDate);

  return (
    <section className="overflow-hidden rounded-[28px] border border-white/70 bg-[linear-gradient(135deg,rgba(2,6,23,0.98),rgba(15,23,42,0.96),rgba(3,105,161,0.92))] p-5 text-white shadow-[0_30px_90px_-48px_rgba(2,6,23,0.9)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-100/85">
              <Sparkles className="h-3.5 w-3.5" />
              Desktop Updates
            </span>
            <span className="inline-flex rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-medium text-cyan-50/90">
              {STATUS_LABELS[state.status]}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <h3 className="mt-3 text-xl font-semibold tracking-[-0.04em]">
            {brandLabel} Tracker {state.currentVersion ? `v${state.currentVersion}` : ''}
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-cyan-50/85">
            {actionError || state.message}
          </p>
          {hasUpdate && state.availableVersion ? (
            <p className="mt-3 text-sm font-medium text-cyan-50">
              New version available: v{state.availableVersion}
              {releaseDateLabel ? ` • Released ${releaseDateLabel}` : ''}
            </p>
          ) : null}
          {state.status === 'downloading' ? (
            <div className="mt-4">
              <div className="h-2 rounded-full bg-white/15">
                <div
                  className="h-2 rounded-full bg-cyan-300 transition-all duration-300"
                  style={{ width: `${Math.max(4, Math.min(100, state.progressPercent || 0))}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-cyan-100/80">
                Download progress: {Math.round(state.progressPercent || 0)}%
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={() => void checkForUpdates()}
            disabled={isActionPending || state.status === 'checking' || state.status === 'downloading'}
            variant="secondary"
            size="sm"
            className="border-white/20 bg-white text-slate-950 hover:bg-cyan-50 disabled:bg-white/75 disabled:text-slate-700"
          >
            <RefreshCw className="h-4 w-4" />
            Check Now
          </Button>

          {state.status === 'available' ? (
            <Button
              type="button"
              onClick={() => void downloadUpdate()}
              disabled={isActionPending}
              variant="secondary"
              size="sm"
              className="bg-white text-sky-900 hover:bg-cyan-50"
            >
              <Download className="h-4 w-4" />
              Download Update
            </Button>
          ) : null}

          {state.status === 'downloaded' ? (
            <Button
              type="button"
              onClick={() => void installUpdate()}
              disabled={isActionPending}
              variant="secondary"
              size="sm"
              className="bg-cyan-300 text-slate-950 hover:bg-cyan-200"
            >
              <Rocket className="h-4 w-4" />
              Restart And Install
            </Button>
          ) : null}
        </div>
      </div>

      {state.releaseNotes ? (
        <div className="mt-5 rounded-[22px] border border-white/10 bg-black/15 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-100/80">Patch Notes</p>
          <pre className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-cyan-50/88">{state.releaseNotes}</pre>
        </div>
      ) : null}
    </section>
  );
}
