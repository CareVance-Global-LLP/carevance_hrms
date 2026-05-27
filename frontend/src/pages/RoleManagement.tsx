import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { hasStrictAdminAccess } from '@/lib/permissions';
import { roleApi, permissionApi } from '@/services/api';
import { Shield, Plus, Pencil, Trash2, X, Users } from 'lucide-react';
import Button from '@/components/ui/Button';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { FeedbackBanner, PageLoadingState } from '@/components/ui/PageState';

interface Role {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  hierarchy_level: number;
  is_system: boolean;
  is_active: boolean;
  users_count: number;
  permissions: string[];
}

interface PermissionGroup {
  group: string;
  permissions: Array<{
    key: string;
    name: string;
    description: string | null;
    plan_feature: string | null;
  }>;
}

export default function RoleManagement() {
  const { user } = useAuth();

  const [roles, setRoles] = useState<Role[]>([]);
  const [permGroups, setPermGroups] = useState<PermissionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const [editingRole, setEditingRole] = useState<Partial<Role> & { permissions: string[] } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<number | null>(null);

  const isAdmin = hasStrictAdminAccess(user);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [rolesRes, permsRes] = await Promise.all([
        roleApi.list(),
        permissionApi.list(),
      ]);
      setRoles(rolesRes.data.data);
      setPermGroups(permsRes.data.data);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    const defaultLevel = roles.length > 0
      ? Math.max(...roles.map(r => r.hierarchy_level)) + 10
      : 60;
    setIsCreating(true);
    setEditingRole({
      name: '',
      description: '',
      hierarchy_level: defaultLevel,
      is_active: true,
      permissions: [],
    });
  };

  const openEdit = (role: Role) => {
    setIsCreating(false);
    setEditingRole({
      id: role.id,
      name: role.name,
      description: role.description,
      hierarchy_level: role.hierarchy_level,
      is_active: role.is_active,
      is_system: role.is_system,
      permissions: [...role.permissions],
    });
  };

  const closeForm = () => {
    setEditingRole(null);
    setIsCreating(false);
  };

  const handleSave = async () => {
    if (!editingRole) return;
    if (!editingRole.name?.trim()) {
      setFeedback({ tone: 'error', message: 'Role name is required' });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      if (isCreating) {
        await roleApi.create({
          name: editingRole.name,
          description: editingRole.description || undefined,
          hierarchy_level: editingRole.hierarchy_level ?? 60,
          permissions: editingRole.permissions,
        });
        setFeedback({ tone: 'success', message: 'Role created successfully' });
      } else if (editingRole.id) {
        await roleApi.update(editingRole.id, {
          name: editingRole.name || undefined,
          description: editingRole.description !== undefined ? editingRole.description : undefined,
          hierarchy_level: editingRole.is_system ? undefined : (editingRole.hierarchy_level ?? undefined),
          is_active: editingRole.is_system ? undefined : editingRole.is_active,
          permissions: editingRole.permissions,
        });
        setFeedback({ tone: 'success', message: 'Role updated successfully' });
      }
      closeForm();
      await loadData();
    } catch (err: any) {
      setFeedback({ tone: 'error', message: err?.response?.data?.message || 'Failed to save role' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (roleId: number) => {
    setSaving(true);
    try {
      await roleApi.delete(roleId);
      setFeedback({ tone: 'success', message: 'Role deleted' });
      setShowDeleteConfirm(null);
      await loadData();
    } catch (err: any) {
      setFeedback({ tone: 'error', message: err?.response?.data?.message || 'Failed to delete role' });
    } finally {
      setSaving(false);
    }
  };

  const togglePermission = (key: string) => {
    if (!editingRole) return;
    const perms = editingRole.permissions;
    const idx = perms.indexOf(key);
    if (idx >= 0) {
      setEditingRole({ ...editingRole, permissions: perms.filter(p => p !== key) });
    } else {
      setEditingRole({ ...editingRole, permissions: [...perms, key] });
    }
  };

  if (loading) return <PageLoadingState />;

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Role Management"
        description="Create and manage custom job roles with granular permissions"
      />

      {feedback && (
        <FeedbackBanner
          tone={feedback.tone}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
          <button onClick={loadData} className="ml-2 underline">Retry</button>
        </div>
      )}

      {!editingRole && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">{roles.length} role{roles.length !== 1 ? 's' : ''}</p>
            {isAdmin && (
              <Button onClick={openCreate} iconLeft={<Plus className="h-4 w-4" />}>
                Create Role
              </Button>
            )}
          </div>

          <div className="grid gap-3">
            {roles.map((role) => (
              <SurfaceCard key={role.id} className="flex items-center justify-between p-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-950">{role.name}</span>
                    {role.is_system && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">System</span>
                    )}
                    {!role.is_active && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">Inactive</span>
                    )}
                  </div>
                  {role.description && (
                    <p className="mt-0.5 text-sm text-slate-500 truncate">{role.description}</p>
                  )}
                  <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
                    <span>Level {role.hierarchy_level}</span>
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {role.users_count} user{role.users_count !== 1 ? 's' : ''}
                    </span>
                    <span>{role.permissions.length} permission{role.permissions.length !== 1 ? 's' : ''}</span>
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-1 shrink-0 ml-4">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(role)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {!role.is_system && (
                      <>
                        {showDeleteConfirm === role.id ? (
                          <div className="flex items-center gap-1">
                            <Button variant="danger" size="sm" onClick={() => handleDelete(role.id)} disabled={saving}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setShowDeleteConfirm(null)}>
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => setShowDeleteConfirm(role.id)}>
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </SurfaceCard>
            ))}
          </div>
        </div>
      )}

      {editingRole && (
        <SurfaceCard className="p-6">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-950">
              {isCreating ? 'Create Role' : `Edit ${editingRole.name}`}
            </h2>
            <Button variant="ghost" size="sm" onClick={closeForm}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Role Name</label>
              <input
                type="text"
                value={editingRole.name || ''}
                onChange={(e) => setEditingRole({ ...editingRole, name: e.target.value })}
                placeholder="e.g. Team Lead"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                disabled={saving}
              />
            </div>
            {!editingRole.is_system && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Hierarchy Level</label>
                <p className="mb-2 text-xs text-slate-400">Lower = higher rank (Admin=10, Manager=50, Employee=100)</p>
                
                {/* Show used levels */}
                {roles.length > 0 && (
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-slate-400">In use:</span>
                    {roles
                      .filter(r => r.id !== editingRole.id)
                      .sort((a, b) => a.hierarchy_level - b.hierarchy_level)
                      .map((role) => (
                        <span 
                          key={role.id}
                          className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
                          title={role.name}
                        >
                          {role.hierarchy_level}
                          <span className="text-slate-400">({role.name})</span>
                        </span>
                      ))}
                  </div>
                )}
                
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={editingRole.hierarchy_level ?? ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') {
                      setEditingRole({ ...editingRole, hierarchy_level: undefined });
                    } else {
                      const num = parseInt(val);
                      if (!isNaN(num)) {
                        setEditingRole({ ...editingRole, hierarchy_level: num });
                      }
                    }
                  }}
                  onBlur={(e) => {
                    const val = e.target.value;
                    if (val === '' || isNaN(parseInt(val))) {
                      setEditingRole({ ...editingRole, hierarchy_level: 60 });
                    }
                  }}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  disabled={saving}
                />
                
                {/* Warning for duplicate level */}
                {editingRole.hierarchy_level && 
                  roles.some(r => r.id !== editingRole.id && r.hierarchy_level === editingRole.hierarchy_level) && (
                  <p className="mt-1 text-xs text-amber-600">
                    Warning: This level is already assigned to another role
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <input
              type="text"
              value={editingRole.description || ''}
              onChange={(e) => setEditingRole({ ...editingRole, description: e.target.value })}
              placeholder="What this role can do"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              disabled={saving}
            />
          </div>

          {!editingRole.is_system && (
            <div className="mt-4 flex items-center gap-3">
              <span className="text-sm font-medium text-slate-700">Active</span>
              <button
                type="button"
                role="switch"
                aria-checked={editingRole.is_active ?? true}
                onClick={() => setEditingRole({ ...editingRole, is_active: !(editingRole.is_active ?? true) })}
                className={`relative inline-flex h-7 w-12 items-center rounded-full border transition ${
                  (editingRole.is_active ?? true) ? 'border-sky-400 bg-sky-500/90' : 'border-slate-200 bg-slate-200'
                }`}
                disabled={saving}
              >
                <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition ${
                  (editingRole.is_active ?? true) ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>
          )}

          <div className="mt-8">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-slate-700">Permissions</h3>
              <p className="text-xs text-slate-500 mt-1">
                Select what actions this role can perform. Hover over each permission to see more details.
              </p>
            </div>
            {permGroups.length === 0 ? (
              <p className="text-sm text-slate-400">No permissions available for your plan</p>
            ) : (
              <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                {permGroups
                  .filter((group) => !['Payroll', 'Invoices'].includes(group.group))
                  .map((group) => (
                  <div key={group.group} className="break-inside-avoid">
                    <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {group.group}
                    </h4>
                    <div className="space-y-0.5">
                      {group.permissions.map((perm) => {
                        const enabled = editingRole.permissions.includes(perm.key);
                        return (
                          <label
                            key={perm.key}
                            className="flex items-start gap-2 cursor-pointer group py-1 rounded hover:bg-slate-50 transition"
                            title={perm.description || ''}
                          >
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={() => togglePermission(perm.key)}
                              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 shrink-0"
                              disabled={saving}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-sm font-medium text-slate-700 group-hover:text-slate-950">
                                  {perm.name}
                                </span>
                                {perm.plan_feature && (
                                  <span className="rounded bg-amber-50 px-1 py-0 text-[10px] font-medium text-amber-600">
                                    {perm.plan_feature}
                                  </span>
                                )}
                              </div>
                              {perm.description && (
                                <p className="text-[11px] text-slate-500 leading-snug">
                                  {perm.description}
                                </p>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-8 flex items-center justify-end gap-3">
            <Button variant="secondary" onClick={closeForm} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !editingRole.name?.trim()}>
              {saving ? 'Saving...' : isCreating ? 'Create Role' : 'Save Changes'}
            </Button>
          </div>
        </SurfaceCard>
      )}
    </div>
  );
}
