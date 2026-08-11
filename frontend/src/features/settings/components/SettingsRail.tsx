import { useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/utils/cn';
import { SETTINGS_GROUPS, matchesSettingsQuery, type SettingsTabDef } from '../settingsTabs';
import type { SettingsTabId } from '../types';

interface SettingsRailProps {
  tabs: SettingsTabDef[];
  activeTab: SettingsTabId;
  onTabChange: (tab: SettingsTabId) => void;
  /** Short status shown at the end of a row, e.g. "9/13" or "Dark". */
  hints?: Partial<Record<SettingsTabId, string>>;
}

export default function SettingsRail({ tabs, activeTab, onTabChange, hints = {} }: SettingsRailProps) {
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  const matched = useMemo(() => tabs.filter((tab) => matchesSettingsQuery(tab, query)), [tabs, query]);

  const groups = useMemo(
    () =>
      SETTINGS_GROUPS.map((group) => ({
        ...group,
        items: matched.filter((tab) => tab.group === group.id),
      })).filter((group) => group.items.length > 0),
    [matched]
  );

  // Arrow keys move between whatever is currently visible, so searching then
  // arrowing lands where the eye expects.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') || []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) {
      return;
    }
    event.preventDefault();
    const nextIndex = event.key === 'ArrowDown'
      ? (index + 1) % buttons.length
      : (index - 1 + buttons.length) % buttons.length;
    const next = buttons[nextIndex];
    next?.focus();
    const nextId = next?.dataset.tab as SettingsTabId | undefined;
    if (nextId) {
      onTabChange(nextId);
    }
  };

  return (
    <div className="lg:sticky lg:top-6">
      {/* Mobile: a scrollable pill row, so a phone does not have to scroll past
          eleven buttons before reaching the first setting. */}
      <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1 lg:hidden" role="tablist" aria-label="Settings sections">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                'shrink-0 whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-semibold transition',
                isActive
                  ? 'border-transparent bg-blue-600 text-on-brand'
                  : 'border-slate-200 bg-surface-card text-slate-600 hover:text-slate-900'
              )}
            >
              {tab.name}
            </button>
          );
        })}
      </div>

      <div className="hidden rounded-xl border border-slate-200 bg-surface-card p-3 shadow-sm lg:block">
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && matched.length > 0) {
                onTabChange(matched[0].id);
              }
            }}
            placeholder="Search settings…"
            aria-label="Search settings"
            className="w-full rounded-lg border border-border-strong bg-surface-sunken py-2 pl-9 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-sky-400 focus:ring-2 focus:ring-sky-300/30"
          />
        </div>

        <div ref={listRef} onKeyDown={onKeyDown}>
          {groups.map((group) => (
            <div key={group.id} className="mb-2 last:mb-0">
              <p className="px-2.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                {group.label}
              </p>
              <div role="tablist" aria-label={`${group.label} settings`} className="flex flex-col gap-0.5">
                {group.items.map((tab) => {
                  const isActive = tab.id === activeTab;
                  const hint = hints[tab.id];
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      data-tab={tab.id}
                      aria-selected={isActive}
                      tabIndex={isActive ? 0 : -1}
                      onClick={() => onTabChange(tab.id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400',
                        isActive
                          ? 'bg-blue-50 font-semibold text-blue-700'
                          : 'font-medium text-slate-600 hover:bg-surface-sunken hover:text-slate-900'
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition',
                          isActive
                            ? 'border-transparent bg-blue-600 text-on-brand'
                            : 'border-slate-200 bg-surface-sunken text-slate-600'
                        )}
                      >
                        <tab.icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{tab.name}</span>
                      {hint ? (
                        <span className={cn('shrink-0 text-[11px] tabular-nums', isActive ? 'text-blue-700' : 'text-slate-500')}>
                          {hint}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {groups.length === 0 ? (
            <p className="px-2.5 py-3 text-xs text-slate-600">
              Nothing matches that. Try “leave”, “password” or “theme”.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
