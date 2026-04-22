import Button from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useDesktopBrowserTracking } from '@/hooks/useDesktopBrowserTracking';
import { Download, ExternalLink, FolderOpen, Link2, RefreshCw, ShieldCheck, ShieldOff } from 'lucide-react';

const formatTimestamp = (value?: string | null) => {
  if (!value) {
    return '';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  return parsed.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const formatLocalHost = (value?: string | null) => {
  const input = String(value || '').trim();
  if (!input) {
    return '';
  }

  try {
    const parsed = new URL(input);
    return parsed.host;
  } catch {
    return input;
  }
};

export default function DesktopBrowserTrackingPanel() {
  const { user } = useAuth();
  const {
    state,
    isPairingCodePending,
    isInstallPending,
    isInstallGuidePending,
    isOptionsPending,
    pairingError,
    createPairingCode,
    openInstall,
    openInstallGuide,
    openExtensionOptions,
  } = useDesktopBrowserTracking(user?.id ?? null);
  const primaryConnection = state.connections[0] || null;
  const isConnected = Boolean(state.ready && primaryConnection);
  const localHost = formatLocalHost(state.local_url);
  const expiresAtLabel = formatTimestamp(state.pairing_code?.expires_at);
  const lastSeenLabel = formatTimestamp(primaryConnection?.last_seen_at || primaryConnection?.paired_at || state.last_event_at);
  const statusLabel = isConnected ? `${primaryConnection?.browser_name || 'Browser'} Connected` : 'Extension Not Connected Yet';
  const reconnectButtonLabel = isConnected ? 'Reconnect / Manage Extension' : 'Open Extension Options';
  const statusCopy = state.last_error || pairingError || (
    isConnected
      ? 'The desktop shell is receiving browser activity from your paired Chrome or Chromium extension.'
      : 'Generate a pairing code in the desktop shell, then paste it into the browser extension to finish linking this machine.'
  );

  return (
    <section className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(240,249,255,0.98),rgba(248,250,252,0.98))] p-5 text-slate-950 shadow-[0_30px_90px_-54px_rgba(14,165,233,0.35)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">
              <Link2 className="h-3.5 w-3.5" />
              Browser Tracking
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">
              {isConnected ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> : <ShieldOff className="h-3.5 w-3.5 text-amber-600" />}
              {statusLabel}
            </span>
          </div>

          <h3 className="mt-3 text-xl font-semibold tracking-[-0.04em]">Pair the Chrome extension to this desktop shell</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            {statusCopy}
          </p>
        </div>

        <div className="grid min-w-[260px] gap-2 sm:grid-cols-2">
          <Button
            type="button"
            onClick={() => void openInstall('chrome')}
            disabled={isInstallPending}
            variant="secondary"
            size="sm"
            className="border-slate-200 bg-white text-slate-900 hover:bg-sky-50 disabled:bg-slate-100 disabled:text-slate-500"
          >
            <Download className={`h-4 w-4 ${isInstallPending ? 'animate-pulse' : ''}`} />
            Install in Chrome
          </Button>
          <Button
            type="button"
            onClick={() => void openInstall('edge')}
            disabled={isInstallPending}
            variant="secondary"
            size="sm"
            className="border-slate-200 bg-white text-slate-900 hover:bg-sky-50 disabled:bg-slate-100 disabled:text-slate-500"
          >
            <Download className={`h-4 w-4 ${isInstallPending ? 'animate-pulse' : ''}`} />
            Install in Edge
          </Button>
          <Button
            type="button"
            onClick={() => void openExtensionOptions(primaryConnection?.extension_origin)}
            disabled={isOptionsPending || !primaryConnection?.extension_origin}
            variant="secondary"
            size="sm"
            className="border-slate-200 bg-white text-slate-900 hover:bg-sky-50 disabled:bg-slate-100 disabled:text-slate-500 sm:col-span-2"
          >
            <ExternalLink className={`h-4 w-4 ${isOptionsPending ? 'animate-pulse' : ''}`} />
            {reconnectButtonLabel}
          </Button>
          <Button
            type="button"
            onClick={() => void createPairingCode('chrome')}
            disabled={isPairingCodePending || !user?.id}
            variant="secondary"
            size="sm"
            className="border-slate-200 bg-white text-slate-900 hover:bg-sky-50 disabled:bg-slate-100 disabled:text-slate-500"
          >
            <RefreshCw className={`h-4 w-4 ${isPairingCodePending ? 'animate-spin' : ''}`} />
            Generate Pairing Code
          </Button>
          <Button
            type="button"
            onClick={() => void openInstallGuide('chrome')}
            disabled={isInstallGuidePending}
            variant="secondary"
            size="sm"
            className="border-slate-200 bg-white text-slate-900 hover:bg-sky-50 disabled:bg-slate-100 disabled:text-slate-500"
          >
            <FolderOpen className={`h-4 w-4 ${isInstallGuidePending ? 'animate-pulse' : ''}`} />
            Open Local Extension Folder
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="rounded-[22px] border border-slate-200/80 bg-white/90 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Connection Status</p>
          <div className="mt-3 space-y-2 text-sm text-slate-700">
            <p>{statusLabel}</p>
            {localHost ? <p>Local relay: {localHost}</p> : null}
            {primaryConnection?.profile_key ? <p>Profile: {primaryConnection.profile_key}</p> : null}
            {primaryConnection?.extension_version ? <p>Extension version: {primaryConnection.extension_version}</p> : null}
            {lastSeenLabel ? <p>Last activity: {lastSeenLabel}</p> : null}
          </div>
        </div>

        <div className="rounded-[22px] border border-sky-200 bg-sky-50/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">Install + Pair</p>
          {state.pairing_code ? (
            <>
              <p className="mt-3 rounded-[18px] border border-sky-200 bg-white px-4 py-3 font-mono text-lg font-semibold tracking-[0.18em] text-slate-950">
                {state.pairing_code.value}
              </p>
              <p className="mt-3 text-sm text-slate-700">
                {expiresAtLabel ? `Expires ${expiresAtLabel}` : 'This code is ready to use in the extension.'}
              </p>
              <div className="mt-3 rounded-[18px] border border-sky-200/80 bg-white/90 px-4 py-3 text-sm leading-6 text-slate-700">
                <p>1. Click <span className="font-semibold text-slate-950">Install in Chrome</span> or <span className="font-semibold text-slate-950">Install in Edge</span>.</p>
                <p>2. Click the extension icon in the browser toolbar.</p>
                <p>3. Paste this code once and press <span className="font-semibold text-slate-950">Connect browser</span>.</p>
              </div>
            </>
          ) : (
            <div className="mt-3 space-y-3 text-sm leading-6 text-slate-600">
              <p>Use Install in Chrome or Install in Edge for the direct install page. If this desktop build does not have a published store listing yet, Open Local Extension Folder gives you the unpacked extension directory.</p>
              <p>After the extension is added once, users can simply click the extension icon and connect or reconnect from there.</p>
              <p>Once paired, the desktop app now remembers the browser connection across restarts unless the extension is removed manually.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
