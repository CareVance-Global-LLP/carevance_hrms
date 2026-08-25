import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Crown, Plus, Trash2, UserPlus2 } from 'lucide-react';
import type { DepartmentTeam } from '@/services/api';
import Button from '@/components/ui/Button';
import EmployeeSelect from '@/components/ui/EmployeeSelect';
import {
  canManagePerson,
  departmentStyle,
  describeBreakdown,
  getInitials,
  roleAvatarStyle,
  roleLabel,
  roleTier,
  tierBreakdown,
  ROLE_TIER_CHIP,
  type BoardColumn,
  type DeptInsight,
  type DeptUser,
  type PersonCard,
} from './departmentUtils';

/* ────────────────────────────────────────────────────────────────
   Gallery — every department at a glance
   ──────────────────────────────────────────────────────────────── */

/** Share-of-headcount bar. Replaces the pie chart the page used to carry. */
function TeamShareBar({ teams, total }: { teams: DepartmentTeam[]; total: number }) {
  const shades = ['#5D969D', '#8DC3C9', '#3D656B', '#B3D7DB'];
  const assigned = teams.map((team) => (team.member_ids ?? team.members?.map((m) => m.id) ?? []).length);
  const loose = Math.max(0, total - assigned.reduce((sum, value) => sum + value, 0));

  if (total === 0) return null;

  return (
    <div className="flex h-1 gap-[2px] overflow-hidden rounded-full">
      {assigned.map((count, index) =>
        count > 0 ? (
          <span
            key={teams[index].id}
            style={{ flex: count, backgroundColor: shades[index % shades.length] }}
            title={`${teams[index].name}: ${count}`}
          />
        ) : null
      )}
      {loose > 0 ? (
        <span style={{ flex: loose, backgroundColor: 'rgb(var(--n-300))' }} title={`Not in a team: ${loose}`} />
      ) : null}
    </div>
  );
}

interface GalleryProps {
  columns: BoardColumn[];
  teamsByDept: Map<number, DepartmentTeam[]>;
  canCreateGroups: boolean;
  onOpen: (deptId: number) => void;
  onCreateDepartment: () => void;
}

