import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Square, Clock, Coffee, Trash2, X, Loader2 } from 'lucide-react';
import { breakTrackingApi, type BreakTime } from '@/services/breakTrackingApi';
import { emitDesktopTimerStopped, suppressAutoStart, ACTIVE_TIMER_KEY } from '@/lib/desktopTimerSession';
import { useAuth } from '@/contexts/AuthContext';
import Button from '@/components/ui/Button';
import { TextInput } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function ElapsedTimer({ startAt }: { startAt: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = new Date(startAt).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startAt]);

  return <span className="tabular-nums font-mono">{formatDuration(elapsed)}</span>;
}

export default function BreakTrackingPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [showReasonInput, setShowReasonInput] = useState(false);
  const [historyDate, setHistoryDate] = useState(new Date().toISOString().split('T')[0]);

  const { data: todayData, isLoading } = useQuery({
    queryKey: ['breaks-today'],
    queryFn: () => breakTrackingApi.getToday(),
    refetchInterval: 30000,
  });

  const { data: historyData } = useQuery({
    queryKey: ['breaks-history', historyDate],
    queryFn: () => breakTrackingApi.getHistory({ date: historyDate }),
  });

  const startMutation = useMutation({
    mutationFn: (r: string) => breakTrackingApi.startBreak(r || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['breaks-today'] });
      setShowReasonInput(false);
      setReason('');
      setSuccessMessage('Break started.');
      setErrorMessage(null);
      localStorage.removeItem(ACTIVE_TIMER_KEY);
      if (user?.id) {
        emitDesktopTimerStopped({ userId: user.id });
        suppressAutoStart(user.id);
      }
    },
    onError: (err: any) => { setErrorMessage(err?.response?.data?.message || err?.message || 'Failed to start break.'); },
  });

  const endMutation = useMutation({
    mutationFn: () => breakTrackingApi.endBreak(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['breaks-today'] }); setSuccessMessage('Break ended.'); setErrorMessage(null); },
    onError: (err: any) => { setErrorMessage(err?.response?.data?.message || err?.message || 'Failed to end break.'); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => breakTrackingApi.deleteBreak(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['breaks-today'] }); queryClient.invalidateQueries({ queryKey: ['breaks-history'] }); setSuccessMessage('Break deleted.'); setErrorMessage(null); },
    onError: (err: any) => { setErrorMessage(err?.response?.data?.message || err?.message || 'Failed to delete break.'); },
  });

  const activeBreak = todayData?.active_break;
  const breaks = todayData?.breaks || [];
  const totalBreakSeconds = todayData?.total_break_seconds || 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader title="Break Tracking" description="Track your breaks throughout the day" />

      <div className="p-6 max-w-3xl mx-auto space-y-6">
        {successMessage && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-center gap-3">
            <span className="text-sm text-emerald-800">{successMessage}</span>
            <button onClick={() => setSuccessMessage(null)} className="ml-auto"><X className="h-4 w-4" /></button>
          </div>
        )}
        {errorMessage && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
            <span className="text-sm text-red-800">{errorMessage}</span>
            <button onClick={() => setErrorMessage(null)} className="ml-auto"><X className="h-4 w-4" /></button>
          </div>
        )}

        <SurfaceCard className="p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">
                {activeBreak ? 'On Break' : 'No Active Break'}
              </h2>
              <p className="text-sm text-slate-500">
                Total today: {formatDuration(totalBreakSeconds)}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {activeBreak ? (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 rounded-full text-amber-700">
                    <Clock className="h-4 w-4" />
                    <ElapsedTimer startAt={activeBreak.start_at} />
                  </div>
                  <Button onClick={() => endMutation.mutate()} disabled={endMutation.isPending} className="bg-slate-950 hover:bg-slate-800">
                    <Square className="h-4 w-4" /> End Break
                  </Button>
                </div>
              ) : (
                <>
                  {showReasonInput ? (
                    <div className="flex items-center gap-2">
                      <TextInput
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Reason (optional)"
                        className="w-48"
                      />
                      <Button onClick={() => startMutation.mutate(reason)} disabled={startMutation.isPending}>
                        <Play className="h-4 w-4" /> Start
                      </Button>
                      <button onClick={() => { setShowReasonInput(false); setReason(''); }} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
                    </div>
                  ) : (
                    <Button onClick={() => setShowReasonInput(true)}>
                      <Play className="h-4 w-4" /> Start Break
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard className="p-6">
          <h3 className="font-semibold text-slate-950 mb-4">Today's Breaks</h3>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
          ) : breaks.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No breaks recorded today.</p>
          ) : (
            <div className="space-y-2">
              {breaks.map((b: BreakTime) => (
                <div key={b.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50">
                  <div className="flex items-center gap-3 min-w-0">
                    <Coffee className="h-4 w-4 shrink-0 text-slate-400" />
                    <div className="min-w-0">
                      <span className="text-sm text-slate-700">
                        {new Date(b.start_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {b.end_at ? ` - ${new Date(b.end_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ' (ongoing)'}
                      </span>
                      {b.reason && <span className="ml-2 text-xs text-slate-400">· {b.reason}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-medium text-slate-600 tabular-nums">
                      {b.end_at ? formatDuration(b.duration_seconds) : <ElapsedTimer startAt={b.start_at} />}
                    </span>
                    {b.end_at && (
                      <button onClick={() => deleteMutation.mutate(b.id)} className="text-slate-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SurfaceCard>

        <SurfaceCard className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-950">Break History</h3>
            <TextInput type="date" value={historyDate} onChange={(e) => setHistoryDate(e.target.value)} className="w-40" />
          </div>
          {!historyData ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
          ) : historyData.breaks.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No breaks on this date.</p>
          ) : (
            <div className="space-y-2">
              {historyData.breaks.map((b: any) => (
                <div key={b.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50">
                  <div className="flex items-center gap-3 min-w-0">
                    <Coffee className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="text-sm text-slate-700">
                      {new Date(b.start_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {b.end_at ? ` - ${new Date(b.end_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                    </span>
                  </div>
                  <span className="text-sm font-medium text-slate-600 tabular-nums">
                    {formatDuration(b.duration_seconds)}
                  </span>
                </div>
              ))}
              <div className="border-t border-slate-100 pt-2 mt-2 flex items-center justify-between px-3">
                <span className="text-sm font-semibold text-slate-700">Total</span>
                <span className="text-sm font-semibold text-slate-700 tabular-nums">{formatDuration(historyData.total_break_seconds)}</span>
              </div>
            </div>
          )}
        </SurfaceCard>
      </div>
    </div>
  );
}
