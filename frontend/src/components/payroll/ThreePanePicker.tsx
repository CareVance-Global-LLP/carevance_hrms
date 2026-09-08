import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/utils/cn';
import { getInitials } from '@/utils/initials';
import { TextInput } from '@/components/ui/FormField';

export interface PickerItemLite {
  id: number | string;
  label: string;
  sublabel?: string;
  /** Optional metric to render in muted text under the sublabel. */
  meta?: string;
}

interface ThreePanePickerProps<Group extends PickerItemLite, Employee extends PickerItemLite> {
  /** Left pane: pay groups, departments, etc. */
  groups: Group[];
  /** Middle pane: employees / rows for the selected group. */
  employees: Employee[];
  selectedGroupId: Group['id'] | null;
  selectedEmployeeId: Employee['id'] | null;
  onSelectGroup: (id: Group['id']) => void;
  onSelectEmployee: (id: Employee['id']) => void;
  /** Renders the right-hand detail / form pane for the selected employee. */
  renderDetail: (employee: Employee | null) => ReactNode;

  /** Header text for the left and middle panes. */
  groupLabel: string;
  employeeLabel: string;
  searchPlaceholder?: string;

  /** Optional pane-level empty-state strings. */
  emptyGroupsLabel?: string;
  emptyEmployeesLabel?: string;
  /** Hint rendered under the pane header (e.g. "showing first 200"). */
  groupsHint?: string;
  employeesHint?: string;

  /** Search hook. Defaults to client-side filter on label + sublabel. */
  onSearchChange?: (value: string) => void;
  searchValue?: string;

  /** Optional aria labels. */
  ariaLabel?: string;
}

/**
 * Shared IDE-style 3-pane picker for the Employee Pay / Salary Breakdown pages.
 *
 * Replaces the duplicated chrome in `EmployeePayrollCards.tsx` and
 * `SalaryBreakdownCards.tsx`: identical `[180px_240px_1fr]` grid, the same
 * `border-l-[3px]` active-row marker, the same initials avatar.
 *
 * Search is client-side filter of the already-loaded list (preserves the
 * existing behaviour of both pages). The 500+ employee scroll pain noted in
 * the audit is a follow-up — this primitive deliberately doesn't virtualise
 * here because the right-hand `renderDetail` panel itself needs unbounded
 * height. The picker panes are short lists of names.
 */
export default function ThreePanePicker<
  Group extends PickerItemLite,
  Employee extends PickerItemLite,
>({
  groups,
  employees,
  selectedGroupId,
  selectedEmployeeId,
  onSelectGroup,
  onSelectEmployee,
  renderDetail,
  groupLabel,
  employeeLabel,
  searchPlaceholder = 'Search…',
  emptyGroupsLabel = 'No groups',
  emptyEmployeesLabel = 'No employees',
  groupsHint,
  employeesHint,
  onSearchChange,
  searchValue,
  ariaLabel,
}: ThreePanePickerProps<Group, Employee>) {
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSearchChange?.(e.target.value);
  };

  return (
    <div
      className="grid h-[600px] grid-cols-1 overflow-hidden rounded-lg border border-slate-200 bg-surface-card shadow-sm lg:grid-cols-[180px_240px_1fr]"
      aria-label={ariaLabel}
    >
      <Pane
        title={groupLabel}
        hint={groupsHint}
        items={groups.map((g) => ({
          id: g.id,
          label: g.label,
          sublabel: g.sublabel,
          meta: g.meta,
        }))}
        selectedId={selectedGroupId}
        onSelect={(id) => onSelectGroup(id as Group['id'])}
        emptyLabel={emptyGroupsLabel}
        testId="three-pane-groups"
      />

      <div className="flex min-h-0 flex-col border-t border-slate-200 lg:border-l lg:border-t-0">
        <div className="border-b border-slate-200 px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            {employeeLabel}
            {employeesHint ? (
              <span className="ml-2 normal-case tracking-normal text-slate-400">{employeesHint}</span>
            ) : null}
          </p>
          {onSearchChange ? (
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <TextInput
                value={searchValue ?? ''}
                onChange={handleSearchChange}
                placeholder={searchPlaceholder}
                className="pl-8"
              />
            </div>
          ) : null}
        </div>

        <PaneList
          items={employees}
          selectedId={selectedEmployeeId}
          onSelect={(id) => onSelectEmployee(id as Employee['id'])}
          emptyLabel={emptyEmployeesLabel}
        />
      </div>

      <div className="min-h-0 overflow-y-auto border-t border-slate-200 lg:border-l lg:border-t-0">
        {renderDetail(
          employees.find((e) => e.id === selectedEmployeeId) ?? null,
        )}
      </div>
    </div>
  );
}

interface PaneProps {
  title: string;
  hint?: string;
  items: PickerItemLite[];
  selectedId: PickerItemLite['id'] | null;
  onSelect: (id: PickerItemLite['id']) => void;
  emptyLabel: string;
  testId?: string;
}

function Pane({ title, hint, items, selectedId, onSelect, emptyLabel, testId }: PaneProps) {
  return (
    <div className="flex min-h-0 flex-col border-b border-slate-200 lg:border-b-0 lg:border-r">
      <div className="border-b border-slate-200 px-3 py-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
          {title}
          {hint ? (
            <span className="ml-2 normal-case tracking-normal text-slate-400">{hint}</span>
          ) : null}
        </p>
      </div>

      <PaneList
        items={items}
        selectedId={selectedId}
        onSelect={onSelect}
        emptyLabel={emptyLabel}
        testId={testId}
      />
    </div>
  );
}

function PaneList({
  items,
  selectedId,
  onSelect,
  emptyLabel,
  testId,
}: {
  items: PickerItemLite[];
  selectedId: PickerItemLite['id'] | null;
  onSelect: (id: PickerItemLite['id']) => void;
  emptyLabel: string;
  testId?: string;
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-3 py-6 text-center text-xs text-slate-500">
        {emptyLabel}
      </div>
    );
  }

  return (
    <ul className="flex-1 overflow-y-auto" data-testid={testId}>
      {items.map((item) => {
        const isActive = String(item.id) === String(selectedId);
        return (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              aria-current={isActive ? 'true' : undefined}
              className={cn(
                'flex w-full items-center gap-2.5 border-b border-slate-100 px-3 py-2.5 text-left text-sm transition-colors',
                isActive
                  ? 'border-l-[3px] border-l-blue-600 bg-blue-500/5 text-slate-900'
                  : 'border-l-[3px] border-l-transparent text-slate-700 hover:bg-slate-50',
              )}
            >
              <span
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                  isActive
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-slate-100 text-slate-600',
                )}
              >
                {getInitials(item.label)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{item.label}</span>
                {item.sublabel ? (
                  <span className="block truncate text-xs text-slate-500">{item.sublabel}</span>
                ) : null}
                {item.meta ? (
                  <span className="mt-0.5 block truncate text-[11px] text-slate-500">{item.meta}</span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
