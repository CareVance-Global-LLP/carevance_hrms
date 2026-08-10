import { useState, type ReactNode } from 'react';
import SurfaceCard from '@/components/dashboard/SurfaceCard';

interface DetailTab {
  id: string;
  label: string;
  content: ReactNode;
}

interface DashboardDetailTabsProps {
  title: string;
  description: string;
  tabs: DetailTab[];
  defaultTabId?: string;
}

export default function DashboardDetailTabs({
  title,
  description,
  tabs,
  defaultTabId,
}: DashboardDetailTabsProps) {
  const [activeTabId, setActiveTabId] = useState(defaultTabId || tabs[0]?.id || '');
  const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabs[0];

  return (
    <SurfaceCard className="overflow-hidden">
      <div className="border-b border-slate-200/80 px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-[-0.04em] text-slate-950">{title}</h2>
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTabId(tab.id)}
                className={`rounded-full px-3.5 py-2 text-sm font-medium transition ${
                  activeTab?.id === tab.id
                    ? 'bg-surface-inverse text-on-inverse'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="p-5 sm:p-6">{activeTab?.content}</div>
    </SurfaceCard>
  );
}
