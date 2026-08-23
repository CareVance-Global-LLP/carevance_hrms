import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Lock, Pencil, Search, Shield, Trash2, Users, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import {
  duplicateLevels,
  filterGroups,
  getInitials,
  grantedInGroup,
  isReadOnlyGroup,
  rankOf,
  RANK_LABEL,
  RANK_SWATCH,
  type PermissionGroup,
  type Role,
  type RoleDraft,
} from './roleUtils';

/* ────────────────────────────────────────────────────────────────
   Ladder — every role in rank order
   ──────────────────────────────────────────────────────────────── */

interface LadderProps {
  roles: Role[];
  selectedId: number | null;
  clashes: Set<number>;
  onSelect: (roleId: number) => void;
}

function Ladder({ roles, selectedId, clashes, onSelect }: LadderProps) {
  return (
    <div className="flex flex-col">
      {roles.map((role, index) => {
        const rank = rankOf(role.hierarchy_level);
        const previous = roles[index - 1];
        const startsBand = index === 0 || rankOf(previous.hierarchy_level) !== rank;

        return (
          <div key={role.id}>
            {startsBand ? (
              <p className="flex items-center gap-2 px-3 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                {RANK_LABEL[rank]}
                <span className="h-px flex-1 bg-slate-100" />
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => onSelect(role.id)}
              aria-current={selectedId === role.id}
              className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition ${
                selectedId === role.id
                  ? 'border-blue-600 bg-blue-50'
                  : 'border-transparent hover:border-slate-200 hover:bg-slate-50'
              }`}
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold"
                style={RANK_SWATCH[rank]}
              >
                {getInitials(role.name)}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-bold text-slate-900">{role.name}</span>
                  {role.is_system ? (
                    <Lock className="h-3 w-3 shrink-0 text-slate-500" aria-label="System role" />
                  ) : null}
                  {!role.is_active ? (
                    <span className="shrink-0 rounded-full bg-accent-50 px-1.5 text-[9px] font-bold uppercase text-warning-800">
                      off
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 flex items-center gap-2 text-[10px] font-semibold text-slate-500">
                  <span className="tabular-nums">Level {role.hierarchy_level}</span>
                  {clashes.has(role.hierarchy_level) ? (
                    <AlertTriangle className="h-2.5 w-2.5 text-accent-500" aria-label="Level shared with another role" />
                  ) : null}
                  <span className="flex items-center gap-1 tabular-nums">
                    <Users className="h-2.5 w-2.5" />
                    {role.users_count}
                  </span>
                  <span className="tabular-nums">{role.permissions.length} perms</span>
                </span>
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   Editor
   ──────────────────────────────────────────────────────────────── */

interface EditorProps {
  draft: RoleDraft;
  setDraft: (next: RoleDraft) => void;
  groups: PermissionGroup[];
  roles: Role[];
  isCreating: boolean;
  saving: boolean;
  canEdit: boolean;
  fieldErrors: Record<string, string[]>;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

function Editor({
  draft,
  setDraft,
  groups,
  roles,
  isCreating,
  saving,
  canEdit,
  fieldErrors,
  onSave,
  onCancel,
  onDelete,
}: EditorProps) {
  const [query, setQuery] = useState('');
  const granted = useMemo(() => new Set(draft.permissions), [draft.permissions]);
  const visibleGroups = useMemo(() => filterGroups(groups, query), [groups, query]);

  const level = draft.hierarchy_level ?? 100;
  const rank = rankOf(level);
  const levelClash = roles.some(
    (role) => role.id !== draft.id && role.hierarchy_level === draft.hierarchy_level
  );

  const toggle = (key: string) =>
    setDraft({
      ...draft,
      permissions: granted.has(key)
        ? draft.permissions.filter((existing) => existing !== key)
        : [...draft.permissions, key],
    });

  const toggleGroup = (group: PermissionGroup, grantAll: boolean) => {
    const keys = group.permissions.map((permission) => permission.key);
    setDraft({
      ...draft,
      permissions: grantAll
        ? Array.from(new Set([...draft.permissions, ...keys]))
        : draft.permissions.filter((key) => !keys.includes(key)),
    });
  };

  const fieldError = (name: string) => fieldErrors[name]?.[0];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-start gap-3 border-b border-slate-200 p-4">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xs font-bold"
          style={RANK_SWATCH[rank]}
        >
          {getInitials(draft.name || '?')}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-bold tracking-[-0.025em] text-slate-950">
            {isCreating ? 'New role' : draft.name}
          </h2>
          <p className="mt-0.5 text-[11px] font-semibold text-slate-500">
            {RANK_LABEL[rank]} · level {level} · {draft.permissions.length} permission
            {draft.permissions.length === 1 ? '' : 's'}
            {draft.is_system ? ' · system role' : ''}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel} aria-label="Close editor">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div data-field="name">
            <label htmlFor="role-name" className="mb-1 block text-xs font-bold text-slate-700">
              Name
            </label>
            <input
              id="role-name"
              value={draft.name || ''}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="e.g. Team Lead"
              disabled={saving || !canEdit}
              className={`w-full rounded-lg border px-3 py-2 text-sm text-slate-800 focus:outline-none ${
                fieldError('name') ? 'border-danger-500 bg-danger-50' : 'border-slate-200 focus:border-blue-400'
              }`}
            />
            {fieldError('name') ? (
              <p className="mt-1 text-xs text-danger-700">{fieldError('name')}</p>
            ) : null}
          </div>

          <div data-field="hierarchy_level">
            <label htmlFor="role-level" className="mb-1 block text-xs font-bold text-slate-700">
              Hierarchy level
            </label>
            <input
              id="role-level"
              type="number"
              min={1}
              max={999}
              value={draft.hierarchy_level ?? ''}
              onChange={(event) => {
                const value = event.target.value;
                const parsed = Number.parseInt(value, 10);
                setDraft({
                  ...draft,
                  hierarchy_level: value === '' || Number.isNaN(parsed) ? undefined : parsed,
                });
              }}
              onBlur={(event) => {
                if (event.target.value === '' || Number.isNaN(Number.parseInt(event.target.value, 10))) {
                  setDraft({ ...draft, hierarchy_level: 60 });
                }
              }}
              disabled={saving || !canEdit || draft.is_system}
              className={`w-full rounded-lg border px-3 py-2 text-sm tabular-nums text-slate-800 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500 ${
                fieldError('hierarchy_level')
                  ? 'border-danger-500 bg-danger-50'
                  : 'border-slate-200 focus:border-blue-400'
              }`}
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Lower is more senior — Admin 10, Manager 50, Employee 100.
            </p>
            {fieldError('hierarchy_level') ? (
              <p className="mt-1 text-xs text-danger-700">{fieldError('hierarchy_level')}</p>
            ) : null}
            {levelClash ? (
              <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-warning-800">
                <AlertTriangle className="h-3 w-3" />
                Another role already sits at level {draft.hierarchy_level}.
              </p>
            ) : null}
            {draft.is_system ? (
              <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
                <Lock className="h-3 w-3" /> System roles keep a fixed level.
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-4" data-field="description">
          <label htmlFor="role-description" className="mb-1 block text-xs font-bold text-slate-700">
            Description
          </label>
          <input
            id="role-description"
            value={draft.description || ''}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            placeholder="What someone with this role is responsible for"
            disabled={saving || !canEdit}
            className={`w-full rounded-lg border px-3 py-2 text-sm text-slate-800 focus:outline-none ${
              fieldError('description')
                ? 'border-danger-500 bg-danger-50'
                : 'border-slate-200 focus:border-blue-400'
            }`}
          />
          {fieldError('description') ? (
            <p className="mt-1 text-xs text-danger-700">{fieldError('description')}</p>
          ) : null}
        </div>

        {!draft.is_system ? (
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={draft.is_active ?? true}
              onClick={() => setDraft({ ...draft, is_active: !(draft.is_active ?? true) })}
              disabled={saving || !canEdit}
              className={`relative inline-flex h-6 w-11 items-center rounded-full border transition ${
                (draft.is_active ?? true) ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-slate-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition ${
                  (draft.is_active ?? true) ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className="text-xs font-bold text-slate-700">
              {(draft.is_active ?? true) ? 'Active' : 'Inactive'}
            </span>
            <span className="text-[11px] text-slate-500">
              {(draft.is_active ?? true)
                ? 'Can be assigned to people.'
                : 'Hidden when assigning roles; people who already hold it keep it.'}
            </span>
          </div>
        ) : null}

        <div className="mt-6" data-field="permissions">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Permissions</h3>
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-800">
              {draft.permissions.length} granted
            </span>
            <div className="relative ml-auto">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search permissions"
                aria-label="Search permissions"
                className="w-48 rounded-lg border border-slate-200 py-1.5 pl-9 pr-3 text-xs text-slate-800 placeholder:text-slate-500 focus:border-blue-400 focus:outline-none"
              />
            </div>
          </div>

          {fieldErrors.permissions?.map((message) => (
            <p key={message} className="mb-2 text-xs text-danger-700">
              {message}
            </p>
          ))}

          {visibleGroups.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              {groups.length === 0 ? 'No permissions available on your plan.' : `Nothing matches “${query}”.`}
            </p>
          ) : (
            <div className="space-y-3">
              {visibleGroups.map((group) => {
                const locked = isReadOnlyGroup(group.group);
                const count = grantedInGroup(group, granted);
                const all = count === group.permissions.length;

                return (
                  <section key={group.group} className="rounded-lg border border-slate-200">
                    <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
                      <h4 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                        {group.group}
                        {locked ? <Lock className="h-2.5 w-2.5 text-slate-500" /> : null}
                      </h4>
                      <span className="text-[10px] font-bold tabular-nums text-slate-500">
                        {count}/{group.permissions.length}
                      </span>
                      {canEdit && !locked ? (
                        <button
                          type="button"
                          onClick={() => toggleGroup(group, !all)}
                          className="ml-auto text-[11px] font-bold text-blue-700 transition hover:underline"
                        >
                          {all ? 'Clear all' : 'Grant all'}
                        </button>
                      ) : locked ? (
                        <span className="ml-auto text-[10px] font-semibold text-slate-500">
                          Managed outside role settings
                        </span>
                      ) : null}
                    </div>

                    <div className="divide-y divide-slate-100">
                      {group.permissions.map((permission) => {
                        const on = granted.has(permission.key);
                        return (
                          <label
                            key={permission.key}
                            className={`flex items-start gap-2.5 px-3 py-2 transition ${
                              locked || !canEdit ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-blue-50'
                            }`}
                          >
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={on}
                              disabled={saving || !canEdit || locked}
                              onClick={() => toggle(permission.key)}
                              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition disabled:opacity-60 ${
                                on ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white'
                              }`}
                            >
                              {on ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                            </button>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-1.5">
                                <span className="text-xs font-semibold text-slate-800">{permission.name}</span>
                                {permission.plan_feature ? (
                                  <span className="rounded bg-accent-50 px-1 text-[9px] font-bold text-warning-800">
                                    {permission.plan_feature}
                                  </span>
                                ) : null}
                              </span>
                              {permission.description ? (
                                <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                                  {permission.description}
                                </span>
                              ) : null}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 p-3">
        {!isCreating && !draft.is_system && canEdit ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={saving}
            className="text-danger-700 hover:bg-danger-50"
            iconLeft={<Trash2 className="h-3.5 w-3.5" />}
          >
            Delete
          </Button>
        ) : null}
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={onSave} loading={saving} disabled={!canEdit || !draft.name?.trim()}>
            {isCreating ? 'Create role' : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   Read-only summary shown when nothing is being edited
   ──────────────────────────────────────────────────────────────── */

function Summary({
  role,
  groups,
  canEdit,
  onEdit,
}: {
  role: Role;
  groups: PermissionGroup[];
  canEdit: boolean;
  onEdit: () => void;
}) {
  const granted = useMemo(() => new Set(role.permissions), [role.permissions]);
  const rank = rankOf(role.hierarchy_level);
  const used = groups.filter((group) => grantedInGroup(group, granted) > 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-start gap-3 border-b border-slate-200 p-4">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xs font-bold"
          style={RANK_SWATCH[rank]}
        >
          {getInitials(role.name)}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 truncate text-lg font-bold tracking-[-0.025em] text-slate-950">
            {role.name}
            {role.is_system ? <Lock className="h-3.5 w-3.5 shrink-0 text-slate-500" /> : null}
          </h2>
          <p className="mt-0.5 text-[11px] font-semibold text-slate-500">
            {RANK_LABEL[rank]} · level {role.hierarchy_level}
          </p>
        </div>
        {canEdit ? (
          <Button size="sm" onClick={onEdit} iconLeft={<Pencil className="h-3.5 w-3.5" />}>
            Edit
          </Button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <p className="text-sm leading-relaxed text-slate-600">
          {role.description || 'No description added yet.'}
        </p>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            { label: 'People', value: role.users_count },
            { label: 'Permissions', value: role.permissions.length },
            { label: 'Status', value: role.is_active ? 'Active' : 'Inactive' },
          ].map((stat) => (
            <div key={stat.label} className="rounded-lg border border-slate-200 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                {stat.label}
              </p>
              <p
                className={`mt-0.5 text-sm font-bold tabular-nums ${
                  stat.label === 'Status' && !role.is_active ? 'text-warning-800' : 'text-slate-900'
                }`}
              >
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        {role.users_count === 0 ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 text-xs text-warning-800">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            Nobody holds this role yet.
          </p>
        ) : null}

        <p className="mt-5 mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
          What this role can do
        </p>
        {used.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-500">
            No permissions granted.
          </p>
        ) : (
          <div className="space-y-2">
            {used.map((group) => {
              const count = grantedInGroup(group, granted);
              return (
                <div key={group.group} className="rounded-lg border border-slate-200 px-3 py-2">
                  <p className="flex items-center gap-2 text-[11px] font-bold text-slate-700">
                    <Shield className="h-3 w-3 text-blue-600" />
                    {group.group}
                    <span className="ml-auto tabular-nums text-slate-500">
                      {count}/{group.permissions.length}
                    </span>
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    {group.permissions
                      .filter((permission) => granted.has(permission.key))
                      .map((permission) => permission.name)
                      .join(' · ')}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   Export
   ──────────────────────────────────────────────────────────────── */

export interface RoleLadderProps {
  roles: Role[];
  groups: PermissionGroup[];
  selectedId: number | null;
  onSelect: (roleId: number) => void;
  draft: RoleDraft | null;
  setDraft: (next: RoleDraft) => void;
  isCreating: boolean;
  saving: boolean;
  canEdit: boolean;
  fieldErrors: Record<string, string[]>;
  onEdit: (role: Role) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: (role: Role) => void;
}

export default function RoleLadder({
  roles,
  groups,
  selectedId,
  onSelect,
  draft,
  setDraft,
  isCreating,
  saving,
  canEdit,
  fieldErrors,
  onEdit,
  onSave,
  onCancel,
  onDelete,
}: RoleLadderProps) {
  const clashes = useMemo(() => duplicateLevels(roles), [roles]);
  const selected = roles.find((role) => role.id === selectedId) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
      <div className="max-h-[calc(100vh-16rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
        <Ladder roles={roles} selectedId={selectedId} clashes={clashes} onSelect={onSelect} />
      </div>

      <div className="min-h-[26rem] rounded-xl border border-slate-200 bg-white">
        {draft ? (
          <Editor
            draft={draft}
            setDraft={setDraft}
            groups={groups}
            roles={roles}
            isCreating={isCreating}
            saving={saving}
            canEdit={canEdit}
            fieldErrors={fieldErrors}
            onSave={onSave}
            onCancel={onCancel}
            onDelete={() => selected && onDelete(selected)}
          />
        ) : selected ? (
          <Summary role={selected} groups={groups} canEdit={canEdit} onEdit={() => onEdit(selected)} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
            <Shield className="h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-900">Pick a role</p>
            <p className="mt-1 max-w-sm text-sm text-slate-500">
              Choose a role on the left to see what it can do, or switch to the matrix to compare
              every role at once.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
