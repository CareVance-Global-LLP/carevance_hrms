import { Fragment, memo, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  AlertTriangle,
  Columns3,
  Lock,
  Rows3,
  Search,
  Settings2,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { getInitials, rankOf, RANK_LABEL, RANK_SWATCH, type Role } from './roleUtils';

/* ────────────────────────────────────────────────────────────────
   Model
   ──────────────────────────────────────────────────────────────── */

export interface AssignableUser {
  id: number;
  name: string;
  email?: string | null;
  role?: string | null;
  role_id?: number | null;
}

/** What `updateRoleMutation` needs to move someone into a role. */
export interface AssignTarget {
  role?: string;
  roleId?: number;
}

/**
 * Mirrors the membership rule the old metric cards used: a system role also
 * claims anyone still carrying its slug on `users.role` with no custom role set.
 */
export const holdsRole = (user: AssignableUser, role: Role): boolean =>
  role.is_system
    ? user.role_id === role.id || (!user.role_id && user.role === role.slug)
    : user.role_id === role.id;

export const targetFor = (role: Role): AssignTarget =>
  role.is_system ? { role: role.slug } : { roleId: role.id };

const columnId = (roleId: number) => `role-col:${roleId}`;
const parseColumnId = (id: string): number | null => {
  const match = /^role-col:(\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
};

/* ────────────────────────────────────────────────────────────────
   Person card
   ──────────────────────────────────────────────────────────────── */

interface CardProps {
  user: AssignableUser;
  department: string;
  draggable: boolean;
  lockReason?: string;
}

function PersonCardBase({ user, department, draggable, lockReason }: CardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `person:${user.id}`,
    data: { user },
    disabled: !draggable,
  });

  return (
    <div
      ref={setNodeRef}
      {...(draggable ? listeners : {})}
      {...(draggable ? attributes : {})}
      title={lockReason}
      className={[
        'flex items-center gap-2 rounded-lg border bg-white px-2 py-1.5 transition',
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
        isDragging ? 'opacity-40' : 'border-slate-100 hover:border-slate-300 hover:shadow-card',
      ].join(' ')}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-bold text-slate-600">
        {getInitials(user.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-slate-800">{user.name}</span>
        <span className="block truncate text-[10px] font-medium text-slate-500">{department}</span>
      </span>
      {!draggable ? <Lock className="h-3 w-3 shrink-0 text-slate-300" aria-label={lockReason} /> : null}
    </div>
  );
}

const PersonCard = memo(PersonCardBase);

/* ────────────────────────────────────────────────────────────────
   Column
   ──────────────────────────────────────────────────────────────── */

function RoleColumn({
  role,
  members,
  departmentOf,
  canAssign,
  currentUserId,
}: {
  role: Role;
  members: AssignableUser[];
  departmentOf: (user: AssignableUser) => string;
  canAssign: boolean;
  currentUserId: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId(role.id) });
  const rank = rankOf(role.hierarchy_level);

  return (
    <div
      className={`flex w-[236px] shrink-0 flex-col rounded-xl border bg-white transition ${
        isOver ? 'border-blue-600 ring-2 ring-blue-200' : 'border-slate-200'
      }`}
    >
      <div className="rounded-t-xl border-b border-slate-100 px-3 pb-2.5 pt-3">
        <div className="flex items-center gap-2">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[9px] font-bold"
            style={RANK_SWATCH[rank]}
          >
            {getInitials(role.name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1">
              <span className="truncate text-[13px] font-bold text-slate-900">{role.name}</span>
              {role.is_system ? (
                <Lock className="h-2.5 w-2.5 shrink-0 text-slate-500" aria-label="System role" />
              ) : null}
            </span>
            <span className="block text-[10px] font-semibold text-slate-500">
              {RANK_LABEL[rank]} · L{role.hierarchy_level}
            </span>
          </span>
          <span className="shrink-0 text-xs font-bold tabular-nums text-slate-500">{members.length}</span>
        </div>

        {members.length === 0 ? (
          <p className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-accent-200 bg-accent-50 px-2 py-0.5 text-[10px] font-semibold text-warning-800">
            <AlertTriangle className="h-2.5 w-2.5" /> Nobody holds this
          </p>
        ) : null}
      </div>

      <div ref={setNodeRef} className="flex max-h-[calc(100vh-24rem)] min-h-[6rem] flex-1 flex-col gap-1 overflow-y-auto p-1.5">
        {members.length === 0 ? (
          <p className="px-1 py-3 text-center text-[10px] text-slate-500">
            {canAssign ? 'Drop someone here' : 'Nobody yet'}
          </p>
        ) : (
          members.map((member) => (
            <PersonCard
              key={member.id}
              user={member}
              department={departmentOf(member)}
              draggable={canAssign && member.id !== currentUserId}
              lockReason={member.id === currentUserId ? 'You cannot change your own role' : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   Board
   ──────────────────────────────────────────────────────────────── */

export interface RoleAssignmentBoardProps {
  users: AssignableUser[];
  roles: Role[];
  currentUserId: number;
  canAssign: boolean;
  isPending: boolean;
  query: string;
  setQuery: (value: string) => void;
  departmentOf: (user: AssignableUser) => string;
  onAssign: (userIds: number[], target: AssignTarget, roleName: string) => void;
  onManageDefinitions: () => void;
}

export default function RoleAssignmentBoard({
  users,
  roles,
  currentUserId,
  canAssign,
  isPending,
  query,
  setQuery,
  departmentOf,
  onAssign,
  onManageDefinitions,
}: RoleAssignmentBoardProps) {
  const [view, setView] = useState<'board' | 'list'>(() =>
    typeof window !== 'undefined' && window.localStorage.getItem('roleAssign.view') === 'list' ? 'list' : 'board'
  );
  const [dragging, setDragging] = useState<AssignableUser | null>(null);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [bulkRoleId, setBulkRoleId] = useState<number | ''>('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } })
  );

  const setViewMode = (next: 'board' | 'list') => {
    setView(next);
    window.localStorage.setItem('roleAssign.view', next);
  };

  const ordered = useMemo(
    () => [...roles].sort((a, b) => a.hierarchy_level - b.hierarchy_level || a.name.localeCompare(b.name)),
    [roles]
  );

  const matching = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((user) =>
      [user.name, user.email, departmentOf(user)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }, [users, query, departmentOf]);

  const membersByRole = useMemo(() => {
    const map = new Map<number, AssignableUser[]>();
    ordered.forEach((role) => map.set(role.id, []));
    matching.forEach((user) => {
      const role = ordered.find((candidate) => holdsRole(user, candidate));
      if (role) map.get(role.id)!.push(user);
    });
    map.forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name)));
    return map;
  }, [ordered, matching]);

  const unplaced = useMemo(
    () => matching.filter((user) => !ordered.some((role) => holdsRole(user, role))),
    [matching, ordered]
  );

  const roleNameOf = (user: AssignableUser) =>
    ordered.find((role) => holdsRole(user, role))?.name ?? 'Not set';

  const handleDragEnd = (event: DragEndEvent) => {
    const user = (event.active.data.current as { user?: AssignableUser } | undefined)?.user ?? null;
    setDragging(null);
    if (!user || !event.over) return;

    const roleId = parseColumnId(String(event.over.id));
    if (roleId === null) return;

    const role = ordered.find((candidate) => candidate.id === roleId);
    if (!role || holdsRole(user, role)) return;

    onAssign([user.id], targetFor(role), role.name);
  };

  const toggleSelected = (userId: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  const applyBulk = () => {
    const role = ordered.find((candidate) => candidate.id === bulkRoleId);
    if (!role || selected.size === 0) return;
    onAssign(Array.from(selected), targetFor(role), role.name);
    setSelected(new Set());
    setBulkRoleId('');
  };

  const assignableSelected = useMemo(
    () => Array.from(selected).filter((id) => id !== currentUserId),
    [selected, currentUserId]
  );

  return (
    <div className="space-y-3">
      {/* One toolbar in place of four metric cards plus a separate search card. */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-lg font-bold tracking-[-0.025em] text-slate-950">Who has which role</h2>
            <p className="text-[11px] font-medium text-slate-500">
              <span className="font-bold text-slate-900">{users.length}</span> people ·{' '}
              <span className="font-bold text-slate-900">{ordered.length}</span> roles
            </p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search people"
              aria-label="Search people"
              className="w-52 rounded-lg border border-slate-200 py-1.5 pl-9 pr-8 text-xs text-slate-800 placeholder:text-slate-500 focus:border-blue-400 focus:outline-none"
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

          <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5" role="group" aria-label="View">
            <button
              type="button"
              aria-pressed={view === 'board'}
              onClick={() => setViewMode('board')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                view === 'board' ? 'bg-white text-slate-950 shadow-card' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Columns3 className="h-3.5 w-3.5" /> Board
            </button>
            <button
              type="button"
              aria-pressed={view === 'list'}
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                view === 'list' ? 'bg-white text-slate-950 shadow-card' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Rows3 className="h-3.5 w-3.5" /> List
            </button>
          </div>

          {/* The page that defines what a role can DO had no route into it from
              anywhere in the navigation. */}
          <Button
            variant="secondary"
            size="sm"
            onClick={onManageDefinitions}
            iconLeft={<Settings2 className="h-3.5 w-3.5" />}
          >
            Edit permissions
          </Button>
        </div>
      </div>

      {view === 'board' ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={(event: DragStartEvent) =>
            setDragging((event.active.data.current as { user?: AssignableUser } | undefined)?.user ?? null)
          }
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDragging(null)}
        >
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-start gap-3 overflow-x-auto pb-1">
              {ordered.map((role) => (
                <RoleColumn
                  key={role.id}
                  role={role}
                  members={membersByRole.get(role.id) ?? []}
                  departmentOf={departmentOf}
                  canAssign={canAssign}
                  currentUserId={currentUserId}
                />
              ))}

              {unplaced.length > 0 ? (
                <div className="flex w-[236px] shrink-0 flex-col rounded-xl border border-dashed border-accent-300 bg-white">
                  <div className="border-b border-slate-100 px-3 pb-2.5 pt-3">
                    <p className="text-[13px] font-bold text-warning-800">No recognised role</p>
                    <p className="text-[10px] font-semibold text-slate-500">
                      {unplaced.length} {unplaced.length === 1 ? 'person' : 'people'}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1 overflow-y-auto p-1.5">
                    {unplaced.map((member) => (
                      <PersonCard
                        key={member.id}
                        user={member}
                        department={departmentOf(member)}
                        draggable={canAssign && member.id !== currentUserId}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {canAssign ? (
            <p className="mt-2 text-[11px] text-slate-500">
              Drag anyone onto a role to assign it. You cannot change your own role.
            </p>
          ) : null}

          <DragOverlay dropAnimation={null}>
            {dragging ? (
              <div className="flex items-center gap-2 rounded-lg border border-blue-300 bg-white px-2 py-1.5 shadow-modal">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-[9px] font-bold text-slate-600">
                  {getInitials(dragging.name)}
                </span>
                <span className="text-xs font-semibold text-slate-800">{dragging.name}</span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white">
          {/* Bulk assignment — the old page could only change one person at a
              time, through one dropdown per row. */}
          {assignableSelected.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-blue-50 px-4 py-2.5">
              <p className="text-xs font-bold text-blue-900">
                {assignableSelected.length} selected
              </p>
              <select
                value={bulkRoleId}
                onChange={(event) => setBulkRoleId(event.target.value ? Number(event.target.value) : '')}
                aria-label="Role to assign"
                className="rounded-lg border border-blue-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-800"
              >
                <option value="">Assign role…</option>
                {ordered.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
              <Button size="sm" disabled={bulkRoleId === '' || isPending} onClick={applyBulk}>
                Apply to {assignableSelected.length}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          ) : null}

          {/* Page-level scrolling only — a fixed max-height here would make the
              card its own scroller inside a scrolling page and strand empty
              space below it once the list outgrew the box. */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_theme(colors.slate.200)]">
                <tr>
                  <th scope="col" className="w-9 border-b border-slate-200 px-3 py-2" />
                  <th scope="col" className="border-b border-slate-200 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                    Person
                  </th>
                  <th scope="col" className="border-b border-slate-200 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                    Department
                  </th>
                  <th scope="col" className="border-b border-slate-200 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                    Role
                  </th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((role) => {
                  const members = membersByRole.get(role.id) ?? [];
                  if (members.length === 0) return null;
                  const rank = rankOf(role.hierarchy_level);
                  return (
                    <Fragment key={role.id}>
                      <tr>
                        <td colSpan={4} className="border-b border-slate-200 bg-slate-50 px-3 py-1.5">
                          <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: RANK_SWATCH[rank].backgroundColor }}
                            />
                            {role.name}
                            <span className="tabular-nums text-slate-500">{members.length}</span>
                          </span>
                        </td>
                      </tr>
                      {members.map((member) => {
                        const isSelf = member.id === currentUserId;
                        return (
                          <tr key={member.id} className="hover:bg-blue-50">
                            <td className="border-b border-slate-100 px-3 py-2">
                              <input
                                type="checkbox"
                                checked={selected.has(member.id)}
                                onChange={() => toggleSelected(member.id)}
                                disabled={!canAssign || isSelf}
                                aria-label={`Select ${member.name}`}
                                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                              />
                            </td>
                            <td className="border-b border-slate-100 px-3 py-2">
                              <span className="flex items-center gap-2.5">
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-bold text-slate-600">
                                  {getInitials(member.name)}
                                </span>
                                <span className="min-w-0">
                                  <span className="block truncate text-xs font-semibold text-slate-900">
                                    {member.name}
                                  </span>
                                  <span className="block truncate text-[10px] text-slate-500">{member.email}</span>
                                </span>
                              </span>
                            </td>
                            <td className="border-b border-slate-100 px-3 py-2 text-xs text-slate-600">
                              {departmentOf(member)}
                            </td>
                            <td className="border-b border-slate-100 px-3 py-2">
                              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                                {roleNameOf(member)}
                                {isSelf ? <Lock className="h-3 w-3 text-slate-300" aria-label="Your own role" /> : null}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}

                {matching.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-12 text-center text-sm text-slate-500">
                      <Users className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                      Nobody matches “{query}”.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
