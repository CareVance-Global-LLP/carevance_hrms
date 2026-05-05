export default function PayrollInfoList({
  items,
  columns = 2,
}: {
  items: Array<{ label: string; value?: string | number | null; emphasize?: boolean }>;
  columns?: 1 | 2 | 3;
}) {
  const columnClass = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
  }[columns];

  return (
    <div className={`grid gap-3 ${columnClass}`.trim()}>
      {items.map((item) => (
        <div key={item.label} className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{item.label}</p>
          <p className={`mt-2 text-sm ${item.emphasize ? 'font-semibold text-slate-950' : 'font-medium text-slate-800'}`}>
            {item.value || 'Not available'}
          </p>
        </div>
      ))}
    </div>
  );
}
