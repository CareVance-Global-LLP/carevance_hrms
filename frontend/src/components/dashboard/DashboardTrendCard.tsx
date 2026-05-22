import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { PageEmptyState } from '@/components/ui/PageState';

interface TrendPoint {
  id: string;
  label: string;
  value: number;
  formattedValue: string;
  hint?: string;
}

interface DashboardTrendCardProps {
  title: string;
  description: string;
  points: TrendPoint[];
  colorClassName?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  footer?: string;
}

const colorMap: Record<string, string> = {
  'bg-sky-500': '#0ea5e9',
  'bg-blue-500': '#3b82f6',
  'bg-emerald-500': '#10b981',
  'bg-amber-500': '#f59e0b',
  'bg-rose-500': '#f43f5e',
  'bg-violet-500': '#8b5cf6',
};

export default function DashboardTrendCard({
  title,
  description,
  points,
  colorClassName = 'bg-sky-500',
  emptyTitle = 'No trend data',
  emptyDescription = 'No data is available for this selection yet.',
  footer,
}: DashboardTrendCardProps) {
  const fillColor = colorMap[colorClassName] || '#0ea5e9';

  return (
    <SurfaceCard className="p-5">
      <h2 className="text-lg font-semibold tracking-[-0.04em] text-slate-950">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{description}</p>

      {points.length === 0 ? (
        <div className="mt-5">
          <PageEmptyState title={emptyTitle} description={emptyDescription} />
        </div>
      ) : (
        <div className="mt-5">
          <ResponsiveContainer width="100%" height={Math.max(60, points.length * 40)}>
            <BarChart data={points} layout="vertical" margin={{ top: 4, right: 100, left: 100, bottom: 4 }} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: '#475569', fontWeight: 500 }} axisLine={false} tickLine={false} width={95} />
              <Tooltip
                content={({ active, payload }: any) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0].payload;
                  return (
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-xl">
                      <p className="text-xs font-bold text-slate-900">{row.label}</p>
                      <p className="mt-1 text-xs text-slate-500">{row.formattedValue}</p>
                      {row.hint && <p className="mt-0.5 text-xs text-slate-400">{row.hint}</p>}
                    </div>
                  );
                }}
                cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                offset={28}
              />
              <Bar dataKey="value" name="Value" radius={[0, 4, 4, 0]} barSize={16} fill={fillColor}>
                <LabelList dataKey="formattedValue" position="right" style={{ fontSize: '11px', fill: '#64748b', fontWeight: 500 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {footer ? <p className="mt-4 text-xs leading-5 text-slate-500">{footer}</p> : null}
    </SurfaceCard>
  );
}
