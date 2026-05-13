import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { groupApi, projectApi } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';
import { FeedbackBanner, PageEmptyState, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { FieldLabel, SelectInput } from '@/components/ui/FormField';
import { Plus, Edit2, Trash2, Clock, DollarSign } from 'lucide-react';
import type { Project } from '@/types';
import { useAuth } from '@/contexts/AuthContext';

const defaultColors = ['#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899', '#6366F1', '#14B8A6'];

export default function Projects() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [formData, setFormData] = useState<{
    name: string;
    group_id: string;
    description: string;
    color: string;
    budget: string;
    status: string;
  }>({
    name: '',
    group_id: '',
    description: '',
    color: defaultColors[0],
    budget: '',
    status: 'active'
  });

  const {
    data: projects = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.projects,
    queryFn: async () => {
      const response = await projectApi.getAll();
      return response.data;
    },
  });

  const groupsQuery = useQuery({
    queryKey: queryKeys.groups,
    queryFn: async () => (await groupApi.getAll()).data?.data || [],
  });
  const groups = groupsQuery.data || [];
  const isManagerWithSingleGroup = user?.role === 'manager' && groups.length === 1;
  const managerGroupId = isManagerWithSingleGroup ? String(groups[0].id) : '';

  useEffect(() => {
    if (!isManagerWithSingleGroup) return;
    setFormData((current) => (current.group_id === managerGroupId ? current : { ...current, group_id: managerGroupId }));
  }, [isManagerWithSingleGroup, managerGroupId]);

  const saveProjectMutation = useMutation({
    mutationFn: async (data: Partial<Project>) => {
      if (editingProject) {
        await projectApi.update(editingProject.id, data);
        return 'Project updated';
      }

      await projectApi.create(data);
      return 'Project created';
    },
    onSuccess: async (message) => {
      setFeedback({ tone: 'success', message });
      setShowModal(false);
      resetForm();
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
    onError: (mutationError: any) => {
      setFeedback({
        tone: 'error',
        message: mutationError?.response?.data?.message || 'Failed to save project.',
      });
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async (id: number) => {
      await projectApi.delete(id);
    },
    onSuccess: async () => {
      setFeedback({ tone: 'success', message: 'Project deleted' });
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
    onError: (mutationError: any) => {
      setFeedback({
        tone: 'error',
        message: mutationError?.response?.data?.message || 'Failed to delete project.',
      });
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const data: Partial<Project> = {
      ...formData,
      group_id: formData.group_id ? Number(formData.group_id) : undefined,
      status: formData.status as Project['status'],
      budget: formData.budget ? parseFloat(formData.budget) : undefined,
    };
    await saveProjectMutation.mutateAsync(data);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this project?')) return;
    setFeedback(null);
    await deleteProjectMutation.mutateAsync(id);
  };

  const resetForm = () => {
    setFormData({ name: '', group_id: '', description: '', color: defaultColors[0], budget: '', status: 'active' });
    setEditingProject(null);
  };

  const openEditModal = (project: Project) => {
    setEditingProject(project);
    setFormData({
      name: project.name,
      group_id: project.group_id ? String(project.group_id) : '',
      description: project.description || '',
      color: project.color,
      budget: project.budget?.toString() || '',
      status: project.status
    });
    setShowModal(true);
  };

  if (isLoading || groupsQuery.isLoading) {
    return <PageLoadingState label="Loading projects..." />;
  }

  if (isError || groupsQuery.isError) {
    return (
      <PageErrorState
        message={(error as any)?.response?.data?.message || (groupsQuery.error as any)?.response?.data?.message || 'Failed to load projects.'}
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
          <p className="text-gray-500 mt-1">Manage your projects</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowModal(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
        >
          <Plus className="h-5 w-5" />
          New Project
        </button>
      </div>

      {/* Projects Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.length === 0 ? (
          <div className="col-span-full">
            <PageEmptyState
              title="No projects yet"
              description="Create your first project to get started."
            />
          </div>
        ) : (
          projects.map((project) => (
            <div key={project.id} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg" style={{ backgroundColor: project.color }} />
                  <div>
                    <h3 className="font-semibold text-gray-900">{project.name}</h3>
                    <p className="text-sm text-gray-500 capitalize">
                      {project.group?.name ? `${project.group.name} - ` : ''}{project.status.replace('_', ' ')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openEditModal(project)} className="p-2 text-gray-400 hover:text-gray-600">
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button onClick={() => handleDelete(project.id)} className="p-2 text-gray-400 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {project.description && (
                <p className="mt-3 text-sm text-gray-600 line-clamp-2">{project.description}</p>
              )}
              <div className="mt-4 flex items-center gap-4 text-sm text-gray-500">
                <div className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  <span>0h</span>
                </div>
                {project.budget && (
                  <div className="flex items-center gap-1">
                    <DollarSign className="h-4 w-4" />
                    <span>${project.budget}</span>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h2 className="text-xl font-semibold mb-4">{editingProject ? 'Edit Project' : 'New Project'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <FieldLabel>Group</FieldLabel>
                {isManagerWithSingleGroup ? (
                  <div className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700">
                    {groups[0]?.name || 'Assigned group'}
                  </div>
                ) : (
                  <SelectInput
                    required
                    value={formData.group_id}
                    onChange={(e) => setFormData({ ...formData, group_id: e.target.value })}
                  >
                    <option value="">Select group</option>
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>{group.name}</option>
                    ))}
                  </SelectInput>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500"
                  rows={3}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
                <div className="flex gap-2">
                  {defaultColors.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setFormData({ ...formData, color })}
                      className={`h-8 w-8 rounded-lg ${formData.color === color ? 'ring-2 ring-offset-2 ring-primary-500' : ''}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Budget (optional)</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.budget}
                  onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saveProjectMutation.isPending}
                  className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                >
                  {saveProjectMutation.isPending ? 'Saving...' : editingProject ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