function Gallery({ columns, teamsByDept, canCreateGroups, onOpen, onCreateDepartment }: GalleryProps) {
  if (columns.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
        <p className="text-sm font-semibold text-slate-900">No departments match your search</p>
        <p className="mt-1 text-sm text-slate-500">Try a different name, or clear the search box.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {columns.map(({ dept, total, hasLead }) => {
        const teams = teamsByDept.get(dept.id) ?? [];
        // Most senior first, so the four faces you see are the ones worth seeing.
        const faces = [...dept.users].sort((a, b) => a.level - b.level).slice(0, 4);
        const overflow = Math.max(0, total - faces.length);
        const breakdown = describeBreakdown(
          tierBreakdown(columns.find((c) => c.dept.id === dept.id)?.groups.flatMap((g) => g.cards) ?? [])
        );

        return (
          <button
            key={dept.id}
            type="button"
            onClick={() => onOpen(dept.id)}
            className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:shadow-card-hover"
          >
            <div className="flex items-start gap-3">
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold"
                style={departmentStyle(dept.name)}
              >
                {getInitials(dept.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold tracking-[-0.02em] text-slate-950">
                  {dept.name}
                </span>
                <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-slate-500">
                  {dept.description || 'No description yet.'}
                </span>
              </span>
            </div>

            {teams.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {teams.slice(0, 3).map((team) => (
                  <span
                    key={team.id}
                    className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600"
                  >
                    {team.name} {(team.member_ids ?? team.members?.map((m) => m.id) ?? []).length}
                  </span>
                ))}
                {teams.length > 3 ? (
                  <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                    +{teams.length - 3}
                  </span>
                ) : null}
              </div>
            ) : (
              <span className="w-fit rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                No teams yet
              </span>
            )}

            <TeamShareBar teams={teams} total={total} />

            <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
              <span className="flex">
                {faces.map((user, index) => (
                  <span
                    key={user.id}
                    className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-[8px] font-bold"
                    style={{ ...roleAvatarStyle(user), marginLeft: index === 0 ? 0 : -8 }}
                    title={`${user.name} — ${roleLabel(user)}`}
                  >
                    {getInitials(user.name)}
                  </span>
                ))}
                {overflow > 0 ? (
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-[8px] font-bold text-slate-600"
                    style={{ marginLeft: -8 }}
                  >
                    +{overflow}
                  </span>
                ) : null}
              </span>
              <span className="ml-auto truncate text-[11px] font-semibold text-slate-500">{breakdown}</span>
            </div>

            {hasLead ? (
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
                <Crown className="h-3 w-3 shrink-0 text-blue-600" />
                <span className="truncate">Led by {dept.leadName}</span>
              </span>
            ) : (
              <span className="inline-flex w-fit items-center gap-1 rounded-full border border-accent-200 bg-accent-50 px-2 py-0.5 text-[10px] font-semibold text-warning-800">
                <AlertTriangle className="h-2.5 w-2.5" /> No lead — assign one
              </span>
            )}
          </button>
        );
      })}

      {canCreateGroups ? (
        <button
          type="button"
          onClick={onCreateDepartment}
          className="flex min-h-[10rem] flex-col items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-slate-300 text-sm font-semibold text-slate-500 transition hover:border-blue-400 hover:text-blue-700"
        >
          <Plus className="h-5 w-5" />
          New department
        </button>
      ) : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   Focus — one department, full width
   ──────────────────────────────────────────────────────────────── */

function PersonRow({
  card,
  badge,
  canRemove,
  onRemove,
}: {
  card: PersonCard;
  badge?: React.ReactNode;
  canRemove: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-100 py-2 last:border-b-0">
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
        style={roleAvatarStyle(card.user)}
      >
        {getInitials(card.user.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[13px] font-semibold text-slate-900">{card.user.name}</span>
          <span
            className={`shrink-0 rounded-full border px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.06em] ${
              ROLE_TIER_CHIP[roleTier(card.user)]
            }`}
          >
            {roleLabel(card.user)}
          </span>
        </span>
        <span className="block truncate text-[11px] text-slate-500">{card.user.email}</span>
      </span>
      {badge}
      {canRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${card.user.name} from this department`}
          className="shrink-0 rounded-md p-1.5 text-slate-500 transition hover:bg-danger-50 hover:text-danger-700"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

interface FocusProps {
  column: BoardColumn;
  teams: DepartmentTeam[];
  addableMembers: DeptUser[];
  canManage: boolean;
  canCreateGroups: boolean;
  currentUserLevel: number;
  memberDraft: string;
  setMemberDraft: (value: string) => void;
  onBack: () => void;
  onAddMember: () => void;
  onRemoveMember: (card: PersonCard) => void;
  onCreateTeam: (name: string) => void;
  onDeleteTeam: (teamId: number) => void;
  onAddTeamMember: (teamId: number, userId: number) => void;
  onAddTeamManager: (teamId: number, userId: number) => void;
  onDeleteDepartment: () => void;
}

function Focus({
  column,
  teams,
  addableMembers,
  canManage,
  canCreateGroups,
  currentUserLevel,
  memberDraft,
  setMemberDraft,
  onBack,
  onAddMember,
  onRemoveMember,
  onCreateTeam,
  onDeleteTeam,
  onAddTeamMember,
  onAddTeamManager,
  onDeleteDepartment,
}: FocusProps) {
  const { dept, groups, total, hasLead } = column;
  const [newTeamName, setNewTeamName] = useState('');
  const [teamPicker, setTeamPicker] = useState<{ teamId: number; kind: 'member' | 'manager' } | null>(null);
  const [pick, setPick] = useState<number | ''>('');

  const departmentPeople = useMemo(
    () => groups.flatMap((group) => group.cards).map((card) => card.user),
    [groups]
  );

  const leadership = groups.flatMap((group) => group.cards).filter((card) => card.isLead);
  const leadershipIds = new Set(leadership.map((card) => card.user.id));

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-5">
        <button
          type="button"
          onClick={onBack}
          className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition hover:text-blue-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All departments
        </button>

        <div className="flex flex-wrap items-center gap-4">
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-bold"
            style={departmentStyle(dept.name)}
          >
            {getInitials(dept.name)}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-bold tracking-[-0.028em] text-slate-950">{dept.name}</h2>
            <p className="mt-0.5 text-xs font-medium text-slate-500">
              {describeBreakdown(tierBreakdown(groups.flatMap((group) => group.cards)))} · {teams.length}{' '}
              {teams.length === 1 ? 'team' : 'teams'} ·{' '}
              {hasLead ? `led by ${dept.leadName}` : (
                <span className="font-semibold text-warning-800">no lead assigned</span>
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 p-5">
          {canManage ? (
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex-1">
                <EmployeeSelect
                  employees={addableMembers}
                  value={memberDraft ? Number(memberDraft) : ''}
                  onChange={(value) => setMemberDraft(String(value))}
                  disabled={addableMembers.length === 0}
                  placeholder={
                    addableMembers.length === 0
                      ? 'Everyone is already in a department'
                      : 'Add someone to this department'
                  }
                />
              </div>
              <Button size="sm" iconLeft={<UserPlus2 className="h-4 w-4" />} disabled={!memberDraft} onClick={onAddMember}>
                Add
              </Button>
            </div>
          ) : null}

          {leadership.length > 0 ? (
            <>
              <p className="flex items-center gap-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Leadership <span className="h-px flex-1 bg-slate-100" />
              </p>
              {leadership.map((card) => (
                <PersonRow
                  key={card.user.id}
                  card={card}
                  badge={
                    <span className="shrink-0 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                      {dept.leadLabel || 'Lead'}
                    </span>
                  }
                  canRemove={false}
                  onRemove={() => undefined}
                />
              ))}
            </>
          ) : null}

          {groups.map((group) => {
            const rows = group.cards.filter((card) => !leadershipIds.has(card.user.id));
            if (rows.length === 0 && group.teamId === null) return null;

            return (
              <div key={group.teamId ?? 'none'}>
                <p className="flex items-center gap-2 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  {group.name}
                  {group.teamId !== null && !group.hasManager ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-accent-200 bg-accent-50 px-1.5 py-0.5 text-[9px] text-warning-800">
                      <AlertTriangle className="h-2.5 w-2.5" /> no manager
                    </span>
                  ) : null}
                  <span className="h-px flex-1 bg-slate-100" />
                  <span className="tabular-nums">{rows.length}</span>
                </p>

                {rows.length === 0 ? (
                  <p className="py-2 text-xs text-slate-500">Nobody in this team yet.</p>
                ) : (
                  rows.map((card) => (
                    <PersonRow
                      key={card.user.id}
                      card={card}
                      badge={
                        card.isTeamManager ? (
                          <span className="shrink-0 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                            Team manager
                          </span>
                        ) : undefined
                      }
                      canRemove={canManage && canManagePerson(card.user, currentUserLevel)}
                      onRemove={() => onRemoveMember(card)}
                    />
                  ))
                )}

                {canManage && group.teamId !== null ? (
                  <div className="pb-1 pt-2">
                    {teamPicker && teamPicker.teamId === group.teamId ? (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <div className="flex-1">
                          <EmployeeSelect
                            employees={departmentPeople}
                            value={pick}
                            onChange={setPick}
                            placeholder={teamPicker.kind === 'manager' ? 'Choose a manager' : 'Choose a member'}
                          />
                        </div>
                        <Button
                          size="sm"
                          disabled={pick === ''}
                          onClick={() => {
                            if (typeof pick !== 'number') return;
                            if (teamPicker.kind === 'manager') onAddTeamManager(group.teamId!, pick);
                            else onAddTeamMember(group.teamId!, pick);
                            setPick('');
                            setTeamPicker(null);
                          }}
                        >
                          Add
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setTeamPicker(null); setPick(''); }}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => setTeamPicker({ teamId: group.teamId!, kind: 'member' })}
                          className="text-[11px] font-semibold text-blue-700 transition hover:underline"
                        >
                          + Add member
                        </button>
                        <button
                          type="button"
                          onClick={() => setTeamPicker({ teamId: group.teamId!, kind: 'manager' })}
                          className="text-[11px] font-semibold text-blue-700 transition hover:underline"
                        >
                          + Add manager
                        </button>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <aside className="border-t border-slate-200 bg-slate-50 p-4 lg:border-l lg:border-t-0">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Teams</p>
          <div className="mb-3 rounded-lg border border-slate-200 bg-white px-3">
            {teams.length === 0 ? (
              <p className="py-3 text-xs text-slate-500">No teams yet.</p>
            ) : (
              teams.map((team) => {
                const group = groups.find((candidate) => candidate.teamId === team.id);
                return (
                  <div key={team.id} className="flex items-center gap-2 border-b border-slate-100 py-2 last:border-b-0">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-800">
                      {team.name}
                    </span>
                    {group && !group.hasManager ? (
                      <AlertTriangle className="h-3 w-3 shrink-0 text-accent-500" aria-label="No manager" />
                    ) : null}
                    <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-500">
                      {group?.cards.length ?? 0}
                    </span>
                    {canManage ? (
                      <button
                        type="button"
                        onClick={() => onDeleteTeam(team.id)}
                        aria-label={`Delete team ${team.name}`}
                        className="shrink-0 rounded-md p-1 text-slate-300 transition hover:bg-danger-50 hover:text-danger-700"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>

          {canManage ? (
            <div className="mb-5 flex gap-2">
              <input
                value={newTeamName}
                onChange={(event) => setNewTeamName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && newTeamName.trim()) {
                    onCreateTeam(newTeamName.trim());
                    setNewTeamName('');
                  }
                }}
                placeholder="New team name"
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-500 focus:border-blue-400 focus:outline-none"
              />
              <Button
                size="sm"
                disabled={!newTeamName.trim()}
                onClick={() => {
                  onCreateTeam(newTeamName.trim());
                  setNewTeamName('');
                }}
              >
                Create
              </Button>
            </div>
          ) : null}

          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">About</p>
          <div className="mb-5 rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs leading-relaxed text-slate-600">
              {dept.description || 'No description added yet.'}
            </p>
            <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-[11px]">
              <span className="text-slate-500">Lead</span>
              <span className={hasLead ? 'font-semibold text-slate-800' : 'font-semibold text-warning-800'}>
                {dept.leadName}
              </span>
            </div>
            <div className="flex justify-between border-t border-slate-100 pt-2 text-[11px]">
              <span className="text-slate-500">People</span>
              <span className="font-semibold tabular-nums text-slate-800">{total}</span>
            </div>
          </div>

          {canCreateGroups ? (
            <>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Danger zone
              </p>
              <div className="rounded-lg border border-danger-100 bg-white p-3">
                <p className="text-[13px] font-semibold text-danger-700">Delete department</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                  Members are detached, not deleted. Tasks in this department become unassigned.
                </p>
                <Button size="sm" variant="danger" className="mt-2.5 w-full" onClick={onDeleteDepartment}>
                  Delete {dept.name}
                </Button>
              </div>
            </>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   Export
   ──────────────────────────────────────────────────────────────── */

export interface DepartmentGalleryProps extends Omit<FocusProps, 'column' | 'teams' | 'onBack'> {
  columns: BoardColumn[];
  teamsByDept: Map<number, DepartmentTeam[]>;
  focusedId: number | null;
  onOpen: (deptId: number) => void;
  onBack: () => void;
  onCreateDepartment: () => void;
  departments: DeptInsight[];
}

export default function DepartmentGallery({
  columns,
  teamsByDept,
  focusedId,
  onOpen,
  onBack,
  onCreateDepartment,
  ...focusProps
}: DepartmentGalleryProps) {
  const focused = focusedId === null ? null : columns.find((column) => column.dept.id === focusedId) ?? null;

  if (focused) {
    return (
      <Focus
        {...focusProps}
        column={focused}
        teams={teamsByDept.get(focused.dept.id) ?? []}
        onBack={onBack}
      />
    );
  }

  return (
    <Gallery
      columns={columns}
      teamsByDept={teamsByDept}
      canCreateGroups={focusProps.canCreateGroups}
      onOpen={onOpen}
      onCreateDepartment={onCreateDepartment}
    />
  );
}
