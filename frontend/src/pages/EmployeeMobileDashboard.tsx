import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { usePlan } from '@/hooks/usePlan';
import { timeEntryApi, attendanceApi, geofenceApi, employeeDashboardApi, selfieApi } from '@/services/api';
import { useGeolocation } from '@/hooks/useGeolocation';
import { formatTimerClock, formatDuration } from '@/lib/formatters';
import SelfieCapture from '@/components/geofence/SelfieCapture';

interface GeofenceZone {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
}

interface ActiveTimer {
  id: number;
  start_time: string;
  description?: string | null;
}

interface AttendanceToday {
  id: number | null;
  check_in_at?: string | null;
  check_out_at?: string | null;
  status: string;
  is_checked_in: boolean;
  worked_seconds: number;
}

interface DashboardData {
  active_timer: ActiveTimer | null;
  attendance_today: AttendanceToday | null;
  geofence_zone: GeofenceZone | null;
  monthly_total_seconds: number;
  monthly_total_hours: string;
  monthly_days: number;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function EmployeeMobileDashboard() {
  const { user, logout } = useAuth();
  const { hasFeature } = usePlan();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [timerSeconds, setTimerSeconds] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSelfieModal, setShowSelfieModal] = useState(false);
  const [selfieChecked, setSelfieChecked] = useState(false);
  const [selfiePending, setSelfiePending] = useState(true);

  const zone = hasFeature('geo_fencing') ? dashboard?.geofence_zone : null;
  const geo = useGeolocation(
    zone?.latitude,
    zone?.longitude,
    zone?.radius_meters ?? 100
  );

  const fetchDashboard = useCallback(async (m: string) => {
    try {
      const res = await employeeDashboardApi.dashboard(m);
      const data = res.data as DashboardData;
      setDashboard(data);

      if (data.active_timer) {
        startTimeRef.current = new Date(data.active_timer.start_time).getTime();
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setTimerSeconds(Math.max(1, elapsed));
      } else {
        startTimeRef.current = null;
        setTimerSeconds(0);
      }
    } catch {
      setError('Failed to load dashboard');
    }
  }, []);

  useEffect(() => {
    fetchDashboard(month);
  }, [month, fetchDashboard]);

  useEffect(() => {
    if (selfieChecked) return;
    selfieApi.todayStatus().then((res) => {
      if (!res.data.uploaded) {
        setShowSelfieModal(true);
        setSelfiePending(true);
      } else {
        setSelfiePending(false);
      }
    }).catch(() => {
      setSelfiePending(false);
    });
    setSelfieChecked(true);
  }, [selfieChecked]);

