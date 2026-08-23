import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  CheckCircle2,
  Columns3,
  LayoutGrid,
  Plus,
  Search,
  Undo2,
} from 'lucide-react';
import { departmentTeamApi } from '@/services/api';
import QuickCreateGroupDialog from '@/components/groups/QuickCreateGroupDialog';
import Button from '@/components/ui/Button';
import { TextInput } from '@/components/ui/FormField';
import DepartmentBoard from './DepartmentBoard';
import DepartmentGallery from './DepartmentGallery';
import {
  buildColumns,
  canManagePerson,
  departmentMatches,
  makeMatcher,
  useDepartmentTeams,
  type DeptInsight,
  type DeptUser,
  type PendingMove,
  type PersonCard,
  type Placement,
} from './departmentUtils';

type ViewMode = 'board' | 'gallery';
const VIEW_STORAGE_KEY = 'departments.view';

interface Feedback {
  tone: 'success' | 'error';
  message: string;
}

/** What has to happen to put a person back where they came from. */
interface UndoableMove {
  userId: number;
  name: string;
  from: Placement;
  to: Placement;
  /** The feedback message this undo belongs to; guards against a stale button. */
  message: string;
}

export interface DepartmentWorkspaceProps {
  groups: any[];
  users: any[];
  customRoles: any[];
  currentUserLevel: number;
  getHierarchyLevel: (user: any) => number;
  canManageDepartments: boolean;
  canCreateGroups: boolean;
  teamInsights: DeptInsight[];
  groupDirectoryQuery: string;
  setGroupDirectoryQuery: (value: string) => void;
  memberDrafts: Record<number, string>;
  setMemberDrafts: (updater: (current: Record<number, string>) => Record<number, string>) => void;
  selectedTeamId: number | null;
  setSelectedTeamId: (value: number | null) => void;
  showGroupModal: boolean;
  setShowGroupModal: (value: boolean) => void;
  feedback: Feedback | null;
  setFeedback: (value: Feedback | null) => void;
  syncMembershipMutation: any;
  handleAddMemberToGroup: (group: any) => void;
  handleRemoveEmployeeFromGroup: (member: any, group: any) => void;
  handleDeleteGroup: (group: any) => void;
}

