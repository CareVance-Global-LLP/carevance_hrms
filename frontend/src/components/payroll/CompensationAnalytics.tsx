import { useMemo } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Sector,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { formatCurrency } from '@/lib/formatters';
import type { PayrollDepartment, PayrollMonthlyRun } from '@/types';

/* ──────────── Colour palette ──────────── */

const DEPT_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#f97316', // orange
  '#6366f1', // indigo
  '#ec4899', // pink
  '#14b8a6', // teal
];

const STATUTORY_COLORS: Record<string, string> = {
  PF: '#3b82f6',
  ESI: '#10b981',
  PT: '#f59e0b',
  TDS: '#ef4444',
  LWF: '#8b5cf6',
};

/* ──────────── Helpers ──────────── */

const fmt = (v: number | string | undefined | null): string =>
  formatCurrency(Number(v ?? 0));

const fmtShort = (v: number | string | undefined | null): string => {
  const n = Number(v ?? 0);
  if (n >= 1_00_00_000) return '₹' + (n / 1_00_00_000).toFixed(1) + 'Cr';
  if (n >= 1_00_000) return '₹' + (n / 1_00_000).toFixed(1) + 'L';
  if (n >= 1_000) return '₹' + (n / 1_000).toFixed(0) + 'K';
  return fmt(v);
};

const toNum = (v: number | string | undefined | null): number => Number(v ?? 0);

const formatMonthLabel = (raw: string): string => {
  const [y, m] = raw.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return raw;
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short' });
};

/* ──────────── Props ──────────── */

interface CompensationAnalyticsProps {
  departments: PayrollDepartment[];
  runs: Partial<PayrollMonthlyRun>[];
  summaryStats: {
    totalEmployees: number;
    processedCount: number;
    paidCount: number;
    totalNetPay: number;
    pendingCount: number;
  };
}

/* ──────────── Custom Tooltip ──────────── */

const DeptTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  if (!entry?.value) return null;
  const dept = entry.payload;
  const color = DEPT_COLORS[dept.dataIndex ?? 0] ?? '#3b82f6';
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-xl min-w-[160px]">
      <p className="text-sm font-semibold text-slate-900 mb-2">{dept.name}</p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-xs text-slate-600">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
            Compensation
          </span>
          <span className="text-xs font-semibold text-slate-900">
            ₹{Math.round(entry.value).toLocaleString('en-IN')}
          </span>
        </div>
        {dept.employees != null && (
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-xs text-slate-600">
              <span className="h-2 w-2 rounded-full bg-slate-400" />
              Employees
            </span>
            <span className="text-xs font-semibold text-slate-900">{dept.employees}</span>
          </div>
        )}
        {dept.total > 0 && (
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-xs text-slate-600">
              <span className="h-2 w-2 rounded-full bg-slate-300" />
              Share
            </span>
            <span className="text-xs font-semibold text-slate-900">
              {((entry.value / dept.total) * 100).toFixed(1)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

/* ──────────── Simple Tooltip (trend/breakdown charts) ──────────── */

const ChartTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  if (!entry) return null;
  const val = Math.round(entry.value);
  const month = entry.payload?.month;
  const year = entry.payload?.year;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-xl text-xs">
      <p className="font-semibold text-slate-900 mb-1">{month} {year}</p>
      {val === 0 ? (
        <p className="text-slate-500 italic">No payroll processed</p>
      ) : (
        <p className="text-slate-700">₹{val.toLocaleString('en-IN')}</p>
      )}
    </div>
  );
};

/* ──────────── Section Heading ──────────── */

function SectionHeading({ title }: { title: string }) {
  return (
    <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-4">
      {title}
    </h3>
  );
}

/* ══════════════════════════════════════════
   Main Component — Single-Page Keka-Style Layout
   ══════════════════════════════════════════ */

export default function CompensationAnalytics({
  departments,
  runs,
}: CompensationAnalyticsProps) {
  /* ── Department Distribution ── */

  const deptData = useMemo(() => {
    const total = departments.reduce((s, d) => s + (d.total_net_pay ?? 0), 0);
    return departments
      .map((d) => ({
        name: d.name,
        value: d.total_net_pay,
        employees: d.employee_count,
        total,
      }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [departments]);

  const deptTotal = useMemo(
    () => deptData.reduce((s, d) => s + d.value, 0),
    [deptData],
  );

  const highestDept = useMemo(
    () => (deptData.length > 0 ? deptData.reduce((a, b) => (a.value > b.value ? a : b)) : null),
    [deptData],
  );

  const lowestDept = useMemo(
    () => (deptData.length > 0 ? deptData.reduce((a, b) => (a.value < b.value ? a : b)) : null),
    [deptData],
  );

  const renderActiveShape = (props: any) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
    return (
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 8}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.2))' }}
      />
    );
  };

  const renderBarShape = (props: any) => {
    const { x, y, width, height, fill } = props;
    const minBarHeight = height === 0 ? 4 : height;
    return (
      <rect
        x={x}
        y={height === 0 ? y - 4 : y}
        width={width}
        height={minBarHeight}
        fill={fill}
        rx={4}
        ry={4}
      />
    );
  };

  /* ── Latest Run → Statutory & Breakdown ── */

  const latestRun = useMemo(() => {
    const paid =
      runs.find((r) => r.status === 'disbursed' || r.status === 'paid') ?? runs[0];
    return paid;
  }, [runs]);

  const statutoryData = useMemo(() => {
    const segments = [
      { name: 'PF', value: toNum(latestRun?.total_pf_employee), color: STATUTORY_COLORS.PF },
      { name: 'ESI', value: toNum(latestRun?.total_esi_employee), color: STATUTORY_COLORS.ESI },
      { name: 'PT', value: toNum(latestRun?.total_pt), color: STATUTORY_COLORS.PT },
      { name: 'TDS', value: toNum(latestRun?.total_tds), color: STATUTORY_COLORS.TDS },
      { name: 'LWF', value: toNum(latestRun?.total_lwf), color: STATUTORY_COLORS.LWF },
    ].filter((s) => s.value > 0);
    return segments;
  }, [latestRun]);

  const grossPay = useMemo(
    () =>
      toNum(latestRun?.total_gross) ||
      statutoryData.reduce((s, d) => s + d.value, 0) + toNum(latestRun?.total_net_pay),
    [latestRun, statutoryData],
  );
  const netPay = useMemo(() => toNum(latestRun?.total_net_pay), [latestRun]);
  const totalDeductions = useMemo(
    () => statutoryData.reduce((s, d) => s + d.value, 0),
    [statutoryData],
  );
  const deductionPct =
    grossPay > 0 ? ((totalDeductions / grossPay) * 100).toFixed(1) : '0.0';

  /* ── Monthly Payroll Trend ── */

  const trendData = useMemo(() => {
    return runs
      .filter((r) => r.month_year)
      .slice(-6)
      .map((r) => ({
        month: formatMonthLabel(r.month_year ?? ''),
        year: (r.month_year ?? '').split('-')[0] || '',
        netPay: toNum(r.total_net_pay),
        grossPay: toNum(r.total_gross),
        deductions: toNum(r.total_deductions),
      }));
  }, [runs]);

  const trendStats = useMemo(() => {
    if (trendData.length === 0)
      return { highest: 0, lowest: 0, average: 0, total: 0 };
    const vals = trendData.map((d) => d.netPay);
    return {
      highest: Math.max(...vals),
      lowest: Math.min(...vals),
      average: vals.reduce((s, v) => s + v, 0) / vals.length,
      total: vals.reduce((s, v) => s + v, 0),
    };
  }, [trendData]);

  /* ── Earnings vs Deductions ── */

  const breakdownData = useMemo(() => {
    if (statutoryData.length === 0) return [];
    const items: Record<string, number> = { 'Net Pay': netPay };
    statutoryData.forEach((s) => {
      items[s.name] = s.value;
    });
    return [{ name: 'Total', ...items }];
  }, [statutoryData, netPay]);

  const breakdownKeys = useMemo(() => {
    if (breakdownData.length === 0) return [];
    return Object.keys(breakdownData[0]).filter((k) => k !== 'name');
  }, [breakdownData]);

  const breakdownColors: Record<string, string> = {
    'Net Pay': '#10b981',
    PF: '#3b82f6',
    ESI: '#06b6d4',
    PT: '#f59e0b',
    TDS: '#ef4444',
    LWF: '#8b5cf6',
  };

  /* ── Empty state ── */

  if (deptData.length === 0 && trendData.length === 0) {
    return (
      <SurfaceCard className="p-5">
        <div className="text-center py-12 text-sm text-slate-500">
          No payroll data available yet. Process a payroll run to see analytics.
        </div>
      </SurfaceCard>
    );
  }

  /* ══════════════ Render ══════════════ */

  return (
    <SurfaceCard className="p-5">
      {/* ─── Section 1: Department Distribution ─── */}
      <div>
        <SectionHeading title="Compensation Distribution by Department" />

        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-6 items-start">
          {/* Donut chart */}
          <div className="flex justify-center">
            <div className="relative h-64 w-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={deptData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={110}
                    paddingAngle={2}
                    dataKey="value"
                    nameKey="name"
                    stroke="none"
                    activeShape={renderActiveShape}
                    isAnimationActive
                  >
                    {deptData.map((_, i) => (
                      <Cell key={i} fill={DEPT_COLORS[i % DEPT_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={<DeptTooltip />}
                    position={{ x: 220, y: 60 }}
                    wrapperStyle={{ pointerEvents: 'none', zIndex: 10 }}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 11, color: '#475569' }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <p className="text-lg font-semibold text-slate-900">{fmt(deptTotal)}</p>
                <p className="text-[11px] uppercase tracking-wider text-slate-500">Total</p>
              </div>
            </div>
          </div>

          {/* Department sidebar */}
          <div className="space-y-2">
            {deptData.map((d, i) => (
              <div
                key={d.name}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2.5"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: DEPT_COLORS[i % DEPT_COLORS.length] }}
                  />
                  <span className="text-xs font-semibold text-slate-800 truncate">
                    {d.name}
                  </span>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-semibold text-slate-900">{fmt(d.value)}</p>
                  <p className="text-[11px] text-slate-500">
                    {d.employees} emp ·{' '}
                    {deptTotal > 0 ? ((d.value / deptTotal) * 100).toFixed(1) : 0}%
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Highest / Lowest footer */}
        {deptData.length > 1 && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {highestDept && (
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3">
                <p className="text-[11px] text-emerald-600 uppercase tracking-wider font-medium">
                  Highest Compensation
                </p>
                <p className="text-sm font-semibold text-emerald-800 mt-0.5">
                  {highestDept.name} — {fmt(highestDept.value)}
                </p>
              </div>
            )}
            {lowestDept && (
              <div className="rounded-lg border border-slate-100 bg-white px-4 py-3">
                <p className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
                  Lowest Compensation
                </p>
                <p className="text-sm font-semibold text-slate-800 mt-0.5">
                  {lowestDept.name} — {fmt(lowestDept.value)}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Section 2: Monthly Payroll Trend ─── */}
      {trendData.length > 0 && (
        <div className="border-t border-slate-100 pt-5 mt-5">
          <SectionHeading title="Monthly Payroll Trend" />

          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-6 items-start">
            {/* Bar chart */}
            <div>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={trendData}
                  margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 12, fill: '#64748b' }}
                    axisLine={{ stroke: '#e2e8f0' }}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v: number) => fmtShort(v)}
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                    width={55}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                  <Bar
                    dataKey="netPay"
                    name="Net Pay"
                    shape={renderBarShape}
                    maxBarSize={40}
                  >
                    {trendData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.netPay === 0 ? '#cbd5e1' : '#0ea5e9'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Trend stats sidebar */}
            <div className="space-y-2">
              <div className="rounded-lg border border-slate-100 bg-white px-3 py-2.5">
                <p className="text-[11px] text-slate-500 uppercase tracking-wider">Highest</p>
                <p className="text-sm font-semibold text-slate-900">{fmt(trendStats.highest)}</p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-white px-3 py-2.5">
                <p className="text-[11px] text-slate-500 uppercase tracking-wider">Lowest</p>
                <p className="text-sm font-semibold text-slate-900">{fmt(trendStats.lowest)}</p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-white px-3 py-2.5">
                <p className="text-[11px] text-slate-500 uppercase tracking-wider">Average</p>
                <p className="text-sm font-semibold text-slate-900">
                  {fmt(Math.round(trendStats.average))}
                </p>
              </div>
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2.5">
                <p className="text-[11px] text-emerald-600 uppercase tracking-wider">
                  Total (Last {trendData.length} months)
                </p>
                <p className="text-sm font-semibold text-emerald-800">
                  {fmt(trendStats.total)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Section 3: Earnings vs Deductions ─── */}
      {breakdownData.length > 0 && (
        <div className="border-t border-slate-100 pt-5 mt-5">
          <SectionHeading title="Earnings vs Deductions" />

          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-6 items-start">
            {/* Horizontal stacked bar */}
            <div>
              <ResponsiveContainer width="100%" height={120}>
                <BarChart
                  data={breakdownData}
                  layout="vertical"
                  margin={{ top: 8, right: 16, left: 16, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis
                    type="number"
                    tickFormatter={(v: number) => fmtShort(v)}
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 12, fill: '#475569', fontWeight: 600 }}
                    axisLine={false}
                    tickLine={false}
                    width={60}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 11, color: '#475569' }}
                  />
                  {breakdownKeys.map((key) => (
                    <Bar
                      key={key}
                      dataKey={key}
                      stackId="a"
                      fill={breakdownColors[key] ?? '#94a3b8'}
                      radius={
                        key === breakdownKeys[breakdownKeys.length - 1]
                          ? [4, 4, 0, 0]
                          : [0, 0, 0, 0]
                      }
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Cost breakdown sidebar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-xs font-medium text-slate-600">Gross Pay</span>
                <span className="text-xs font-semibold text-slate-900">{fmt(grossPay)}</span>
              </div>

              <div className="border-t border-slate-100 pt-2 space-y-1.5">
                {breakdownKeys.map((key) => (
                  <div key={key} className="flex items-center justify-between px-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: breakdownColors[key] ?? '#94a3b8' }}
                      />
                      <span className="text-xs text-slate-600">{key}</span>
                    </div>
                    <span
                      className={
                        'text-xs font-medium ' +
                        (key === 'Net Pay' ? 'text-emerald-600' : 'text-slate-700')
                      }
                    >
                      {fmt(breakdownData[0]?.[key] ?? 0)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="border-t border-slate-200 pt-2 mt-2 space-y-1.5">
                <div className="flex items-center justify-between px-3">
                  <span className="text-xs font-medium text-slate-600">Total Deductions</span>
                  <span className="text-xs font-semibold text-rose-600">
                    {fmt(totalDeductions)}
                  </span>
                </div>
                <div className="flex items-center justify-between px-3">
                  <span className="text-xs font-medium text-slate-600">Deduction %</span>
                  <span className="text-xs font-semibold text-rose-600">{deductionPct}%</span>
                </div>
                <div className="flex items-center justify-between px-3 pt-1">
                  <span className="text-xs font-semibold text-slate-700">Net Pay</span>
                  <span className="text-xs font-bold text-emerald-600">{fmt(netPay)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Section 4: Statutory Deductions Breakdown ─── */}
      {statutoryData.length > 0 && (
        <div className="border-t border-slate-100 pt-5 mt-5">
          <SectionHeading title="Statutory Deductions Breakdown" />

          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-6 items-start">
            {/* Donut chart */}
            <div className="flex justify-center">
              <div className="relative h-56 w-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statutoryData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={95}
                      paddingAngle={2}
                      dataKey="value"
                      nameKey="name"
                      stroke="none"
                      isAnimationActive
                    >
                      {statutoryData.map((s, i) => (
                        <Cell key={i} fill={s.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      wrapperStyle={{ fontSize: 11, color: '#475569' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <p className="text-base font-semibold text-slate-900">
                    {fmt(totalDeductions)}
                  </p>
                  <p className="text-[11px] uppercase tracking-wider text-slate-500">
                    Total Deductions
                  </p>
                </div>
              </div>
            </div>

            {/* Statutory list sidebar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-xs font-medium text-slate-600">Gross Pay</span>
                <span className="text-xs font-semibold text-slate-900">{fmt(grossPay)}</span>
              </div>

              {statutoryData.map((s) => (
                <div
                  key={s.name}
                  className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="text-xs text-slate-600">{s.name}</span>
                  </div>
                  <span className="text-xs font-medium text-slate-800">{fmt(s.value)}</span>
                </div>
              ))}

              <div className="border-t border-slate-200 pt-2 mt-2 space-y-2">
                <div className="flex items-center justify-between px-3">
                  <span className="text-xs font-medium text-slate-600">Total Deductions</span>
                  <span className="text-xs font-semibold text-rose-600">
                    {fmt(totalDeductions)}
                  </span>
                </div>
                <div className="flex items-center justify-between px-3">
                  <span className="text-xs font-medium text-slate-600">Deduction %</span>
                  <span className="text-xs font-semibold text-rose-600">{deductionPct}%</span>
                </div>
                <div className="flex items-center justify-between px-3">
                  <span className="text-xs font-medium text-slate-600">Net Pay</span>
                  <span className="text-xs font-semibold text-emerald-600">{fmt(netPay)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </SurfaceCard>
  );
}
