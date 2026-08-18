import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  Check,
  ChevronDown,
  Download,
  MoreVertical,
  Search,
  SlidersHorizontal,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import useAnchoredMenu from '@/components/ui/useAnchoredMenu';

export type DirectorySort = 'default' | 'name_asc' | 'working_first';
export type Segment = 'all' | 'working' | 'incomplete';

export interface RosterUser {
  id: number;
  name: string;
  email?: string | null;
  is_working?: boolean;
  total_duration?: number;
  total_elapsed_duration?: number;
}

/** Fixed so the menu can be placed on its first paint, before it is measured. */
const ROW_MENU_WIDTH = 192;

/*
 * There is no tracked-time column any more. /api/users returns no duration of
 * any kind, so the column rendered an em dash for all 92 people and the
 * "Tracked time high to low" sort silently did nothing. Tracked time lives on
 * the dashboard and in reports, where it comes with the date range it needs.
 */

const initialsOf = (value: string): string => {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

/* ────────────────────────────────────────────────────────────────
   Compact dropdown — a chip, not a labelled form field
   ──────────────────────────────────────────────────────────────── */

function FilterChip({
  label,
  value,
  options,
  onChange,
  isDefault,
  onClear,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (next: string) => void;
  isDefault: boolean;
  onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition ${
          isDefault
            ? 'border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-800'
            : 'border-blue-600 bg-blue-50 text-blue-800'
        }`}
      >
        {isDefault ? label : value}
        <ChevronDown className="h-3 w-3" />
      </button>

      {!isDefault && onClear ? (
        <button
          type="button"
          onClick={onClear}
          aria-label={`Clear ${label} filter`}
          className="absolute -right-1 -top-1 rounded-full bg-blue-600 p-0.5 text-white"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      ) : null}

      {open ? (
        <div
          role="listbox"
          aria-label={label}
          className="absolute left-0 z-40 mt-1 max-h-64 w-52 overflow-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-modal"
        >
          {options.map((option) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={option === value}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-slate-700 transition hover:bg-slate-50"
            >
              <span className="w-3 shrink-0">
                {option === value ? <Check className="h-3 w-3 text-blue-700" /> : null}
              </span>
              <span className="truncate">{option}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   Bulk action menu
   ──────────────────────────────────────────────────────────────── */

function BulkMenu({
  label,
  options,
  onPick,
  disabled,
}: {
  label: string;
  options: Array<{ id: number; name: string }>;
  onPick: (id: number, name: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled || options.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-blue-800 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {label}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label={label}
          className="absolute left-0 z-40 mt-1 max-h-64 w-56 overflow-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-modal"
        >
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => {
                setOpen(false);
                onPick(option.id, option.name);
              }}
              className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs text-slate-700 transition hover:bg-slate-50"
            >
              <span className="truncate">{option.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   Row
   ──────────────────────────────────────────────────────────────── */

interface RowProps {
  user: RosterUser;
  code: string;
  role: string;
  department: string;
  timezone: string;
  href: string;
  incomplete: boolean;
  selected: boolean;
  canRemove: boolean;
  onToggleSelect: () => void;
  onOpenSettings: () => void;
  onRemove: () => void;
}

function RosterRowBase({
  user,
  code,
  role,
  department,
  timezone,
  href,
  incomplete,
  selected,
  canRemove,
  onToggleSelect,
  onOpenSettings,
  onRemove,
}: RowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const { menuRef: panelRef, style: menuStyle } = useAnchoredMenu(triggerRef, menuOpen, { width: ROW_MENU_WIDTH, onDismiss: () => setMenuOpen(false) });
  const working = Boolean(user.is_working);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      /*
       * The panel is portalled out of the row, so it is not inside menuRef any
       * more. Without checking it too, mousedown on a menu item counted as an
       * outside click and unmounted the item before its click could fire.
       */
      if (menuRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen, panelRef]);

  return (
    <tr className={selected ? 'bg-blue-50' : 'hover:bg-blue-50/60'}>
      <td className="border-b border-slate-100 px-3 py-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`Select ${user.name}`}
          className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
        />
      </td>

      <td className="border-b border-slate-100 px-3 py-2.5">
        <div className="flex items-center gap-3">
          {/* Presence lives on the avatar: this is a time-tracking product, and
              whether someone is on the clock right now is the first thing an
              admin looks for. The old table carried `is_working` in its data and
              showed it nowhere. */}
          <span className="relative shrink-0">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">
              {initialsOf(user.name)}
            </span>
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${
                working ? 'bg-success-500' : 'bg-slate-300'
              }`}
              title={working ? 'Working now' : 'Not tracking'}
            />
          </span>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Link to={href} className="truncate text-[13px] font-semibold text-slate-950 hover:text-blue-700">
                {user.name}
              </Link>
              {incomplete ? (
                <span title="Profile missing bank or PAN details">
                  <AlertCircle className="h-3 w-3 shrink-0 text-accent-500" />
                  <span className="sr-only">Incomplete profile</span>
                </span>
              ) : null}
            </div>
            <p className="truncate text-[11px] text-slate-400">{user.email}</p>
          </div>
        </div>
      </td>

      <td className="hidden border-b border-slate-100 px-3 py-2.5 md:table-cell">
        <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-slate-500">
          {role}
        </span>
      </td>

      <td className="hidden border-b border-slate-100 px-3 py-2.5 text-xs text-slate-600 lg:table-cell">
        {department}
      </td>

      <td className="hidden border-b border-slate-100 px-3 py-2.5 xl:table-cell">
        <p className="font-mono text-[11px] text-slate-400">{code}</p>
        <p className="truncate text-[10px] text-slate-400">{timezone}</p>
      </td>

      <td className="border-b border-slate-100 px-3 py-2.5 text-right">
        <div className="relative inline-block" ref={menuRef}>
          <button
            type="button"
            ref={triggerRef}
            aria-label={`Actions for ${user.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((current) => !current)}
            className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuOpen && menuStyle ? createPortal(
            <div
              ref={panelRef}
              data-row-menu=""
              style={menuStyle}
              className="rounded-xl border border-slate-200 bg-surface-raised p-1.5 text-left shadow-modal"
            >
              <Link
                to={href}
                onClick={() => setMenuOpen(false)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-slate-700 transition hover:bg-slate-50"
              >
                <UserRound className="h-3.5 w-3.5 text-slate-400" /> Open profile
              </Link>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenSettings();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-slate-700 transition hover:bg-slate-50"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" /> Settings
              </button>
              {canRemove ? (
                <>
                  <div className="my-1 h-px bg-slate-100" />
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onRemove();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-danger-700 transition hover:bg-danger-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove employee
                  </button>
                </>
              ) : null}
            </div>,
            document.body,
          ) : null}
        </div>
      </td>
    </tr>
  );
}

const RosterRow = memo(RosterRowBase);

/* ────────────────────────────────────────────────────────────────
   Roster
   ──────────────────────────────────────────────────────────────── */

export interface EmployeeRosterProps {
  users: RosterUser[];
  rows: RosterUser[];
  segment: Segment;
  setSegment: (next: Segment) => void;
  query: string;
  setQuery: (next: string) => void;
  departmentOptions: string[];
  departmentFilter: string;
  setDepartmentFilter: (next: string) => void;
  timezoneOptions: string[];
  timezoneFilter: string;
  setTimezoneFilter: (next: string) => void;
  sort: DirectorySort;
  setSort: (next: DirectorySort) => void;
  workingCount: number;
  incompleteCount: number;
  canManage: boolean;
  isExporting: boolean;
  resolveCode: (user: RosterUser) => string;
  resolveRole: (user: RosterUser) => string;
  resolveDepartment: (user: RosterUser) => string;
  resolveTimezone: (user: RosterUser) => string;
  resolveHref: (user: RosterUser) => string;
  isIncomplete: (user: RosterUser) => boolean;
  onOpenSettings: (user: RosterUser) => void;
  onRemove: (user: RosterUser) => void;
  onExport: () => void;
  bulk: BulkActions;
  addEmployeeSlot?: ReactNode;
}

export interface BulkActions {
  departments: Array<{ id: number; name: string }>;
  roles: Array<{ id: number; name: string }>;
  canMoveDepartment: boolean;
  canAssignRole: boolean;
  canRemove: boolean;
  isBusy: boolean;
  onAddToDepartment: (userIds: number[], departmentId: number, departmentName: string) => void;
  onAssignRole: (userIds: number[], roleId: number, roleName: string) => void;
  onExportSelected: (selectedUsers: RosterUser[]) => void;
  onRemove: (userIds: number[]) => void;
}

const SORT_LABEL: Record<DirectorySort, string> = {
  default: 'Default order',
  name_asc: 'Name A-Z',
  working_first: 'Working first',
};

export default function EmployeeRoster({
  users,
  rows,
  segment,
  setSegment,
  query,
  setQuery,
  departmentOptions,
  departmentFilter,
  setDepartmentFilter,
  timezoneOptions,
  timezoneFilter,
  setTimezoneFilter,
  sort,
  setSort,
  workingCount,
  incompleteCount,
  canManage,
  isExporting,
  resolveCode,
  resolveRole,
  resolveDepartment,
  resolveTimezone,
  resolveHref,
  isIncomplete,
  onOpenSettings,
  onRemove,
  onExport,
  bulk,
  addEmployeeSlot,
}: EmployeeRosterProps) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const selectedIds = useMemo(() => Array.from(selected), [selected]);


  const allSelected = rows.length > 0 && rows.every((user) => selected.has(user.id));

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(rows.map((user) => user.id)));

  const toggleOne = (userId: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  const segments: Array<{ key: Segment; label: string; count: number; warn?: boolean }> = [
    { key: 'all', label: 'Everyone', count: users.length },
    { key: 'working', label: 'Working now', count: workingCount },
    { key: 'incomplete', label: 'Incomplete profiles', count: incompleteCount, warn: true },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white">
        {/* Status segments replace the ad-hoc "incomplete only" banner that used
            to appear and disappear above the table. */}
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 px-3 pt-2">
          {segments.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={segment === item.key}
              onClick={() => setSegment(item.key)}
              className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-xs font-bold transition ${
                segment === item.key
                  ? 'border-blue-600 text-slate-950'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {item.label}
              <span
                className={`rounded-full px-1.5 py-px text-[10px] tabular-nums ${
                  item.warn && item.count > 0
                    ? 'bg-accent-50 text-warning-800'
                    : segment === item.key
                    ? 'bg-blue-50 text-blue-800'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {item.count}
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, email or code"
              aria-label="Search employees"
              className="w-60 rounded-lg border border-slate-200 py-1.5 pl-9 pr-8 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </div>

          {/* Four labelled dropdowns took a full row of the old header. As chips
              they take one line and show at a glance which filters are on. */}
          <FilterChip
            label="Department"
            value={departmentFilter}
            options={departmentOptions}
            onChange={setDepartmentFilter}
            isDefault={departmentFilter === departmentOptions[0]}
            onClear={() => setDepartmentFilter(departmentOptions[0])}
          />
          <FilterChip
            label="Timezone"
            value={timezoneFilter}
            options={timezoneOptions}
            onChange={setTimezoneFilter}
            isDefault={timezoneFilter === timezoneOptions[0]}
            onClear={() => setTimezoneFilter(timezoneOptions[0])}
          />
          <FilterChip
            label="Sort"
            value={SORT_LABEL[sort]}
            options={Object.values(SORT_LABEL)}
            onChange={(next) => {
              const match = (Object.keys(SORT_LABEL) as DirectorySort[]).find(
                (key) => SORT_LABEL[key] === next
              );
              if (match) setSort(match);
            }}
            isDefault={sort === 'default'}
            onClear={() => setSort('default')}
          />

          <p className="text-[11px] font-medium text-slate-400">
            {rows.length} of {users.length}
          </p>

          <div className="ml-auto flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onExport} disabled={isExporting}>
              <Download className="h-3.5 w-3.5" />
              {isExporting ? 'Exporting…' : 'Export CSV'}
            </Button>
            {addEmployeeSlot}
          </div>
        </div>

        {/* Selecting rows has to lead somewhere. These are the actions that are
            worth doing to several people at once; anything that needs a decision
            per person stays in the row menu. */}
        {selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-blue-50 px-4 py-2">
            <p className="mr-1 text-xs font-bold text-blue-900">{selected.size} selected</p>

            {bulk.canMoveDepartment ? (
              <BulkMenu
                label="Add to department"
                options={bulk.departments}
                disabled={bulk.isBusy}
                onPick={(id, name) => {
                  bulk.onAddToDepartment(selectedIds, id, name);
                  setSelected(new Set());
                }}
              />
            ) : null}

            {bulk.canAssignRole ? (
              <BulkMenu
                label="Assign role"
                options={bulk.roles}
                disabled={bulk.isBusy}
                onPick={(id, name) => {
                  bulk.onAssignRole(selectedIds, id, name);
                  setSelected(new Set());
                }}
              />
            ) : null}

            <Button
              variant="secondary"
              size="sm"
              disabled={bulk.isBusy}
              onClick={() => bulk.onExportSelected(rows.filter((user) => selected.has(user.id)))}
            >
              <Download className="h-3.5 w-3.5" /> Export selected
            </Button>

            {bulk.canRemove ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={bulk.isBusy}
                className="text-danger-700 hover:bg-danger-50"
                onClick={() => {
                  bulk.onRemove(selectedIds);
                  setSelected(new Set());
                }}
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </Button>
            ) : null}

            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        ) : null}

        {/*
          No inner scroll container. A fixed `max-h` here made the card its own
          scroller inside a page that also scrolls: two scrollbars, and once the
          list was longer than the box the card stopped short of the viewport and
          left a band of empty page below it. The list now grows to its content
          and the window is the only thing that scrolls; the header row sticks to
          the top of the viewport on the way down.
        */}
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_theme(colors.slate.200)]">
              <tr>
                <th scope="col" className="w-9 border-b border-slate-200 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all shown"
                    className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                  />
                </th>
                {['Employee', 'Role', 'Department', 'Code / timezone', ''].map((heading, index) => (
                  <th
                    key={heading || `actions-${index}`}
                    scope="col"
                    className={`border-b border-slate-200 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 ${
                      heading === 'Role' ? 'hidden md:table-cell' : ''
                    } ${heading === 'Department' ? 'hidden lg:table-cell' : ''} ${
                      heading === 'Code / timezone' ? 'hidden xl:table-cell' : ''
                    }`}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-16 text-center">
                    <p className="text-sm font-semibold text-slate-900">No employees match</p>
                    <p className="mt-1 text-sm text-slate-500">
                      Try clearing the search or filters above.
                    </p>
                  </td>
                </tr>
              ) : (
                rows.map((user) => (
                  <RosterRow
                    key={user.id}
                    user={user}
                    code={resolveCode(user)}
                    role={resolveRole(user)}
                    department={resolveDepartment(user)}
                    timezone={resolveTimezone(user)}
                    href={resolveHref(user)}
                    incomplete={isIncomplete(user)}
                    selected={selected.has(user.id)}
                    canRemove={canManage}
                    onToggleSelect={() => toggleOne(user.id)}
                    onOpenSettings={() => onOpenSettings(user)}
                    onRemove={() => onRemove(user)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
