import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Users, IndianRupee } from 'lucide-react';

interface TrendData {
  months: string[];
  net_pay: number[];
  gross_pay: number[];
  deductions: number[];
  employee_count: number[];
}

interface SalaryTrendChartsProps {
  data: TrendData | null;
  loading?: boolean;
}

export default function SalaryTrendCharts({
  data,
  loading = false
}: SalaryTrendChartsProps) {
  const formatCurrency = (value: number) => {
    if (value >= 100000) {
      return '₹' + (value / 100000).toFixed(1) + 'L';
    }
    return '₹' + value.toLocaleString('en-IN');
  };

  // Calculate trends
  const trends = useMemo(() => {
    if (!data) return null;
    
    const netPayTrend = data.net_pay[data.net_pay.length - 1] - data.net_pay[data.net_pay.length - 2];
    const grossTrend = data.gross_pay[data.gross_pay.length - 1] - data.gross_pay[data.gross_pay.length - 2];
    const employeeTrend = data.employee_count[data.employee_count.length - 1] - data.employee_count[data.employee_count.length - 2];
    
    return {
      netPay: { value: netPayTrend, isPositive: netPayTrend >= 0 },
      gross: { value: grossTrend, isPositive: grossTrend >= 0 },
      employees: { value: employeeTrend, isPositive: employeeTrend >= 0 },
    };
  }, [data]);

  if (loading || !data) {
    return (
      <div className="bg-white rounded-xl p-6 border border-slate-200 animate-pulse">
        <div className="h-64 bg-slate-200 rounded-lg"></div>
      </div>
    );
  }

  // Simple bar chart representation
  const maxNetPay = Math.max(...data.net_pay);
  const maxGrossPay = Math.max(...data.gross_pay);

  return (
    <div className="bg-white rounded-xl p-6 border border-slate-200">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <TrendingUp className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Payroll Trends</h3>
            <p className="text-sm text-slate-500">Last 6 months comparison</p>
          </div>
        </div>
        
        {/* Quick trend indicators */}
        {trends && (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <IndianRupee className="h-4 w-4 text-slate-400" />
              <span className={`text-sm font-medium ${trends.netPay.isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
                {trends.netPay.isPositive ? '+' : ''}{formatCurrency(trends.netPay.value)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Net Pay Trend */}
        <div>
          <h4 className="text-sm font-medium text-slate-700 mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-500" />
            Net Pay Trend
          </h4>
          <div className="h-40 flex items-end gap-2">
            {data.months.map((month, index) => {
              const value = data.net_pay[index];
              const height = maxNetPay > 0 ? (value / maxNetPay) * 100 : 0;
              
              return (
                <div key={month} className="flex-1 flex flex-col items-center">
                  <div className="w-full relative">
                    <div 
                      className="bg-emerald-500 rounded-t transition-all duration-300 hover:bg-emerald-600"
                      style={{ height: `${Math.max(height, 5)}%` }}
                    />
                    {/* Tooltip */}
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-xs px-2 py-1 rounded opacity-0 hover:opacity-100 whitespace-nowrap z-10">
                      {formatCurrency(value)}
                    </div>
                  </div>
                  <span className="text-xs text-slate-500 mt-2">{month}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Gross Pay Trend */}
        <div>
          <h4 className="text-sm font-medium text-slate-700 mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-blue-500" />
            Gross Pay Trend
          </h4>
          <div className="h-40 flex items-end gap-2">
            {data.months.map((month, index) => {
              const value = data.gross_pay[index];
              const height = maxGrossPay > 0 ? (value / maxGrossPay) * 100 : 0;
              
              return (
                <div key={month} className="flex-1 flex flex-col items-center">
                  <div className="w-full relative">
                    <div 
                      className="bg-blue-500 rounded-t transition-all duration-300 hover:bg-blue-600"
                      style={{ height: `${Math.max(height, 5)}%` }}
                    />
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-xs px-2 py-1 rounded opacity-0 hover:opacity-100 whitespace-nowrap z-10">
                      {formatCurrency(value)}
                    </div>
                  </div>
                  <span className="text-xs text-slate-500 mt-2">{month}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Employee Count Trend */}
      <div className="mt-6 pt-6 border-t border-slate-200">
        <h4 className="text-sm font-medium text-slate-700 mb-3 flex items-center gap-2">
          <Users className="h-4 w-4 text-violet-500" />
          Employee Count
        </h4>
        <div className="flex items-center gap-4">
          {data.months.map((month, index) => (
            <div key={month} className="text-center">
              <div className="text-lg font-semibold text-slate-900">
                {data.employee_count[index]}
              </div>
              <div className="text-xs text-slate-500">{month}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="mt-6 pt-6 border-t border-slate-200 grid grid-cols-3 gap-4">
        <div className="text-center">
          <p className="text-xs text-slate-500">Avg Net Pay</p>
          <p className="text-lg font-semibold text-emerald-600">
            {formatCurrency(data.net_pay.reduce((a, b) => a + b, 0) / data.net_pay.length)}
          </p>
        </div>
        <div className="text-center">
          <p className="text-xs text-slate-500">Avg Gross Pay</p>
          <p className="text-lg font-semibold text-blue-600">
            {formatCurrency(data.gross_pay.reduce((a, b) => a + b, 0) / data.gross_pay.length)}
          </p>
        </div>
        <div className="text-center">
          <p className="text-xs text-slate-500">Total Deductions</p>
          <p className="text-lg font-semibold text-rose-600">
            {formatCurrency(data.deductions.reduce((a, b) => a + b, 0))}
          </p>
        </div>
      </div>
    </div>
  );
}
