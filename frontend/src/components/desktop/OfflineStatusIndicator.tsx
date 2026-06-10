import { useOnlineStatus } from '@/hooks/useOnlineStatus';

export function OfflineStatusIndicator() {
  const { status, pendingRecords, isDesktopApp, lastSyncAt, loading, isSyncing } = useOnlineStatus();

  if (!isDesktopApp || loading) return null;

  const statusColors = {
    online: 'bg-emerald-500',
    syncing: 'bg-amber-400',
    offline: 'bg-red-500',
  };

  const statusLabels = {
    online: 'Online',
    syncing: 'Syncing...',
    offline: 'Offline',
  };

  const formatLastSync = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    try {
      const d = new Date(dateStr);
      return d.toLocaleString();
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg text-xs"
      style={{ backgroundColor: status === 'offline' ? '#FEF2F2' : status === 'syncing' ? '#FFFBEB' : '#F0FDF4' }}
    >
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
          Pending: {pendingRecords}
        </span>
      )}

      {isSyncing && (
        <span className="text-amber-600">
          {pendingRecords > 0 ? `${pendingRecords} remaining` : 'Processing...'}
        </span>
      )}

      {status === 'online' && pendingRecords > 0 && (
        <span className="text-amber-600">
          Pending: {pendingRecords}
        </span>
      )}

      {status === 'online' && (
        <span className="text-slate-400">
          Last sync: {formatLastSync(lastSyncAt)}
        </span>
      )}
    </div>
  );
}

export function OfflineBanner() {
  const { isOffline, isDesktopApp, pendingRecords, isSyncing } = useOnlineStatus();

  if (!isDesktopApp || (!isOffline && !isSyncing)) return null;

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
