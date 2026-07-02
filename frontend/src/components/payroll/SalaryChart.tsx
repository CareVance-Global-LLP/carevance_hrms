import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { formatCurrency } from '@/lib/formatters';

interface SalaryChartProps {
  data: Array<{ name: string; value: number; color?: string }>;
  title?: string;
}

const DEFAULT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

export default function SalaryChart({ data, title }: SalaryChartProps) {
  // Filter out zero values for cleaner visualization
  const filteredData = data.filter(item => item.value > 0);
  
  if (filteredData.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-500">
        <p>No data to display</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {title && (
        <h4 className="text-sm font-semibold text-slate-700">{title}</h4>
      )}
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={filteredData}
            layout="vertical"
            margin={{ top: 5, right: 30, left: 60, bottom: 5 }}
          >
            <XAxis 
              type="number" 
              tickFormatter={(value) => formatCurrency(value)}
              tick={{ fontSize: 12 }}
            />
            <YAxis 
              type="category" 
              dataKey="name" 
              tick={{ fontSize: 12 }}
              width={50}
            />
            <Tooltip 
              formatter={(value) => [formatCurrency(Number(value)), 'Amount']}
              labelFormatter={(label) => label}
            />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {filteredData.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={entry.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length]} 
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}