  useEffect(() => {
    if (!dashboard?.active_timer || !startTimeRef.current) return;

    const tick = () => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current!) / 1000);
      setTimerSeconds(Math.max(1, elapsed));
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [dashboard?.active_timer]);

  const handleStart = async () => {
    if (selfiePending) {
      setError('Please complete your daily selfie first.');
      return;
    }
    if (!geo.latitude || !geo.longitude) {
      setError('Waiting for GPS location...');
      return;
    }
    if (!geo.isInsideZone && zone) {
      setError(`You are outside the ${zone.name} geofence zone. Timer cannot start.`);
      return;
    }

    setStarting(true);
    setError(null);
    try {
      await timeEntryApi.start({
        timer_slot: 'primary',
        latitude: geo.latitude,
        longitude: geo.longitude,
      });
      await fetchDashboard(month);
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Failed to start timer';
      setError(msg);
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    setStopping(true);
    setError(null);
    try {
      await timeEntryApi.stop({
        timer_slot: 'primary',
        latitude: geo.latitude ?? undefined,
        longitude: geo.longitude ?? undefined,
      });
      await fetchDashboard(month);
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Failed to stop timer';
      setError(msg);
    } finally {
      setStopping(false);
    }
  };

  const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setMonth(e.target.value);
  };

  const activeTimer = dashboard?.active_timer;
  const attendance = dashboard?.attendance_today;

  // Auto-stop when leaving zone
  useEffect(() => {
    if (activeTimer && !geo.isInsideZone && zone && geo.latitude && geo.longitude) {
      timeEntryApi.stop({
        timer_slot: 'primary',
        latitude: geo.latitude,
        longitude: geo.longitude,
      }).then(() => {
        fetchDashboard(month);
      }).catch(() => {});
    }
  }, [geo.isInsideZone, activeTimer, zone, geo.latitude, geo.longitude, month, fetchDashboard]);

  const lastMonth = () => {
    const d = new Date(month + '-01');
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  const nextMonth = () => {
    const d = new Date(month + '-01');
    d.setMonth(d.getMonth() + 1);
    const now = new Date();
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return next > current ? current : next;
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-900">
            {user?.name || 'Employee'}
          </h1>
          <p className="text-xs text-slate-500">{user?.email}</p>
        </div>
        <button
          onClick={logout}
          className="text-xs text-red-600 hover:text-red-800 font-medium"
        >
          Log out
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-md mx-auto w-full">
        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
            {error}
            <button onClick={() => setError(null)} className="float-right font-bold">&times;</button>
          </div>
        )}

        {/* Geofence Status */}
        {zone && (
          <div className={`rounded-lg px-4 py-3 text-sm font-medium flex items-center gap-2 ${
            geo.loading
              ? 'bg-yellow-50 text-yellow-700 border border-yellow-200'
              : geo.isInsideZone
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            <span className="text-lg">
              {geo.loading ? '⏳' : geo.isInsideZone ? '✅' : '❌'}
            </span>
            <span>
              {geo.loading
                ? 'Detecting location...'
                : geo.isInsideZone
                  ? `Inside ${zone.name}`
                  : `Outside ${zone.name} — Timer stopped`}
            </span>
          </div>
        )}

        {/* GPS Error */}
        {geo.error && (
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 text-xs rounded-lg px-4 py-2">
            GPS: {geo.error}
          </div>
        )}

        {/* Timer Section */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 text-center">
          <div className="text-5xl font-mono font-bold text-slate-800 mb-2">
            {formatTimerClock(timerSeconds)}
          </div>
          <p className="text-sm text-slate-500 mb-4">
            {activeTimer ? 'Tracking active' : 'Timer stopped'}
          </p>

          <div className="flex gap-3 justify-center">
            {!activeTimer ? (
              <button
                onClick={handleStart}
                disabled={starting || (!!zone && !geo.isInsideZone) || geo.loading}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold rounded-lg px-8 py-3 transition min-w-[140px]"
              >
                {starting ? 'Starting...' : '▶ Start Timer'}
              </button>
            ) : (
              <button
                onClick={handleStop}
                disabled={stopping}
                className="bg-red-700 hover:bg-red-800 disabled:bg-red-400 text-white font-semibold rounded-lg px-8 py-3 transition min-w-[140px]"
              >
                {stopping ? 'Stopping...' : '■ Stop Timer'}
              </button>
            )}
          </div>
        </div>

        {/* Attendance Today */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Today's Attendance</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Check-in</span>
              <span className="font-medium text-slate-800">
                {attendance?.check_in_at
                  ? new Date(attendance.check_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : '--:--'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Check-out</span>
              <span className="font-medium text-slate-800">
                {attendance?.check_out_at
                  ? new Date(attendance.check_out_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : attendance?.is_checked_in
                    ? 'Still working'
                    : '--:--'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Status</span>
              <span className={`font-medium ${
                attendance?.is_checked_in ? 'text-green-600' : 'text-slate-600'
              }`}>
                {attendance?.is_checked_in ? 'Present' : (attendance?.status || 'Not started')}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Worked today</span>
              <span className="font-medium text-slate-800">
                {attendance ? formatDuration(attendance.worked_seconds) : '0h 0m'}
              </span>
            </div>
          </div>
        </div>

        {/* Monthly Summary */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Monthly Summary</h2>

          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => setMonth(lastMonth())}
              className="text-slate-400 hover:text-slate-600 text-lg px-1"
            >
              ‹
            </button>
            <select
              value={month}
              onChange={handleMonthChange}
              className="text-sm font-medium text-slate-800 bg-transparent border-none cursor-pointer text-center"
            >
              {Array.from({ length: 12 }, (_, i) => {
                const d = new Date();
                d.setMonth(d.getMonth() - i);
                const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                const label = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
                return <option key={val} value={val}>{label}</option>;
              })}
            </select>
            <button
              onClick={() => setMonth(nextMonth())}
              className="text-slate-400 hover:text-slate-600 text-lg px-1"
            >
              ›
            </button>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Total hours</span>
              <span className="font-medium text-slate-800">
                {formatDuration(dashboard?.monthly_total_seconds ?? 0)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Days worked</span>
              <span className="font-medium text-slate-800">
                {dashboard?.monthly_days ?? 0} days
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Daily average</span>
              <span className="font-medium text-slate-800">
                {dashboard?.monthly_days && dashboard.monthly_days > 0
                  ? formatDuration(Math.round((dashboard.monthly_total_seconds ?? 0) / dashboard.monthly_days))
                  : '0h 0m'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Selfie Modal — blocking, no dismiss */}
      {showSelfieModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
            {zone && !geo.isInsideZone && !geo.loading ? (
              <div className="text-center space-y-4 py-6">
                <span className="text-4xl">🚫</span>
                <h3 className="text-lg font-semibold text-slate-800">Outside Allowed Zone</h3>
                <p className="text-sm text-slate-500">
                  You are currently outside <strong>{zone.name}</strong>.
                  Move inside the geofence zone to take your selfie and start the timer.
                </p>
                <p className="text-xs text-slate-400">
                  Current location: {geo.latitude?.toFixed(6)}, {geo.longitude?.toFixed(6)}
                </p>
              </div>
            ) : (
              <SelfieCapture
                latitude={geo.latitude}
                longitude={geo.longitude}
                accuracy={geo.accuracy}
                onComplete={() => { setShowSelfieModal(false); setSelfiePending(false); }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
