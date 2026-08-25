import { Fragment, useMemo, useState } from 'react';
import { Check, Info, Lock, Search, X } from 'lucide-react';
import {
  filterGroups,
  grantedInGroup,
  isReadOnlyGroup,
  rankOf,
  RANK_DOT,
  type MatrixDraft,
  type PermissionGroup,
  type Role,
} from './roleUtils';

export interface PermissionMatrixProps {
  roles: Role[];
  groups: PermissionGroup[];
  draft: MatrixDraft;
  canEdit: boolean;
  onToggle: (roleId: number, permissionKey: string) => void;
  onToggleGroup: (roleId: number, group: PermissionGroup, grantAll: boolean) => void;
  onOpenRole: (roleId: number) => void;
}

/**
 * Roles across the top, permissions down the side. The old page could only show
 * one role's permissions at a time — and only after leaving the list — so the
 * question this grid answers in a glance ("what does Team Lead have that
 * Manager doesn't?") could not be answered at all.
 */
export default function PermissionMatrix({
  roles,
  groups,
  draft,
  canEdit,
  onToggle,
  onToggleGroup,
  onOpenRole,
}: PermissionMatrixProps) {
  const [query, setQuery] = useState('');
  const [grantedOnly, setGrantedOnly] = useState(false);

  const visibleGroups = useMemo(() => {
    const searched = filterGroups(groups, query);
    if (!grantedOnly) return searched;

    return searched
      .map((group) => ({
        ...group,
        permissions: group.permissions.filter((permission) =>
          roles.some((role) => draft.get(role.id)?.has(permission.key))
        ),
      }))
      .filter((group) => group.permissions.length > 0);
  }, [groups, query, grantedOnly, roles, draft]);

  const totalShown = visibleGroups.reduce((sum, group) => sum + group.permissions.length, 0);

  if (roles.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
        <p className="text-sm font-semibold text-slate-900">No roles yet</p>
        <p className="mt-1 text-sm text-slate-500">Create a role to start assigning permissions.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search permissions"
            aria-label="Search permissions"
            className="w-56 rounded-lg border border-slate-200 py-1.5 pl-9 pr-8 text-xs text-slate-800 placeholder:text-slate-500 focus:border-blue-400 focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-500 hover:text-slate-700"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>

        <button
          type="button"
          aria-pressed={grantedOnly}
          onClick={() => setGrantedOnly((current) => !current)}
          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
            grantedOnly
              ? 'border-blue-600 bg-blue-50 text-blue-800'
              : 'border-slate-200 text-slate-500 hover:text-slate-800'
          }`}
        >
          Granted by someone
        </button>

        <p className="text-[11px] font-medium text-slate-500">
          {totalShown} permission{totalShown === 1 ? '' : 's'} · {roles.length} role
          {roles.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="max-h-[calc(100vh-19rem)] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-left">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 top-0 z-30 min-w-[15rem] border-b border-r border-slate-200 bg-white px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500"
              >
                Permission
              </th>
              {roles.map((role) => {
                const rank = rankOf(role.hierarchy_level);
                return (
                  <th
                    key={role.id}
                    scope="col"
                    className="sticky top-0 z-20 w-[6.5rem] min-w-[6.5rem] border-b border-slate-200 bg-white px-2 py-2 align-bottom"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenRole(role.id)}
                      className="w-full text-left"
                      title={`${role.name} — level ${role.hierarchy_level}, ${role.users_count} user${
                        role.users_count === 1 ? '' : 's'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: RANK_DOT[rank] }}
                        />
                        <span className="truncate text-[11px] font-bold text-slate-800 hover:text-blue-700">
                          {role.name}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[9px] font-semibold tabular-nums text-slate-500">
                        L{role.hierarchy_level} · {role.users_count}
                        {role.is_active ? '' : ' · off'}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {visibleGroups.length === 0 ? (
              <tr>
                <td
                  colSpan={roles.length + 1}
                  className="px-4 py-10 text-center text-sm text-slate-500"
                >
                  No permissions match “{query}”.
                </td>
              </tr>
            ) : (
              visibleGroups.map((group) => {
                const locked = isReadOnlyGroup(group.group);
                return (
                  <Fragment key={group.group}>
                    <tr>
                      <th
                        scope="rowgroup"
                        className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-4 py-1.5 text-left"
                      >
                        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                          {group.group}
                          {locked ? (
                            <Lock className="h-2.5 w-2.5 text-slate-500" aria-label="Managed elsewhere" />
                          ) : null}
                        </span>
                      </th>
                      {roles.map((role) => {
                        const granted = draft.get(role.id) ?? new Set<string>();
                        const count = grantedInGroup(group, granted);
                        const all = count === group.permissions.length;
                        return (
                          <td
                            key={role.id}
                            className="border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-center"
                          >
                            {/* One click grants or clears a whole group for a role —
                                the old editor required ticking each box in turn. */}
                            <button
                              type="button"
                              disabled={!canEdit || locked}
                              onClick={() => onToggleGroup(role.id, group, !all)}
                              title={
                                locked
                                  ? 'Managed outside role settings'
                                  : all
                                  ? `Clear all ${group.group} permissions for ${role.name}`
                                  : `Grant all ${group.group} permissions to ${role.name}`
                              }
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums transition disabled:cursor-not-allowed ${
                                all
                                  ? 'text-blue-800'
                                  : count > 0
                                  ? 'text-slate-600'
                                  : 'text-slate-300'
                              } ${canEdit && !locked ? 'hover:bg-white' : ''}`}
                            >
                              {count}/{group.permissions.length}
                            </button>
                          </td>
                        );
                      })}
                    </tr>

                    {group.permissions.map((permission) => (
                      <tr key={permission.key} className="group">
                        <th
                          scope="row"
                          className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white px-4 py-1.5 text-left font-normal group-hover:bg-blue-50"
                        >
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-medium text-slate-700">
                              {permission.name}
                            </span>
                            {permission.plan_feature ? (
                              <span className="shrink-0 rounded bg-accent-50 px-1 text-[9px] font-bold text-warning-800">
                                {permission.plan_feature}
                              </span>
                            ) : null}
                            {permission.description ? (
                              <span className="shrink-0" title={permission.description}>
                                <Info className="h-3 w-3 text-slate-300" aria-hidden />
                                <span className="sr-only">{permission.description}</span>
                              </span>
                            ) : null}
                          </span>
                        </th>

                        {roles.map((role) => {
                          const granted = draft.get(role.id)?.has(permission.key) ?? false;
                          return (
                            <td
                              key={role.id}
                              className="border-b border-slate-100 px-2 py-1.5 text-center group-hover:bg-blue-50"
                            >
                              <button
                                type="button"
                                role="checkbox"
                                aria-checked={granted}
                                aria-label={`${permission.name} for ${role.name}`}
                                disabled={!canEdit || locked}
                                onClick={() => onToggle(role.id, permission.key)}
                                className={`mx-auto flex h-4 w-4 items-center justify-center rounded border transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                  granted
                                    ? 'border-blue-600 bg-blue-600 text-white'
                                    : 'border-slate-300 bg-white hover:border-blue-400'
                                }`}
                              >
                                {granted ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
