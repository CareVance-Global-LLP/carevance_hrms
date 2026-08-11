import { cn } from '@/utils/cn';

export default function EmployeeWorkspaceTabs({
  tabs,
  activeTab,
  onChange,
}: {
  tabs: Array<{ id: string; label: string }>;
  activeTab: string;
  onChange: (tab: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 rounded-[28px] border border-white/70 bg-white/75 p-2 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.25)] backdrop-blur">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={cn(
            'rounded-full px-4 py-2.5 text-sm font-semibold transition',
            activeTab === tab.id
              ? 'tile-wash text-sky-800 shadow-[0_16px_32px_-24px_rgba(14,165,233,0.65)]'
              : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-950'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
