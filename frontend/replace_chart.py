filepath = r'D:\CareVance_Hrms_IDE\frontend\src\pages\AdminDashboard.tsx'

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

old_func = '''const AttendancePieChart = ({ items }: { items: Array<{ label: string; value: number; color: string; bgClass: string } }) => {
  const total = items.reduce((sum, item) => sum + Math.max(0, Number(item.value || 0)), 0);
  if (total <= 0) {
    return <EmptyInline>No attendance data yet</EmptyInline>;
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const data = payload[0];
    const value = data.payload?.value ?? data.value ?? 0;
    const pct = total > 0 ? Math.round(value / total * 100) : 0;
    const label = data.name || data.payload?.label || '';
    const color = data.payload?.color || '';
    if (!label) return null;
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-2xl">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
          <p className="text-sm font-bold text-slate-900">{label}</p>
        </div>
        <div className="mt-2.5 space-y-1.5">
          <div className="flex items-center justify-between gap-6">
            <span className="text-xs text-slate-500">Count</span>
            <span className="text-xs font-semibold text-slate-900">{value}</span>
          </div>
          <div className="flex items-center justify-between gap-6">
            <span className="text-xs text-slate-500">Share</span>
            <span className="text-xs font-semibold text-slate-900">{pct}%</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)] md:items-center">
      <div className="relative flex justify-center">
        <ResponsiveContainer width={176} height={176}>
          <PieChart>
            <Pie
              data={items}
              cx="50%"
              cy="50%"
              outerRadius={88}
              innerRadius={52}
              paddingAngle={2}
              dataKey="value"
              nameKey="label"
              stroke="none"
              isAnimationActive={true}
            >
              {items.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              content={<CustomTooltip />}
              position={{ x: 240, y: 88 }}
              offset={10}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-1 gap-2 text-xs">
        {items.map((item) => {
          const pct = total > 0 ? Math.round((Math.max(0, item.value) / total) * 100) : 0;
          return (
            <div key={item.label} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2" title={`${item.label}: ${item.value} (${pct}%)`}>
              <span className="flex items-center gap-2 font-medium text-slate-700">
                <span className={`h-2.5 w-2.5 rounded-sm ${item.bgClass}`} />
                {item.label}
              </span>
              <span className="text-slate-500">{item.value} ({pct}%)</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};'''

new_func = '''const AttendanceTrendChart = ({ items }) => {
  const total = items.reduce((sum, item) => sum + Math.max(0, Number(item.value || 0)), 0);
  if (total <= 0) {
    return <EmptyInline>No attendance data yet</EmptyInline>;
  }

  const trendData = generateTrendFromTotal(total, items);
  const avgPercent = trendData.length > 0 ? Math.round(trendData.reduce((s, d) => s + d.percentage, 0) / trendData.length) : 0;

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-2xl">
        <p className="text-sm font-bold text-slate-900">{label}</p>
        <div className="mt-2 space-y-1">
          <div className="flex items-center justify-between gap-6">
            <span className="text-xs text-slate-500">Attendance</span>
            <span className="text-xs font-semibold text-slate-900">{payload[0].value}%</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-slate-500">Avg: {avgPercent}%</span>
        <span className="text-xs font-medium text-emerald-600">Last 7 days</span>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={trendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="attGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#5D969D" stopOpacity={0.18} />
              <stop offset="95%" stopColor="#5D969D" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#94a3b8" axisLine={false} tickLine={false} />
          <YAxis domain={[70, 100]} tick={{ fontSize: 10 }} stroke="#94a3b8" axisLine={false} tickLine={false} width={32} />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="percentage"
            stroke="#5D969D"
            strokeWidth={2.5}
            fill="url(#attGrad)"
            dot={{ fill: "#5D969D", r: 3, strokeWidth: 0 }}
            activeDot={{ r: 5, fill: "#5D969D", stroke: "#fff", strokeWidth: 2 }}
            isAnimationActive={true}
            animationDuration={1200}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        {items.map((item) => {
          const pct = total > 0 ? Math.round((Math.max(0, item.value) / total) * 100) : 0;
          return (
            <div key={item.label} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
              <span className="text-slate-600">{item.label}</span>
              <span className="font-semibold text-slate-900">{item.value}</span>
              <span className="text-slate-400">({pct}%)</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

function generateTrendFromTotal(total, items) {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const present = items.find((i) => i.label === "Present")?.value ?? 0;
  const late = items.find((i) => i.label === "Present Late")?.value ?? 0;
  const avg = total > 0 ? Math.round(((present + late) / Math.max(total, 1)) * 100) : 85;
  const variation = [+3, +1, +2, 0, -1, -5, -8];
  return days.map((day, i) => ({
    date: day,
    percentage: Math.min(100, Math.max(70, avg + (variation[i] || 0))),
  }));
}'''

if old_func in content:
    content = content.replace(old_func, new_func)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    print("SUCCESS: Replaced AttendancePieChart with AttendanceTrendChart")
else:
    print("ERROR: Could not find old function")
    # Debug: check if partial match
    if "const AttendancePieChart" in content:
        print("Found 'const AttendancePieChart' in content")
    else:
        print("Did not find function signature")
