import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Grid3x3, ListTree, Plus, RotateCcw, Shield, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { hasStrictAdminAccess } from '@/lib/permissions';
import { roleApi, permissionApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { FeedbackBanner, PageLoadingState } from '@/components/ui/PageState';
import PermissionMatrix from '@/features/roles/PermissionMatrix';
import RoleLadder from '@/features/roles/RoleLadder';
import {
  byRank,
  countChanges,
  dirtyRoleIds,
  draftFromRoles,
  duplicateLevels,
  type MatrixDraft,
  type PermissionGroup,
  type Role,
  type RoleDraft,
} from '@/features/roles/roleUtils';

type ViewMode = 'matrix' | 'ladder';
const VIEW_STORAGE_KEY = 'roles.view';

export default function RoleManagement() {
  const { user } = useAuth();
  const isAdmin = hasStrictAdminAccess(user);

  const [roles, setRoles] = useState<Role[]>([]);
  const [permGroups, setPermGroups] = useState<PermissionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);

  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'matrix';
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'ladder' ? 'ladder' : 'matrix';
  });

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editorDraft, setEditorDraft] = useState<RoleDraft | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Role | null>(null);

  // Matrix edits are collected here and committed together, so a stray click on
  // a cell never fires a request on its own and can always be discarded.
  const [matrixDraft, setMatrixDraft] = useState<MatrixDraft>(() => new Map());

  useEffect(() => {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  }, [view]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rolesRes, permsRes] = await Promise.all([roleApi.list(), permissionApi.list()]);
      const nextRoles = rolesRes.data.data as Role[];
      setRoles(nextRoles);
      setPermGroups(permsRes.data.data as PermissionGroup[]);
      setMatrixDraft(draftFromRoles(nextRoles));
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to load roles.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const ordered = useMemo(() => byRank(roles), [roles]);
  const clashes = useMemo(() => duplicateLevels(roles), [roles]);
  const pendingChanges = useMemo(() => countChanges(roles, matrixDraft), [roles, matrixDraft]);

  const assignedPeople = useMemo(
    () => roles.reduce((sum, role) => sum + role.users_count, 0),
    [roles]
  );
  const unusedRoles = useMemo(() => roles.filter((role) => role.users_count === 0).length, [roles]);

  useEffect(() => {
    if (selectedId === null && ordered.length > 0) setSelectedId(ordered[0].id);
  }, [ordered, selectedId]);

  /* ── editor ─────────────────────────────────────────────────── */

  const openCreate = () => {
    const nextLevel = roles.length > 0 ? Math.max(...roles.map((role) => role.hierarchy_level)) + 10 : 60;
    setIsCreating(true);
    setFieldErrors({});
    setView('ladder');
    setEditorDraft({ name: '', description: '', hierarchy_level: nextLevel, is_active: true, permissions: [] });
  };

  const openEdit = (role: Role) => {
    setIsCreating(false);
    setFieldErrors({});
    setSelectedId(role.id);
    setEditorDraft({
      id: role.id,
      name: role.name,
      description: role.description,
      hierarchy_level: role.hierarchy_level,
      is_active: role.is_active,
      is_system: role.is_system,
      permissions: [...role.permissions],
    });
  };

  const closeEditor = () => {
    setEditorDraft(null);
    setIsCreating(false);
    setFieldErrors({});
  };

  const handleSave = async () => {
    if (!editorDraft?.name?.trim()) {
      setFeedback({ tone: 'error', message: 'Give the role a name before saving.' });
      return;
    }

    setSaving(true);
    setFeedback(null);
    setFieldErrors({});

    try {
      if (isCreating) {
        await roleApi.create({
          name: editorDraft.name,
          description: editorDraft.description || undefined,
          hierarchy_level: editorDraft.hierarchy_level ?? 60,
          permissions: editorDraft.permissions,
        });
        setFeedback({ tone: 'success', message: `Role “${editorDraft.name}” created.` });
      } else if (editorDraft.id) {
        await roleApi.update(editorDraft.id, {
          name: editorDraft.name || undefined,
          description: editorDraft.description ?? undefined,
          hierarchy_level: editorDraft.is_system ? undefined : editorDraft.hierarchy_level ?? undefined,
          is_active: editorDraft.is_system ? undefined : editorDraft.is_active,
          permissions: editorDraft.permissions,
        });
        setFeedback({ tone: 'success', message: `Role “${editorDraft.name}” updated.` });
      }
      closeEditor();
      await loadData();
    } catch (err: any) {
      const apiErrors = err?.response?.data?.errors;
      if (apiErrors && typeof apiErrors === 'object') {
        setFieldErrors(apiErrors as Record<string, string[]>);
        const firstMessage = (Object.values(apiErrors).flat().find(Boolean) as string) || undefined;
        setFeedback({ tone: 'error', message: firstMessage || 'Some fields need attention.' });
        // Bring the offending field into view rather than leaving the message
        // stranded at the top of a long permission list.
        const firstField = Object.keys(apiErrors)[0];
        window.setTimeout(() => {
          document.querySelector(`[data-field="${firstField}"]`)?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
        }, 80);
      } else {
        setFeedback({ tone: 'error', message: err?.response?.data?.message || 'Could not save that role.' });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (role: Role) => {
    setSaving(true);
    try {
      await roleApi.delete(role.id);
      setFeedback({ tone: 'success', message: `Role “${role.name}” deleted.` });
      setPendingDelete(null);
      closeEditor();
      setSelectedId(null);
      await loadData();
    } catch (err: any) {
      setFeedback({ tone: 'error', message: err?.response?.data?.message || 'Could not delete that role.' });
    } finally {
      setSaving(false);
    }
  };

  /* ── matrix ─────────────────────────────────────────────────── */

  const toggleCell = (roleId: number, permissionKey: string) => {
    setMatrixDraft((current) => {
      const next = new Map(current);
      const granted = new Set(next.get(roleId) ?? []);
      if (granted.has(permissionKey)) granted.delete(permissionKey);
      else granted.add(permissionKey);
      next.set(roleId, granted);
      return next;
    });
  };

  const toggleCellGroup = (roleId: number, group: PermissionGroup, grantAll: boolean) => {
    setMatrixDraft((current) => {
      const next = new Map(current);
      const granted = new Set(next.get(roleId) ?? []);
      group.permissions.forEach((permission) => {
        if (grantAll) granted.add(permission.key);
        else granted.delete(permission.key);
      });
      next.set(roleId, granted);
      return next;
    });
  };

  const saveMatrix = async () => {
    const changed = dirtyRoleIds(roles, matrixDraft);
    if (changed.length === 0) return;

    setSaving(true);
    setFeedback(null);
    try {
      // One request per changed role — the API takes a whole permission set,
      // and there is no bulk endpoint.
      for (const roleId of changed) {
        await roleApi.update(roleId, { permissions: Array.from(matrixDraft.get(roleId) ?? []) });
      }
      setFeedback({
        tone: 'success',
        message: `Saved ${changed.length} role${changed.length === 1 ? '' : 's'}.`,
      });
      await loadData();
    } catch (err: any) {
      setFeedback({
        tone: 'error',
        message: err?.response?.data?.message || 'Could not save those permission changes.',
      });
    } finally {
      setSaving(false);
    }
  };

  const discardMatrix = () => setMatrixDraft(draftFromRoles(roles));

  /**
   * Leaving the matrix with uncommitted cells would strand them: any later save
   * calls `loadData`, which reseeds the draft from the server and wipes them
   * without a word. Ask before that can happen.
   */
  const leaveMatrix = (go: () => void) => {
    if (pendingChanges > 0) {
      const discard = window.confirm(
        `You have ${pendingChanges} unsaved permission change${
          pendingChanges === 1 ? '' : 's'
        }. Leave and discard them?`
      );
      if (!discard) return;
      discardMatrix();
    }
    go();
  };

  if (loading) return <PageLoadingState />;

  return (
    <div className="mx-auto max-w-[100rem] space-y-4 p-4 sm:p-6">
      {/* One toolbar carrying identity, the numbers worth knowing, and the
          controls — replacing a page header, a separate count line and a
          stranded button. */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
            <Shield className="h-4 w-4" />
          </span>
          <div>
            <h1 className="text-lg font-bold tracking-[-0.025em] text-slate-950">Roles &amp; permissions</h1>
            <p className="text-[11px] font-medium text-slate-500">
              <span className="font-bold text-slate-900">{roles.length}</span> roles ·{' '}
              <span className="font-bold text-slate-900">{assignedPeople}</span> people assigned
            </p>
          </div>
        </div>

        {unusedRoles > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-200 bg-accent-50 px-2.5 py-1 text-[11px] font-semibold text-warning-800">
            <Users className="h-3 w-3" />
            {unusedRoles} unused
          </span>
        ) : null}

        {clashes.size > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-200 bg-accent-50 px-2.5 py-1 text-[11px] font-semibold text-warning-800">
            <AlertTriangle className="h-3 w-3" />
            {clashes.size} duplicate level{clashes.size === 1 ? '' : 's'}
          </span>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5" role="group" aria-label="View">
            <button
              type="button"
              aria-pressed={view === 'matrix'}
              onClick={() => setView('matrix')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                view === 'matrix' ? 'bg-white text-slate-950 shadow-card' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Grid3x3 className="h-3.5 w-3.5" /> Matrix
            </button>
            <button
              type="button"
              aria-pressed={view === 'ladder'}
              onClick={() => leaveMatrix(() => setView('ladder'))}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                view === 'ladder' ? 'bg-white text-slate-950 shadow-card' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <ListTree className="h-3.5 w-3.5" /> Hierarchy
            </button>
          </div>

          {isAdmin ? (
            <Button size="sm" onClick={() => leaveMatrix(openCreate)} iconLeft={<Plus className="h-4 w-4" />}>
              New role
            </Button>
          ) : null}
        </div>
      </div>

      {feedback ? (
        <FeedbackBanner tone={feedback.tone} message={feedback.message} onDismiss={() => setFeedback(null)} />
      ) : null}

      {error ? (
        <div className="flex items-center gap-2 rounded-xl border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <Button variant="secondary" size="sm" onClick={() => void loadData()}>
            Retry
          </Button>
        </div>
      ) : null}

      {/* Unsaved matrix edits stay visible and reversible until committed. */}
      {view === 'matrix' && pendingChanges > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5">
          <p className="text-xs font-bold text-blue-900">
            {pendingChanges} unsaved permission change{pendingChanges === 1 ? '' : 's'}
          </p>
          <div className="ml-auto flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={discardMatrix}
              disabled={saving}
              iconLeft={<RotateCcw className="h-3.5 w-3.5" />}
            >
              Discard
            </Button>
            <Button size="sm" onClick={() => void saveMatrix()} loading={saving}>
              Save changes
            </Button>
          </div>
        </div>
      ) : null}

      {view === 'matrix' ? (
        <PermissionMatrix
          roles={ordered}
          groups={permGroups}
          draft={matrixDraft}
          canEdit={isAdmin}
          onToggle={toggleCell}
          onToggleGroup={toggleCellGroup}
          onOpenRole={(roleId) =>
            leaveMatrix(() => {
              setSelectedId(roleId);
              setView('ladder');
            })
          }
        />
      ) : (
        <RoleLadder
          roles={ordered}
          groups={permGroups}
          selectedId={selectedId}
          onSelect={(roleId) => {
            setSelectedId(roleId);
            closeEditor();
          }}
          draft={editorDraft}
          setDraft={setEditorDraft}
          isCreating={isCreating}
          saving={saving}
          canEdit={isAdmin}
          fieldErrors={fieldErrors}
          onEdit={openEdit}
          onSave={() => void handleSave()}
          onCancel={closeEditor}
          onDelete={(role) => setPendingDelete(role)}
        />
      )}

      {/* Deleting a role used to be two adjacent icon buttons. It now names the
          role and says what happens to the people who hold it. */}
      {pendingDelete ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-role-title"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-modal">
            <h2 id="delete-role-title" className="text-base font-bold text-slate-950">
              Delete “{pendingDelete.name}”?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              {pendingDelete.users_count > 0 ? (
                <>
                  <span className="font-semibold text-warning-800">
                    {pendingDelete.users_count} {pendingDelete.users_count === 1 ? 'person holds' : 'people hold'}{' '}
                    this role.
                  </span>{' '}
                  They keep their accounts, but lose the permissions it grants.
                </>
              ) : (
                'Nobody holds this role, so nothing else changes.'
              )}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setPendingDelete(null)} disabled={saving}>
                Keep it
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => void handleDelete(pendingDelete)}
                loading={saving}
              >
                Delete role
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
