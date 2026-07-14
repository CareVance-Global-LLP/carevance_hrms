import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRightLeft,
  Building2,
  CheckCircle2,
  ChevronRight,
  Crown,
  FolderKanban,
  MailPlus,
  MoreVertical,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  UserPlus2,
  UserRound,
  Users,
} from 'lucide-react';
import { departmentTeamApi } from '@/services/api';
import type { DepartmentTeam } from '@/services/api';
import QuickCreateGroupDialog from '@/components/groups/QuickCreateGroupDialog';
import Button from '@/components/ui/Button';
import EmployeeSelect from '@/components/ui/EmployeeSelect';
import { TextInput, TextareaInput } from '@/components/ui/FormField';
import { resolveUserRoleLabel } from '@/lib/permissions';

const polarToCartesian = (cx: number, cy: number, radius: number, angleInDegrees: number) => {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(angleInRadians), y: cy + radius * Math.sin(angleInRadians) };
};

const describeArc = (cx: number, cy: number, radius: number, startAngle: number, endAngle: number) => {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const angleDelta = Math.min(359.999, Math.max(0.001, endAngle - startAngle));
  const largeArcFlag = angleDelta <= 180 ? '0' : '1';
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y} Z`;
};

const getInitials = (value: string) => {
  const parts = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const avatarStyle = (name: string): React.CSSProperties => {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = name.charCodeAt(index) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return { backgroundColor: `hsl(${hue} 68% 92%)`, color: `hsl(${hue} 55% 36%)` };
};

const roleBadgeClass = (label: string) => {
  const normalized = String(label || '').toLowerCase();
  if (normalized.includes('admin')) return 'bg-rose-50 text-rose-700';
  if (normalized.includes('manager')) return 'bg-indigo-50 text-indigo-700';
  return 'bg-slate-100 text-slate-700';
};

function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  accent = 'sky',
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: any;
  accent?: 'sky' | 'emerald' | 'violet' | 'amber' | 'rose' | 'slate';
}) {
  const accentClasses = {
    sky: 'bg-blue-50 text-blue-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    violet: 'bg-violet-50 text-violet-600',
    amber: 'bg-amber-50 text-amber-600',
    rose: 'bg-rose-50 text-rose-600',
    slate: 'bg-slate-100 text-slate-600',
  } as const;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">{label}</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
          {hint ? <p className="mt-2 text-[11px] text-slate-500">{hint}</p> : null}
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-full ${accentClasses[accent]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function MemberActionMenu({
  member,
  otherGroups,
  canManage,
  isPending,
  onMoveTo,
  onRemove,
}: {
  member: any;
  otherGroups: any[];
  canManage: boolean;
  isPending: boolean;
  onMoveTo: (targetGroup: any) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setMoveOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  if (!canManage) {
    return (
      <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500">Only admins can manage</span>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      <Button
        variant="ghost"
        size="sm"
        className="px-2"
        aria-label={`Actions for ${member.name}`}
        onClick={() => {
          setOpen((current) => !current);
          setMoveOpen(false);
        }}
      >
        <MoreVertical className="h-4 w-4" />
      </Button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
          <div className="relative">
            <button
              type="button"
              onClick={() => setMoveOpen((current) => !current)}
              className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50"
            >
              <span className="flex items-center gap-2"><ArrowRightLeft className="h-3.5 w-3.5 text-slate-400" /> Move to…</span>
              <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
            </button>
            {moveOpen ? (
              <div className="absolute left-full top-0 ml-1 max-h-60 w-52 overflow-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                {otherGroups.length === 0 ? (
                  <p className="px-2.5 py-2 text-xs text-slate-400">Create another department first</p>
                ) : (
                  otherGroups.map((targetGroup: any) => (
                    <button
                      key={targetGroup.id}
                      type="button"
                      disabled={isPending}
                      onClick={() => {
                        setOpen(false);
                        setMoveOpen(false);
                        onMoveTo(targetGroup);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] font-semibold text-slate-600">{getInitials(targetGroup.name)}</span>
                      <span className="truncate">{targetGroup.name}</span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
          <div className="my-1 h-px bg-slate-100" />
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Remove from department
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DistributionCard({
  teamInsights,
  pieSegments,
  selectedTeamId,
  onSelect,
  activeTeamId,
  setActiveTeamId,
}: {
  teamInsights: any[];
  pieSegments: any[];
  selectedTeamId: number | null;
  onSelect: (id: number) => void;
  activeTeamId: number | null;
  setActiveTeamId: (id: number | null) => void;
}) {
  if (pieSegments.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Overview</p>
        <p className="mt-3 text-sm text-slate-500">No departments found yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Overview</p>
      <h2 className="mt-1 text-lg font-semibold text-slate-950">Teams distribution</h2>
      <p className="mt-1 text-sm text-slate-500">Headcount across departments. Click a department to view it.</p>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="mx-auto w-full max-w-[15rem]">
          <svg viewBox="0 0 220 220" className="h-full w-full">
            {pieSegments.length === 1 ? (
              <circle
                cx="110"
                cy="110"
                r="88"
                fill={pieSegments[0].color}
                stroke="white"
                strokeWidth={3}
                className="cursor-pointer transition-opacity"
                style={{ opacity: activeTeamId === null || activeTeamId === pieSegments[0].id ? 1 : 0.5 }}
                onMouseEnter={() => setActiveTeamId(pieSegments[0].id)}
                onMouseLeave={() => setActiveTeamId(null)}
                onClick={() => onSelect(pieSegments[0].id)}
              />
            ) : (
              pieSegments.map((team) => (
                <path
                  key={team.id}
                  d={describeArc(110, 110, 88, team.startAngle, team.endAngle)}
                  fill={team.color}
                  stroke="white"
                  strokeWidth={3}
                  className="cursor-pointer transition-opacity"
                  style={{ opacity: activeTeamId === null || activeTeamId === team.id ? 1 : 0.5 }}
                  onMouseEnter={() => setActiveTeamId(team.id)}
                  onMouseLeave={() => setActiveTeamId(null)}
                  onClick={() => onSelect(team.id)}
                />
              ))
            )}
            <circle cx="110" cy="110" r="43" fill="white" />
            <text x="110" y="104" textAnchor="middle" className="fill-slate-500 text-[11px] font-semibold uppercase tracking-[0.22em]">Teams</text>
            <text x="110" y="126" textAnchor="middle" className="fill-slate-900 text-[20px] font-semibold">{teamInsights.length}</text>
          </svg>
        </div>

        <div className="space-y-2">
          {pieSegments.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => onSelect(team.id)}
              onMouseEnter={() => setActiveTeamId(team.id)}
              onMouseLeave={() => setActiveTeamId(null)}
              className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition ${
                selectedTeamId === team.id ? 'border-sky-300 bg-sky-50/60' : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: team.color }} />
                <p className="truncate text-sm font-medium text-slate-900">{team.name}</p>
              </div>
              <p className="text-xs font-semibold text-slate-500">{team.membersCount} · {team.percentage}%</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function DepartmentDetailPanel({
  team,
  membersInGroup,
  addableMembers,
  groups,
  users,
  departmentUsers,
  canManageDepartments,
  currentUserLevel,
  getHierarchyLevel,
  customRoles,
  memberDrafts,
  setMemberDrafts,
  syncMembershipMutation,
  onAddMember,
  onRemoveMember,
}: {
  team: any;
  membersInGroup: any[];
  addableMembers: any[];
  groups: any[];
  users: any[];
  departmentUsers: any[];
  canManageDepartments: boolean;
  currentUserLevel: number;
  getHierarchyLevel: (user: any) => number;
  customRoles: any[];
  memberDrafts: Record<number, string>;
  setMemberDrafts: (updater: (current: Record<number, string>) => Record<number, string>) => void;
  syncMembershipMutation: any;
  onAddMember: (team: any) => void;
  onRemoveMember: (member: any, team: any) => void;
}) {
  const [tab, setTab] = useState<'members' | 'teams'>('teams');
  const otherGroups = groups.filter((group: any) => group.id !== team.id);

  const managerMap = useMemo(() => new Map((users || []).map((u: any) => [Number(u.id), u.name])), [users]);

  const orderedMembers = useMemo(
    () => [...membersInGroup].sort((a, b) => getHierarchyLevel(a) - getHierarchyLevel(b)),
    [membersInGroup, getHierarchyLevel]
  );

  const moveTo = (member: any, targetGroup: any) => {
    syncMembershipMutation.mutate({
      userId: member.id,
      groupIds: [targetGroup.id],
      successMessage: `${member.name} was moved to ${targetGroup.name}.`,
    });
  };

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-semibold" style={avatarStyle(team.name)}>
            {getInitials(team.name)}
          </div>
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold tracking-[-0.03em] text-slate-950">{team.name}</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">{team.description || 'No department description added yet.'}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                <Users className="h-3.5 w-3.5" /> {team.employeeCount} employee{team.employeeCount === 1 ? '' : 's'}
              </span>
              {team.leadName && team.leadName !== 'Not assigned' ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  <UserRound className="h-3.5 w-3.5" /> {team.leadLabel || 'Lead'}: {team.leadName}
                </span>
              ) : null}
              {team.leadEmail ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  <MailPlus className="h-3.5 w-3.5" /> {team.leadEmail}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 flex gap-1 border-b border-slate-200">
        {(['members', 'teams'] as const).map((tabKey) => (
          <button
            key={tabKey}
            type="button"
            onClick={() => setTab(tabKey)}
            className={`px-4 py-2.5 text-sm font-semibold capitalize transition ${
              tab === tabKey ? 'border-b-2 border-sky-500 text-slate-950' : 'border-b-2 border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tabKey === 'members' ? `Members (${membersInGroup.length})` : 'Teams'}
          </button>
        ))}
      </div>

      {tab === 'members' ? (
        <div className="mt-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex-1">
              <EmployeeSelect
                employees={addableMembers}
                value={(memberDrafts[team.id] ?? '') as number | ''}
                onChange={(value) => setMemberDrafts((current) => ({ ...current, [team.id]: String(value) }))}
                disabled={addableMembers.length === 0 || syncMembershipMutation.isPending}
                placeholder="Select a member to add"
              />
            </div>
            <Button
              size="sm"
              variant="primary"
              iconLeft={<UserPlus2 className="h-4 w-4" />}
              disabled={!memberDrafts[team.id] || syncMembershipMutation.isPending || !canManageDepartments}
              onClick={() => onAddMember(team)}
            >
              {syncMembershipMutation.isPending ? 'Saving...' : 'Add Member'}
            </Button>
          </div>

          <div className="mt-4 space-y-2">
            {membersInGroup.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                No members are assigned to this department yet.
              </div>
            ) : (
              orderedMembers.map((member: any) => {
                const canManageMembership = getHierarchyLevel(member) >= 100 || (getHierarchyLevel(member) <= 50 && currentUserLevel <= 10);
                return (
                  <div key={member.id} className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-slate-300 hover:shadow-sm">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold" style={avatarStyle(member.name)}>
                      {getInitials(member.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-slate-950">{member.name}</p>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${roleBadgeClass(resolveUserRoleLabel(member, customRoles))}`}>
                          {resolveUserRoleLabel(member, customRoles)}
                        </span>
                      </div>
                      <p className="truncate text-xs text-slate-500">{member.email}</p>
                      {(() => {
                        const rmId = member.employeeWorkInfo?.reporting_manager_id;
                        if (rmId == null) return null;
                        const name = managerMap.get(Number(rmId));
                        return <p className="mt-0.5 text-[11px] text-slate-400">Reports to: {name ?? `Manager #${rmId}`}</p>;
                      })()}
                    </div>
                    <div className="opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                      <MemberActionMenu
                        member={member}
                        otherGroups={otherGroups}
                        canManage={canManageMembership}
                        isPending={syncMembershipMutation.isPending}
                        onMoveTo={(targetGroup) => moveTo(member, targetGroup)}
                        onRemove={() => onRemoveMember(member, team)}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <div className="mt-5">
          <DepartmentTeamsPanel
            departmentId={team.id}
            users={users}
            departmentUsers={departmentUsers}
            departmentName={team.name}
            leadName={team.leadName}
          />
        </div>
      )}
    </div>
  );
}

function DepartmentTeamsPanel({
  departmentId,
  users,
  departmentUsers,
  departmentName,
  leadName,
}: {
  departmentId: number;
  users: any[];
  departmentUsers: any[];
  departmentName?: string;
  leadName?: string;
}) {
  const [teams, setTeams] = useState<DepartmentTeam[]>([]);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const employeeMap = useMemo(() => {
    const map = new Map<number, any>();
    users.forEach((u) => map.set(u.id, u));
    return map;
  }, [users]);

  const employeeName = (id?: number) => (id ? employeeMap.get(id)?.name ?? `User #${id}` : '—');

  // People in the department who are NOT inside any team → "Direct reports".
  const teamMemberIds = useMemo(() => {
    const ids = new Set<number>();
    teams.forEach((t: any) => {
      (t.member_ids ?? t.members?.map((m: any) => m.id) ?? []).forEach((id: any) => ids.add(Number(id)));
      (t.manager_ids ?? t.managers?.map((m: any) => m.id) ?? []).forEach((id: any) => ids.add(Number(id)));
    });
    return ids;
  }, [teams]);

  const directMembers = useMemo(
    () => (departmentUsers || []).filter((u: any) => !teamMemberIds.has(Number(u.id))),
    [departmentUsers, teamMemberIds]
  );
  const directManagers = useMemo(
    () => directMembers.filter((u: any) => u.role === 'manager' || u.role === 'admin'),
    [directMembers]
  );
  const directEmployees = useMemo(
    () => directMembers.filter((u: any) => u.role !== 'manager' && u.role !== 'admin'),
    [directMembers]
  );

  const loadTeams = useCallback(async () => {
    setLoading(true);
    try {
      const res = await departmentTeamApi.list(departmentId);
      setTeams(res.data.data ?? []);
    } catch (e: any) {
      setFeedback({ tone: 'error', message: e?.response?.data?.message ?? 'Failed to load teams.' });
    } finally {
      setLoading(false);
    }
  }, [departmentId]);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  const handleCreate = async () => {
    if (!newName.trim()) {
      setFeedback({ tone: 'error', message: 'Please enter a team name.' });
      return;
    }
    try {
      await departmentTeamApi.create(departmentId, {
        name: newName.trim(),
        description: newDescription.trim() || undefined,
      });
      setNewName('');
      setNewDescription('');
      setFeedback({ tone: 'success', message: 'Team created.' });
      await loadTeams();
    } catch (e: any) {
      setFeedback({ tone: 'error', message: e?.response?.data?.message ?? 'Failed to create team.' });
    }
  };

  const handleDelete = async (teamId: number) => {
    if (!window.confirm('Delete this team? Members and manager assignments will be removed.')) return;
    try {
      await departmentTeamApi.remove(departmentId, teamId);
      setFeedback({ tone: 'success', message: 'Team deleted.' });
      await loadTeams();
    } catch (e: any) {
      setFeedback({ tone: 'error', message: e?.response?.data?.message ?? 'Failed to delete team.' });
    }
  };

  const handleAddMembers = async (teamId: number, userIds: number[]) => {
    if (userIds.length === 0) return;
    try {
      await departmentTeamApi.addMembers(departmentId, teamId, userIds);
      setFeedback({ tone: 'success', message: 'Member(s) added.' });
      await loadTeams();
    } catch (e: any) {
      setFeedback({ tone: 'error', message: e?.response?.data?.message ?? 'Failed to add member(s).' });
    }
  };

  const handleRemoveMember = async (teamId: number, userId: number) => {
    try {
      await departmentTeamApi.removeMember(departmentId, teamId, userId);
      await loadTeams();
    } catch (e: any) {
      setFeedback({ tone: 'error', message: e?.response?.data?.message ?? 'Failed to remove member.' });
    }
  };

  const handleAddManagers = async (teamId: number, userIds: number[]) => {
    if (userIds.length === 0) return;
    try {
      await departmentTeamApi.addManagers(departmentId, teamId, userIds);
      setFeedback({ tone: 'success', message: 'Manager(s) added.' });
      await loadTeams();
    } catch (e: any) {
      setFeedback({
        tone: 'error',
        message: e?.response?.data?.message ?? 'Failed to add manager(s). Only managers/admins can be team managers.',
      });
    }
  };

  const handleRemoveManager = async (teamId: number, userId: number) => {
    try {
      await departmentTeamApi.removeManager(departmentId, teamId, userId);
      await loadTeams();
    } catch (e: any) {
      setFeedback({ tone: 'error', message: e?.response?.data?.message ?? 'Failed to remove manager.' });
    }
  };

  return (
    <div className="mt-2 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
      <div className="flex items-center gap-2">
        <FolderKanban className="h-4 w-4 text-indigo-600" />
        <h4 className="text-sm font-semibold text-slate-900">Teams inside this department</h4>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Create teams with unlimited members and unlimited managers (any higher-up). Team members can view
        department-wise tasks, and team managers can forward approvals to other department managers.
      </p>

      {feedback ? (
        <div
          className={`mt-2 rounded-lg border p-2 text-xs ${
            feedback.tone === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-rose-200 bg-rose-50 text-rose-700'
          }`}
        >
          {feedback.message}
        </div>
      ) : null}

      {/* Create team */}
      <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
        <div>
          <TextInput value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New team name" />
        </div>
        <div>
          <TextareaInput
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={1}
          />
        </div>
        <Button size="sm" onClick={handleCreate} disabled={!newName.trim() || loading}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Create team
        </Button>
      </div>

      {/* Hierarchy: Department → Direct reports + Teams */}
      <div className="mt-4">
        <div className="flex items-center gap-3 rounded-xl border-2 border-slate-300 bg-white p-3 shadow-sm">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Building2 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Department</p>
            <p className="truncate text-sm font-semibold text-slate-900">{departmentName || 'Department'}</p>
          </div>
          {leadName && leadName !== 'Not assigned' ? (
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              <UserRound className="h-3.5 w-3.5" /> {leadName}
            </span>
          ) : null}
        </div>

        <div className="ml-6 mt-0 border-l-2 border-slate-200 pl-5">
          {loading ? (
            <p className="py-3 text-xs text-slate-500">Loading teams…</p>
          ) : directMembers.length === 0 && teams.length === 0 ? (
            <p className="py-3 text-xs text-slate-500">No teams or direct members yet in this department.</p>
          ) : (
            <>
              {directMembers.length > 0 ? (
                <div className="mb-3">
                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    <UserRound className="h-3 w-3" /> Direct reports
                    <span className="rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-600">{directMembers.length}</span>
                  </p>
                  <div className="space-y-1.5">
                    {directManagers.map((u: any) => (
                      <div key={u.id} className="flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50/50 px-2.5 py-1.5">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600" title="Department manager">
                          <Crown className="h-3 w-3" />
                        </span>
                        <span className="flex-1 truncate text-sm font-semibold text-slate-800">{u.name}</span>
                      </div>
                    ))}
                    {directEmployees.map((u: any) => (
                      <div key={u.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">
                          {getInitials(u.name)}
                        </span>
                        <span className="flex-1 truncate text-sm text-slate-700">{u.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {teams.map((team) => (
                <div key={team.id} className="mb-3">
                  <TeamCard
                    team={team}
                    users={departmentUsers}
                    employeeName={employeeName}
                    onAddMembers={(ids) => handleAddMembers(team.id, ids)}
                    onRemoveMember={(uid) => handleRemoveMember(team.id, uid)}
                    onAddManagers={(ids) => handleAddManagers(team.id, ids)}
                    onRemoveManager={(uid) => handleRemoveManager(team.id, uid)}
                    onDelete={() => handleDelete(team.id)}
                  />
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TeamCard({
  team,
  users,
  employeeName,
  onAddMembers,
  onRemoveMember,
  onAddManagers,
  onRemoveManager,
  onDelete,
}: {
  team: DepartmentTeam;
  users: any[];
  employeeName: (id?: number) => string;
  onAddMembers: (userIds: number[]) => void;
  onRemoveMember: (userId: number) => void;
  onAddManagers: (userIds: number[]) => void;
  onRemoveManager: (userId: number) => void;
  onDelete: () => void;
}) {
  const [memberPicker, setMemberPicker] = useState<number | ''>('');
  const [managerPicker, setManagerPicker] = useState<number | ''>('');

  const memberIds = team.member_ids ?? team.members?.map((m) => m.id) ?? [];
  const managerIds = team.manager_ids ?? team.managers?.map((m) => m.id) ?? [];

  const addMember = () => {
    if (typeof memberPicker === 'number') {
      onAddMembers([memberPicker]);
      setMemberPicker('');
    }
  };

  const addManager = () => {
    if (typeof managerPicker === 'number') {
      onAddManagers([managerPicker]);
      setManagerPicker('');
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <FolderKanban className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h5 className="truncate text-sm font-semibold text-slate-900">{team.name}</h5>
            {team.description ? <p className="mt-0.5 text-xs text-slate-500">{team.description}</p> : null}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onDelete} className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 shrink-0">
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </Button>
      </div>

      <p className="mt-3 text-[11px] text-slate-500">
        {managerIds.length === 0
          ? `${memberIds.length} member${memberIds.length === 1 ? '' : 's'} · no team manager yet`
          : `${managerIds.length} team manager${managerIds.length === 1 ? '' : 's'} jointly oversee ${memberIds.length} member${memberIds.length === 1 ? '' : 's'}`}
      </p>

      <div className="mt-3 space-y-3">
        <section>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            <Crown className="h-3 w-3 text-indigo-500" /> Team managers
            <span className="rounded-full bg-indigo-100 px-1.5 text-[10px] text-indigo-700">{managerIds.length}</span>
          </p>
          {managerIds.length === 0 ? (
            <span className="text-xs text-slate-400">No managers assigned</span>
          ) : (
            <div className="space-y-1.5">
              {managerIds.map((id) => (
                <div
                  key={id}
                  className="flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50/50 px-2.5 py-1.5"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600" title="Team manager">
                    <Crown className="h-3 w-3" />
                  </span>
                  <span className="flex-1 truncate text-sm font-semibold text-slate-800">{employeeName(id)}</span>
                  <button type="button" onClick={() => onRemoveManager(id)} className="text-indigo-400 transition hover:text-rose-600" aria-label={`Remove manager ${employeeName(id)}`}>
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1">
              <EmployeeSelect employees={users} value={managerPicker} onChange={setManagerPicker} placeholder="Add manager (higher-up)" />
            </div>
            <Button size="sm" variant="secondary" onClick={addManager} disabled={managerPicker === ''}>
              Add
            </Button>
          </div>
          <p className="mt-2 text-[10px] text-slate-400">Only managers/admins can be assigned. A team may have any number of managers.</p>
        </section>

        {managerIds.length > 0 && memberIds.length > 0 ? (
          <div className="ml-3 border-l-2 border-indigo-100 pl-3" />
        ) : null}

        <section>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            <Users className="h-3 w-3" /> Members
            <span className="rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-600">{memberIds.length}</span>
          </p>
          {memberIds.length === 0 ? (
            <span className="text-xs text-slate-400">No members</span>
          ) : (
            <div className="space-y-1.5">
              {memberIds.map((id) => (
                <div
                  key={id}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">
                    {getInitials(employeeName(id))}
                  </span>
                  <span className="flex-1 truncate text-sm text-slate-700">{employeeName(id)}</span>
                  <button type="button" onClick={() => onRemoveMember(id)} className="text-slate-400 transition hover:text-rose-600" aria-label={`Remove ${employeeName(id)}`}>
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1">
              <EmployeeSelect employees={users} value={memberPicker} onChange={setMemberPicker} placeholder="Add member" />
            </div>
            <Button size="sm" variant="secondary" onClick={addMember} disabled={memberPicker === ''}>
              Add
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}

export interface DepartmentWorkspaceProps {
  groups: any[];
  users: any[];
  customRoles: any[];
  currentUserLevel: number;
  getHierarchyLevel: (user: any) => number;
  canManageDepartments: boolean;
  canCreateGroups: boolean;
  teamInsights: any[];
  pieSegments: any[];
  selectedDepartmentUsers: any[];
  groupDirectoryQuery: string;
  setGroupDirectoryQuery: (value: string) => void;
  memberDrafts: Record<number, string>;
  setMemberDrafts: (updater: (current: Record<number, string>) => Record<number, string>) => void;
  selectedTeamId: number | null;
  setSelectedTeamId: (value: number | null) => void;
  activeTeamId: number | null;
  setActiveTeamId: (value: number | null) => void;
  showGroupModal: boolean;
  setShowGroupModal: (value: boolean) => void;
  feedback: { tone: 'success' | 'error'; message: string } | null;
  setFeedback: (value: { tone: 'success' | 'error'; message: string } | null) => void;
  syncMembershipMutation: any;
  handleAddMemberToGroup: (group: any) => void;
  handleRemoveEmployeeFromGroup: (member: any, group: any) => void;
  handleDeleteGroup: (group: any) => void;
}

export default function DepartmentWorkspace({
  groups,
  users,
  customRoles,
  currentUserLevel,
  getHierarchyLevel,
  canManageDepartments,
  canCreateGroups,
  teamInsights,
  pieSegments,
  selectedDepartmentUsers,
  groupDirectoryQuery,
  setGroupDirectoryQuery,
  memberDrafts,
  setMemberDrafts,
  selectedTeamId,
  setSelectedTeamId,
  activeTeamId,
  setActiveTeamId,
  showGroupModal,
  setShowGroupModal,
  feedback,
  setFeedback,
  syncMembershipMutation,
  handleAddMemberToGroup,
  handleRemoveEmployeeFromGroup,
  handleDeleteGroup,
}: DepartmentWorkspaceProps) {
  const [showManagerHint, setShowManagerHint] = useState(true);
  const internalUsers = useMemo(() => users.filter((member: any) => member.role !== 'client'), [users]);
  const findUserById = (userId: number) => users.find((candidate: any) => Number(candidate.id) === Number(userId));
  const canManageGroupMember = (member: any) => {
    const memberLevel = getHierarchyLevel(member);
    return memberLevel >= 100 || (memberLevel <= 50 && currentUserLevel <= 10);
  };
  const isEligibleForDirectGroupAdd = (member: any) => canManageGroupMember(member) && (member.groups || []).length === 0;

  const filteredDirectoryGroups = useMemo(() => {
    const needle = groupDirectoryQuery.trim().toLowerCase();
    if (!needle) return groups;
    return groups.filter((group: any) => {
      const searchable = [group.name, group.description].filter(Boolean).join(' ').toLowerCase();
      return searchable.includes(needle);
    });
  }, [groupDirectoryQuery, groups]);

  useEffect(() => {
    if (selectedTeamId === null && teamInsights.length > 0) {
      setSelectedTeamId(teamInsights[0].id);
    }
  }, [teamInsights, selectedTeamId, setSelectedTeamId]);

  const totalDepartmentEmployees = useMemo(
    () => teamInsights.reduce((sum: number, team: any) => sum + team.employeeCount, 0),
    [teamInsights]
  );
  const managedDepartmentsCount = useMemo(
    () => teamInsights.filter((team: any) => team.managerName !== 'Not assigned').length,
    [teamInsights]
  );
  const avgEmployeesPerDepartment = useMemo(
    () => (teamInsights.length ? (totalDepartmentEmployees / teamInsights.length).toFixed(1) : '0.0'),
    [teamInsights, totalDepartmentEmployees]
  );

  return (
    <div className="space-y-5">
      {feedback ? (
        <div
          className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${
            feedback.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'
          }`}
        >
          {feedback.tone === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          <p className="flex-1">{feedback.message}</p>
          <button onClick={() => setFeedback(null)} className={feedback.tone === 'success' ? 'text-emerald-500 hover:text-emerald-700' : 'text-rose-400 hover:text-rose-600'}>×</button>
        </div>
      ) : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-600">Employee management</p>
          <div className="flex items-center gap-2">
            <h1 className="mt-1 text-3xl font-semibold tracking-[-0.04em] text-slate-950">Teams / Departments</h1>
            {showManagerHint ? (
              <span className="relative mt-1 inline-flex">
                <button
                  type="button"
                  aria-label="What is a team manager vs reporting manager?"
                  onClick={() => setShowManagerHint(false)}
                  className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 text-[11px] font-bold text-slate-500 transition hover:bg-slate-100"
                >
                  ?
                </button>
                <span className="absolute left-6 top-1/2 z-20 w-72 -translate-y-1/2 rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-600 shadow-lg">
                  <span className="mb-1 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-semibold text-slate-800">
                      <Crown className="h-3.5 w-3.5 text-indigo-500" /> Team Manager
                    </span>
                    <button type="button" onClick={() => setShowManagerHint(false)} className="text-slate-400 transition hover:text-slate-600" aria-label="Dismiss">×</button>
                  </span>
                  Oversees a team&apos;s day-to-day work inside a department.
                  <span className="mt-2 flex items-center gap-1.5 font-semibold text-slate-800">
                    <ArrowRightLeft className="h-3.5 w-3.5 text-slate-400" /> Reporting Manager
                  </span>
                  Your approval line — who signs off on your requests.
                </span>
              </span>
            ) : null}
          </div>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Organise people into departments, move members between them, and manage teams — all from one calm workspace.
          </p>
        </div>
        {canCreateGroups ? (
          <Button variant="primary" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setShowGroupModal(true)}>
            New department
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Total Departments" value={teamInsights.length} hint="Active team groups" icon={Building2} accent="sky" />
        <MetricCard label="Department Employees" value={totalDepartmentEmployees} hint="Employees in departments" icon={Users} accent="emerald" />
        <MetricCard label="Managed Departments" value={managedDepartmentsCount} hint="Assigned manager/admin" icon={UserRound} accent="violet" />
        <MetricCard label="Avg Employees/Dept" value={avgEmployeesPerDepartment} hint="Average headcount" icon={SlidersHorizontal} accent="amber" />
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-20 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
            <Building2 className="h-7 w-7" />
          </div>
          <p className="mt-4 text-lg font-semibold text-slate-900">No departments yet</p>
          <p className="mt-1 max-w-md text-sm text-slate-500">
            Departments help you group people, assign leads, and manage teams. Create your first one to get started.
          </p>
          {canCreateGroups ? (
            <Button className="mt-5" variant="primary" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setShowGroupModal(true)}>
              Create your first department
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_1fr]">
          <div className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 p-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <TextInput
                  aria-label="Search departments"
                  value={groupDirectoryQuery}
                  onChange={(event) => setGroupDirectoryQuery(event.target.value)}
                  placeholder="Search departments"
                  className="pl-10"
                />
              </div>
            </div>
            <div className="max-h-[64vh] flex-1 overflow-y-auto p-3">
              {filteredDirectoryGroups.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-sm text-slate-500">No departments match your search.</div>
              ) : (
                <ul className="space-y-1.5">
                  {filteredDirectoryGroups.map((group: any) => {
                    const membersInGroup = (group.users || [])
                      .map((member: any) => findUserById(member.id) || member)
                      .filter((member: any) => Boolean(member) && member.role !== 'client');
                    const isSelected = selectedTeamId === Number(group.id);
                    return (
                      <li key={group.id}>
                        <div className={`group flex items-center gap-3 rounded-xl border p-3 transition ${isSelected ? 'border-sky-300 bg-sky-50/60' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                          <button
                            type="button"
                            onClick={() => setSelectedTeamId(Number(group.id))}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          >
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold" style={avatarStyle(group.name)}>
                              {getInitials(group.name)}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-950">{group.name}</p>
                              <p className="truncate text-xs text-slate-500">
                                {membersInGroup.length} member{membersInGroup.length === 1 ? '' : 's'}
                                {membersInGroup.length > 0
                                  ? (() => {
                                      const top = [...membersInGroup].sort(
                                        (a, b) => getHierarchyLevel(a) - getHierarchyLevel(b)
                                      )[0];
                                      return ` · led by ${top.name}`;
                                    })()
                                  : ''}
                              </p>
                            </div>
                          </button>
                          {canCreateGroups ? (
                            <button
                              type="button"
                              aria-label={`Delete ${group.name}`}
                              disabled={false}
                              onClick={() => handleDeleteGroup(group)}
                              className="shrink-0 rounded-md p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            {selectedTeamId === null ? (
              <div className="flex h-full flex-col items-center justify-center py-16 text-center text-sm text-slate-500">
                Select a department from the list to view its members and teams.
              </div>
            ) : (
              teamInsights
                .filter((team) => team.id === selectedTeamId)
                .map((team) => {
                  const membersInGroup = (team.users || [])
                    .map((member: any) => findUserById(member.id) || member)
                    .filter((member: any) => Boolean(member) && member.role !== 'client');
                  const addableMembers = internalUsers.filter((member: any) => isEligibleForDirectGroupAdd(member));
                  return (
                    <DepartmentDetailPanel
                      key={team.id}
                      team={team}
                      membersInGroup={membersInGroup}
                      addableMembers={addableMembers}
                      groups={groups}
                      users={users}
                      departmentUsers={selectedDepartmentUsers}
                      canManageDepartments={canManageDepartments}
                      currentUserLevel={currentUserLevel}
                      getHierarchyLevel={getHierarchyLevel}
                      customRoles={customRoles}
                      memberDrafts={memberDrafts}
                      setMemberDrafts={setMemberDrafts}
                      syncMembershipMutation={syncMembershipMutation}
                      onAddMember={handleAddMemberToGroup}
                      onRemoveMember={handleRemoveEmployeeFromGroup}
                    />
                  );
                })
            )}
          </div>
        </div>
      )}

      {groups.length > 0 ? (
        <DistributionCard
          teamInsights={teamInsights}
          pieSegments={pieSegments}
          selectedTeamId={selectedTeamId}
          onSelect={(id) => setSelectedTeamId(id)}
          activeTeamId={activeTeamId}
          setActiveTeamId={setActiveTeamId}
        />
      ) : null}

      <QuickCreateGroupDialog open={showGroupModal} onClose={() => setShowGroupModal(false)} />
    </div>
  );
}