export default function DepartmentWorkspace({
  groups,
  users,
  currentUserLevel,
  getHierarchyLevel,
  canManageDepartments,
  canCreateGroups,
  teamInsights,
  groupDirectoryQuery,
  setGroupDirectoryQuery,
  memberDrafts,
  setMemberDrafts,
  selectedTeamId,
  setSelectedTeamId,
  showGroupModal,
  setShowGroupModal,
  feedback,
  setFeedback,
  syncMembershipMutation,
  handleAddMemberToGroup,
  handleRemoveEmployeeFromGroup,
  handleDeleteGroup,
}: DepartmentWorkspaceProps) {
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'board';
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'gallery' ? 'gallery' : 'board';
  });
  const [onlyUnled, setOnlyUnled] = useState(false);
  const [pending, setPending] = useState<PendingMove[]>([]);
  const [lastMove, setLastMove] = useState<UndoableMove | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  }, [view]);

  const departmentIds = useMemo(() => teamInsights.map((dept) => dept.id), [teamInsights]);
  const { teamsByDept, refetchDepartments } = useDepartmentTeams(departmentIds);

  /* ── filtering ─────────────────────────────────────────────── */

  const matcher = useMemo(() => makeMatcher(groupDirectoryQuery), [groupDirectoryQuery]);

  const visibleDepartments = useMemo(() => {
    const query = groupDirectoryQuery.trim();
    return teamInsights.filter((dept) => {
      if (onlyUnled && dept.leadName !== 'Not assigned') return false;
      if (!query) return true;
      // A department stays visible if its own name matches, or if anyone in it does.
      return departmentMatches(dept, query) || dept.users.some(matcher);
    });
  }, [teamInsights, groupDirectoryQuery, onlyUnled, matcher]);

  /*
    One call across every visible department, never one call per department: a
    drag that is still in flight relocates its card into a *different* column,
    so the builder has to see the source and the target together. Building each
    column in isolation makes an in-flight cross-department card vanish from
    both — gone from the source it left, unknown to the target it is heading to.
  */
  const columns = useMemo(() => {
    const query = groupDirectoryQuery.trim();
    // When the query matches the department's own name, show everyone in it.
    const matches = (user: DeptUser, dept: DeptInsight) =>
      !query || departmentMatches(dept, query) || matcher(user);

    return buildColumns(visibleDepartments, teamsByDept, pending, matches);
  }, [visibleDepartments, teamsByDept, pending, groupDirectoryQuery, matcher]);

  /* ── stats ─────────────────────────────────────────────────── */

  const totalPeople = useMemo(
    () => teamInsights.reduce((sum, dept) => sum + dept.membersCount, 0),
    [teamInsights]
  );
  const unledCount = useMemo(
    () => teamInsights.filter((dept) => dept.leadName === 'Not assigned').length,
    [teamInsights]
  );

  /* ── helpers ───────────────────────────────────────────────── */

  const findUser = useCallback(
    (userId: number) => users.find((candidate: any) => Number(candidate.id) === Number(userId)),
    [users]
  );

  const findGroup = useCallback(
    (deptId: number) => groups.find((group: any) => Number(group.id) === Number(deptId)),
    [groups]
  );

  const departmentName = useCallback(
    (deptId: number) => teamInsights.find((dept) => dept.id === deptId)?.name ?? 'that department',
    [teamInsights]
  );

  /* ── the move ──────────────────────────────────────────────── */

  /**
   * Moving someone is up to two independent writes: their department membership
   * (`group_ids` on the user) and their team membership (a separate endpoint per
   * department). They run in that order because a team only accepts people who
   * are already in its department.
   *
   * The optimistic `pending` entry is what makes the card land in its new column
   * straight away; it is cleared once the refetch that supersedes it has landed.
   */
  const applyMove = useCallback(
    async (userId: number, name: string, from: Placement, to: Placement, undoable: boolean) => {
      if (from.deptId === to.deptId && from.teamId === to.teamId) return;

      const user = findUser(userId);
      if (!user) {
        setFeedback({ tone: 'error', message: 'That person could not be found — try reloading.' });
        return;
      }

      const move: PendingMove = { userId, fromDeptId: from.deptId, to };
      setPending((current) => [
        ...current.filter((entry) => !(entry.userId === userId && entry.fromDeptId === from.deptId)),
        move,
      ]);
      setBusy(true);

      try {
        if (from.deptId !== to.deptId) {
          // Swap the source department for the target and keep any others. The
          // old "Move to…" menu wrote `[targetId]`, silently dropping every
          // other department the person belonged to.
          const currentIds = (user.groups || []).map((group: any) => Number(group.id));
          const nextIds = Array.from(
            new Set([...currentIds.filter((id: number) => id !== from.deptId), to.deptId])
          );

          await syncMembershipMutation.mutateAsync({
            userId,
            groupIds: nextIds,
            successMessage: `${name} moved to ${departmentName(to.deptId)}.`,
          });
        }

        if (from.teamId !== to.teamId) {
          if (from.teamId !== null) {
            await departmentTeamApi.removeMember(from.deptId, from.teamId, userId);
          }
          if (to.teamId !== null) {
            await departmentTeamApi.addMembers(to.deptId, to.teamId, [userId]);
          }
          await refetchDepartments([from.deptId, to.deptId]);
        }

        const message =
          from.deptId !== to.deptId
            ? `${name} moved to ${departmentName(to.deptId)}.`
            : `${name} moved to a different team.`;

        setFeedback({ tone: 'success', message });
        // Tie the undo to the exact message it belongs to. Any other action
        // that writes feedback replaces the message, and the Undo button
        // disappears with it — rather than lingering beside an unrelated
        // notice and quietly reversing a move the user has moved on from.
        setLastMove(undoable ? { userId, name, from, to, message } : null);
      } catch (error: any) {
        const fieldError = Object.values(error?.response?.data?.errors || {}).flat().find(Boolean);
        setFeedback({
          tone: 'error',
          message: String(fieldError || error?.response?.data?.message || `Could not move ${name}.`),
        });
        setLastMove(null);
      } finally {
        setPending((current) =>
          current.filter((entry) => !(entry.userId === userId && entry.fromDeptId === from.deptId))
        );
        setBusy(false);
      }
    },
    [findUser, setFeedback, syncMembershipMutation, departmentName, refetchDepartments]
  );

  const handleMove = useCallback(
    (card: PersonCard, to: Placement) => {
      void applyMove(card.user.id, card.user.name, { deptId: card.deptId, teamId: card.teamId }, to, true);
    },
    [applyMove]
  );

  const handleUndo = useCallback(() => {
    if (!lastMove) return;
    const { userId, name, from, to } = lastMove;
    setLastMove(null);
    void applyMove(userId, name, to, from, false);
  }, [lastMove, applyMove]);

  const handleRemove = useCallback(
    (card: PersonCard) => {
      const member = findUser(card.user.id);
      const group = findGroup(card.deptId);
      if (!member || !group) return;
      setLastMove(null);
      handleRemoveEmployeeFromGroup(member, group);
    },
    [findUser, findGroup, handleRemoveEmployeeFromGroup]
  );

  /* ── team writes ───────────────────────────────────────────── */

  const runTeamAction = useCallback(
    async (deptId: number, action: () => Promise<unknown>, success: string, failure: string) => {
      setBusy(true);
      try {
        await action();
        await refetchDepartments([deptId]);
        setFeedback({ tone: 'success', message: success });
      } catch (error: any) {
        setFeedback({ tone: 'error', message: String(error?.response?.data?.message || failure) });
      } finally {
        setBusy(false);
      }
    },
    [refetchDepartments, setFeedback]
  );

  const handleCreateTeam = useCallback(
    (deptId: number, name: string) =>
      runTeamAction(
        deptId,
        () => departmentTeamApi.create(deptId, { name }),
        `Team "${name}" created.`,
        'Could not create that team.'
      ),
    [runTeamAction]
  );

  const handleDeleteTeam = useCallback(
    (deptId: number, teamId: number) => {
      if (!window.confirm('Delete this team? Its members stay in the department.')) return;
      void runTeamAction(
        deptId,
        () => departmentTeamApi.remove(deptId, teamId),
        'Team deleted.',
        'Could not delete that team.'
      );
    },
    [runTeamAction]
  );

  const handleDeleteDepartment = useCallback(
    (deptId: number) => {
      const group = findGroup(deptId);
      if (group) handleDeleteGroup(group);
    },
    [findGroup, handleDeleteGroup]
  );

  /* ── focus view plumbing ───────────────────────────────────── */

  const openDepartment = useCallback(
    (deptId: number) => {
      setSelectedTeamId(deptId);
      setView('gallery');
    },
    [setSelectedTeamId]
  );

  const focusedDept = view === 'gallery' ? selectedTeamId : null;

  /*
    Only people who are not yet in any department can be added from here. The
    raw `users` list carries no hierarchy level — that is derived — so the level
    has to be resolved through the parent's `getHierarchyLevel` before the
    permission rule can be applied.
  */
  const addableMembers = useMemo<DeptUser[]>(
    () =>
      users
        .filter((member: any) => member.role !== 'client' && (member.groups || []).length === 0)
        .map((member: any) => ({ ...member, level: getHierarchyLevel(member) }))
        .filter((member: DeptUser) => canManagePerson(member, currentUserLevel)),
    [users, currentUserLevel, getHierarchyLevel]
  );

  /* ── empty state ───────────────────────────────────────────── */

  if (groups.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white px-6 py-20 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
            <Building2 className="h-7 w-7" />
          </div>
          <p className="mt-4 text-lg font-semibold text-slate-900">No departments yet</p>
          <p className="mt-1 max-w-md text-sm text-slate-500">
            Departments group people, carry a lead, and hold teams. Create your first one to get started.
          </p>
          {canCreateGroups ? (
            <Button className="mt-5" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setShowGroupModal(true)}>
              Create your first department
            </Button>
          ) : null}
        </div>
        <QuickCreateGroupDialog open={showGroupModal} onClose={() => setShowGroupModal(false)} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {feedback ? (
        <div
          className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${
            feedback.tone === 'success'
              ? 'border-success-100 bg-success-50 text-success-800'
              : 'border-danger-100 bg-danger-50 text-danger-800'
          }`}
        >
          {feedback.tone === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <p className="flex-1">{feedback.message}</p>
          {feedback.tone === 'success' && lastMove && lastMove.message === feedback.message ? (
            <button
              type="button"
              onClick={handleUndo}
              disabled={busy}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-success-100 bg-white px-2.5 py-1 text-xs font-semibold text-success-800 transition hover:bg-success-50 disabled:opacity-50"
            >
              <Undo2 className="h-3 w-3" /> Undo
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setFeedback(null)}
            aria-label="Dismiss"
            className="shrink-0 px-1 text-slate-500 transition hover:text-slate-700"
          >
            ×
          </button>
        </div>
      ) : null}

      {/*
        One toolbar line in place of the old header block plus four metric cards.
        The only number worth acting on — departments with nobody leading them —
        is a filter rather than a statistic.
      */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-bold tracking-[-0.025em] text-slate-950">Departments</h1>
          <p className="text-xs font-medium text-slate-500">
            <span className="font-bold text-slate-900">{teamInsights.length}</span> departments ·{' '}
            <span className="font-bold text-slate-900">{totalPeople}</span> people
          </p>
        </div>

        {unledCount > 0 ? (
          <button
            type="button"
            aria-pressed={onlyUnled}
            onClick={() => setOnlyUnled((current) => !current)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
              onlyUnled
                ? 'border-accent-400 bg-accent-100 text-warning-800'
                : 'border-accent-200 bg-accent-50 text-warning-800 hover:bg-accent-100'
            }`}
          >
            <AlertTriangle className="h-3 w-3" />
            {unledCount} without a lead{onlyUnled ? ' — showing' : ''}
          </button>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <TextInput
              aria-label="Search people or departments"
              value={groupDirectoryQuery}
              onChange={(event) => setGroupDirectoryQuery(event.target.value)}
              placeholder="Search people or departments"
              className="w-56 pl-9"
            />
          </div>

          <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5" role="group" aria-label="View">
            <button
              type="button"
              aria-pressed={view === 'board'}
              onClick={() => setView('board')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                view === 'board' ? 'bg-white text-slate-950 shadow-card' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Columns3 className="h-3.5 w-3.5" /> Board
            </button>
            <button
              type="button"
              aria-pressed={view === 'gallery'}
              onClick={() => {
                setView('gallery');
                setSelectedTeamId(null);
              }}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                view === 'gallery' ? 'bg-white text-slate-950 shadow-card' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Gallery
            </button>
          </div>

          {canCreateGroups ? (
            <Button size="sm" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setShowGroupModal(true)}>
              New department
            </Button>
          ) : null}
        </div>
      </div>

      {view === 'board' ? (
        <DepartmentBoard
          columns={columns}
          departments={teamInsights}
          canManage={canManageDepartments}
          canCreateGroups={canCreateGroups}
          currentUserLevel={currentUserLevel}
          onMove={handleMove}
          onRemove={handleRemove}
          onOpenDepartment={openDepartment}
          onCreateDepartment={() => setShowGroupModal(true)}
          onCreateTeam={(deptId, name) => void handleCreateTeam(deptId, name)}
          onDeleteDepartment={handleDeleteDepartment}
        />
      ) : (
        <DepartmentGallery
          columns={columns}
          departments={teamInsights}
          teamsByDept={teamsByDept}
          focusedId={focusedDept}
          onOpen={(deptId) => setSelectedTeamId(deptId)}
          onBack={() => setSelectedTeamId(null)}
          onCreateDepartment={() => setShowGroupModal(true)}
          addableMembers={addableMembers}
          canManage={canManageDepartments}
          canCreateGroups={canCreateGroups}
          currentUserLevel={currentUserLevel}
          memberDraft={focusedDept === null ? '' : memberDrafts[focusedDept] ?? ''}
          setMemberDraft={(value) => {
            if (focusedDept === null) return;
            setMemberDrafts((current) => ({ ...current, [focusedDept]: value }));
          }}
          onAddMember={() => {
            const group = focusedDept === null ? null : findGroup(focusedDept);
            if (group) handleAddMemberToGroup(group);
          }}
          onRemoveMember={handleRemove}
          onCreateTeam={(name) => {
            if (focusedDept !== null) void handleCreateTeam(focusedDept, name);
          }}
          onDeleteTeam={(teamId) => {
            if (focusedDept !== null) handleDeleteTeam(focusedDept, teamId);
          }}
          onAddTeamMember={(teamId, userId) => {
            if (focusedDept === null) return;
            void runTeamAction(
              focusedDept,
              () => departmentTeamApi.addMembers(focusedDept, teamId, [userId]),
              'Member added to the team.',
              'Could not add that member.'
            );
          }}
          onAddTeamManager={(teamId, userId) => {
            if (focusedDept === null) return;
            void runTeamAction(
              focusedDept,
              () => departmentTeamApi.addManagers(focusedDept, teamId, [userId]),
              'Team manager added.',
              'Only managers and admins can be team managers.'
            );
          }}
          onDeleteDepartment={() => {
            if (focusedDept !== null) handleDeleteDepartment(focusedDept);
          }}
        />
      )}

      <QuickCreateGroupDialog open={showGroupModal} onClose={() => setShowGroupModal(false)} />
    </div>
  );
}
