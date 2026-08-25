import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Square, Clock, Coffee, Trash2, X, Loader2, IndianRupee, Ban } from 'lucide-react';
import { breakTrackingApi, type BreakTime, type BreakType } from '@/services/breakTrackingApi';
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

/** Paid/unpaid is the one thing about a break that affects pay, so it is always visible. */
function PaidBadge({ isPaid }: { isPaid: boolean }) {
  return isPaid ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
      <IndianRupee className="h-3 w-3" /> Paid
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
      <Ban className="h-3 w-3" /> Unpaid
    </span>
  );
}

/**
 * One selectable break type. Shows the daily allowance as a bar so an employee
 * can see what is left before starting, rather than discovering an overage
 * afterwards on a report.
 */
function BreakTypeOption({
  type,
  selected,
  onSelect,
}: {
  type: BreakType;
  selected: boolean;
  onSelect: () => void;
}) {
  const allowanceSeconds = type.max_minutes_per_day ? type.max_minutes_per_day * 60 : null;
  const usedSeconds = type.used_seconds_today;
  const overAllowance = allowanceSeconds !== null && usedSeconds > allowanceSeconds;
  const usedRatio = allowanceSeconds ? Math.min(1, usedSeconds / allowanceSeconds) : 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-lg border p-3 text-left transition ${
        selected ? 'border-sky-400 bg-sky-50/60 ring-1 ring-sky-200' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-900">{type.name}</span>
        <PaidBadge isPaid={type.is_paid} />
      </div>

      {allowanceSeconds !== null ? (
        <div className="mt-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full ${overAllowance ? 'bg-amber-500' : 'bg-sky-500'}`}
              style={{ width: `${Math.max(2, usedRatio * 100)}%` }}
            />
          </div>
          <p className={`mt-1 text-[11px] ${overAllowance ? 'text-amber-700' : 'text-slate-500'}`}>
            {formatDuration(usedSeconds)} of {type.max_minutes_per_day}m used
            {overAllowance ? ' · over allowance' : ''}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-slate-500">
          {usedSeconds > 0 ? `${formatDuration(usedSeconds)} used today` : 'No daily limit'}
        </p>
      )}
    </button>
  );
}

export default function BreakTrackingPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [historyDate, setHistoryDate] = useState(new Date().toISOString().split('T')[0]);

  const { data: todayData, isLoading } = useQuery({
    queryKey: ['breaks-today'],
    queryFn: () => breakTrackingApi.getToday(),
    refetchInterval: 30000,
  });

  const { data: breakTypes = [] } = useQuery({
    queryKey: ['break-types'],
    queryFn: () => breakTrackingApi.getTypes(),
  });

  const { data: historyData } = useQuery({
    queryKey: ['breaks-history', historyDate],
    queryFn: () => breakTrackingApi.getHistory({ date: historyDate }),
  });

  const startMutation = useMutation({
    mutationFn: (breakTypeId: number) => breakTrackingApi.startBreak({ breakTypeId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['breaks-today'] });
      // Allowance counters move as soon as a break starts.
      queryClient.invalidateQueries({ queryKey: ['break-types'] });
      setShowTypePicker(false);
      setSelectedTypeId(null);
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['breaks-today'] });
      queryClient.invalidateQueries({ queryKey: ['break-types'] });
      setSuccessMessage('Break ended.');
      setErrorMessage(null);
    },
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

  // Paid break time is worked time, so it is worth calling out separately —
  // otherwise "Total today: 1h 15m" reads as an hour and a quarter of lost pay.
  const paidBreakSeconds = breaks
    .filter((b) => b.break_type?.is_paid && b.end_at)
    .reduce((sum, b) => sum + (b.duration_seconds || 0), 0);

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
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-slate-950">
                  {activeBreak ? 'On Break' : 'No Active Break'}
                </h2>
                {activeBreak?.break_type && <PaidBadge isPaid={activeBreak.break_type.is_paid} />}
              </div>
              <p className="text-sm text-slate-500">
                {activeBreak?.break_type ? `${activeBreak.break_type.name} · ` : ''}
                Total today: {formatDuration(totalBreakSeconds)}
                {paidBreakSeconds > 0 && (
                  <span className="text-emerald-700"> · {formatDuration(paidBreakSeconds)} paid</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {activeBreak ? (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 rounded-full text-amber-700">
                    <Clock className="h-4 w-4" />
                    <ElapsedTimer startAt={activeBreak.start_at} />
                  </div>
                  <Button onClick={() => endMutation.mutate()} disabled={endMutation.isPending} className="bg-surface-inverse hover:bg-surface-inverse/90">
                    <Square className="h-4 w-4" /> End Break
                  </Button>
                </div>
              ) : (
                !showTypePicker && (
                  <Button onClick={() => setShowTypePicker(true)}>
                    <Play className="h-4 w-4" /> Start Break
                  </Button>
                )
              )}
            </div>
          </div>

          {!activeBreak && showTypePicker && (
            <div className="mt-5 border-t border-slate-100 pt-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700">Choose a break type</p>
                <button
                  onClick={() => { setShowTypePicker(false); setSelectedTypeId(null); }}
                  className="text-slate-500 hover:text-slate-600"
                  aria-label="Cancel"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {breakTypes.length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-500">
                  No break types configured. Ask an admin to add one in Settings.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {breakTypes.map((type) => (
                      <BreakTypeOption
                        key={type.id}
                        type={type}
                        selected={selectedTypeId === type.id}
                        onSelect={() => setSelectedTypeId(type.id)}
                      />
                    ))}
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Button
                      onClick={() => selectedTypeId && startMutation.mutate(selectedTypeId)}
                      disabled={!selectedTypeId || startMutation.isPending}
                    >
                      <Play className="h-4 w-4" /> Start Break
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </SurfaceCard>

        <SurfaceCard className="p-6">
          <h3 className="font-semibold text-slate-950 mb-4">Today's Breaks</h3>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-500" /></div>
          ) : breaks.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">No breaks recorded today.</p>
          ) : (
            <div className="space-y-2">
              {breaks.map((b: BreakTime) => (
                <div key={b.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50">
                  <div className="flex items-center gap-3 min-w-0">
                    <Coffee className="h-4 w-4 shrink-0 text-slate-500" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-slate-700">
                          {new Date(b.start_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {b.end_at ? ` - ${new Date(b.end_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ' (ongoing)'}
                        </span>
                        {b.break_type ? (
                          <>
                            <span className="text-xs text-slate-500">· {b.break_type.name}</span>
                            <PaidBadge isPaid={b.break_type.is_paid} />
                          </>
                        ) : (
                          b.reason && <span className="text-xs text-slate-500">· {b.reason}</span>
                        )}
                      </div>
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
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-500" /></div>
          ) : historyData.breaks.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">No breaks on this date.</p>
          ) : (
            <div className="space-y-2">
              {historyData.breaks.map((b: any) => (
                <div key={b.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50">
                  <div className="flex items-center gap-3 min-w-0">
                    <Coffee className="h-4 w-4 shrink-0 text-slate-500" />
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
