import { useOnlineStatus } from '@/hooks/useOnlineStatus';

export function OfflineStatusIndicator() {
  const { status, pendingRecords, stuckRecords, isDesktopApp, lastSyncAt, loading, isSyncing, queueSize } = useOnlineStatus();

  if (!isDesktopApp || loading) return null;

  /*
   * Work the sync engine has stopped trying to send, shown apart from the
   * queue. It was counted inside "Pending", so a record nobody was going to
   * retry read as one that was about to go — and on this install exactly that
   * happened: a stranded time entry sat behind a reassuring "Pending: 1" for
   * hours, with the only way to discover it being to open the SQLite file.
   */
  const waitingRecords = Math.max(0, pendingRecords - stuckRecords);

  const statusColors = {
    online: 'bg-emerald-500',
    syncing: 'bg-amber-400',
    offline: 'bg-red-500',
  };

  // Tint classes, not an inline backgroundColor: the tint steps are theme
  // tokens that darken in the dark theme, whereas a literal hex stayed a pale
  // pastel and left the (inverted, light) label text unreadable on top of it.
  const statusTints = {
    online: 'bg-emerald-50',
    syncing: 'bg-amber-50',
    offline: 'bg-red-50',
  };

  const statusLabels = {
    online: 'Online',
    syncing: 'Syncing...',
    offline: 'Offline',
  };

  const formatRelative = (dateStr: string | null): string | null => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const diffMs = Date.now() - d.getTime();
    const sec = Math.floor(diffMs / 1000);
    if (sec < 5) return 'just now';
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return d.toLocaleString();
  };

  // Decide what to show in the "Last sync" slot.
  // - If the desktop engine reported a sync time, show a friendly relative time.
  // - If there is no sync time but the queue is empty (i.e. no offline data has
  //   ever been generated), show "Live mode" so the user doesn't stare at "Never".
  // - If the queue is non-empty but no sync has happened, keep "Never" so it's
  //   obvious there is pending data that hasn't been flushed yet.
  const lastSyncLabel = (() => {
    const rel = formatRelative(lastSyncAt);
    if (rel) return rel;
    if (status === 'offline') return 'Never (offline)';
    if ((queueSize ?? pendingRecords) === 0) return 'Live';
    return 'Never';
  })();

  return (
    <div className={`flex items-center gap-3 px-3 py-1.5 rounded-lg text-xs ${statusTints[status]}`}>
      <div className="flex items-center gap-1.5">
        <div className={`w-2 h-2 rounded-full ${statusColors[status]} ${isSyncing ? 'animate-pulse' : ''}`} />
        <span className={`font-medium ${
          status === 'offline' ? 'text-red-700' : status === 'syncing' ? 'text-amber-700' : 'text-emerald-700'
        }`}>
          {statusLabels[status]}
        </span>
      </div>

      {status === 'offline' && (
        <span className="text-red-600">
          Pending: {waitingRecords}
        </span>
      )}

      {isSyncing && (
        <span className="text-amber-600">
          {waitingRecords > 0 ? `${waitingRecords} remaining` : 'Processing...'}
        </span>
      )}

      {status === 'online' && waitingRecords > 0 && (
        <span className="text-amber-600">
          Pending: {waitingRecords}
        </span>
      )}

      {stuckRecords > 0 && (
        <span
          className="font-medium text-red-700"
          title="These could not be sent and are no longer being retried. Open Settings to review them."
        >
          {stuckRecords} stuck
        </span>
      )}

      {status === 'online' && (
        <span className="text-slate-500" title={lastSyncAt ? new Date(lastSyncAt).toLocaleString() : 'No offline queue'}>
          Last sync: {lastSyncLabel}
        </span>
      )}
    </div>
  );
}

export function OfflineBanner() {
  const { isOffline, isDesktopApp, pendingRecords, stuckRecords, isSyncing } = useOnlineStatus();

  if (!isDesktopApp) return null;

  /*
   * Announced even while online and idle, which is precisely when it would
   * otherwise never be seen: the queue is empty, the dot is green, and the
   * only sign that work never reached the server is a number nobody is
   * looking at.
   */
  if (stuckRecords > 0 && !isOffline && !isSyncing) {
    return (
      <div className="bg-red-50 border-l-4 border-red-400 p-3 mb-4 rounded-r-lg">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3 flex-1">
            <p className="text-sm text-red-700">
              <strong>{stuckRecords} record{stuckRecords === 1 ? '' : 's'} could not be sent.</strong>{' '}
              They are no longer being retried, so this time will not appear in reports until it is
              added manually.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!isOffline && !isSyncing) return null;

  if (isOffline) {
    return (
      <div className="bg-red-50 border-l-4 border-red-400 p-3 mb-4 rounded-r-lg">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3 flex-1">
            <p className="text-sm text-red-700">
              <strong>Offline Mode Active.</strong> Data will sync automatically when connection is restored.
              {pendingRecords > 0 && (
                <span className="ml-1">Pending records: <strong>{pendingRecords}</strong></span>
              )}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (isSyncing) {
    return (
      <div className="bg-amber-50 border-l-4 border-amber-400 p-3 mb-4 rounded-r-lg">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <svg className="animate-spin h-5 w-5 text-amber-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
          <div className="ml-3 flex-1">
            <p className="text-sm text-amber-700">
              <strong>Syncing data...</strong> Your offline records are being synchronized.
              {pendingRecords > 0 && (
                <span className="ml-1">{pendingRecords} records remaining.</span>
              )}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
