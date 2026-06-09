import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Target,
  Plus,
  Edit3,
  Trash2,
  X,
  CheckCircle2,
  AlertCircle,
  Calendar,
  User,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  Award,
  Clock,
  Filter,
  Search,
} from 'lucide-react';
import { performanceApi, type PerformanceGoal } from '@/services/performanceApi';
import { useAuth } from '@/contexts/AuthContext';
import Button from '@/components/ui/Button';
import { TextInput, TextareaInput as TextArea, SelectInput } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';
import { canAccess } from '@/lib/permissions';

function GoalCard({
  goal,
  onEdit,
  onDelete,
  canManage,
}: {
  goal: PerformanceGoal;
  onEdit: (goal: PerformanceGoal) => void;
  onDelete: (id: number) => void;
  canManage: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'development':
        return 'bg-blue-100 text-blue-700';
      case 'performance':
        return 'bg-emerald-100 text-emerald-700';
      case 'behavior':
        return 'bg-purple-100 text-purple-700';
      case 'project':
        return 'bg-amber-100 text-amber-700';
      default:
        return 'bg-slate-100 text-slate-700';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-emerald-100 text-emerald-700';
      case 'completed':
        return 'bg-blue-100 text-blue-700';
      case 'cancelled':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-slate-100 text-slate-700';
    }
  };

  return (
    <div className="border border-slate-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStatusColor(goal.status)}`}>
              {goal.status}
            </span>
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getCategoryColor(goal.category)} capitalize`}>
              {goal.category}
            </span>
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 text-slate-600">
              Weight: {goal.weight}%
            </span>
          </div>
          <h3 className="font-semibold text-slate-900">{goal.title}</h3>
          <p className="text-sm text-slate-500 mt-1">
            {goal.employee?.name || 'Unknown'} • {new Date(goal.start_date).toLocaleDateString()} - {new Date(goal.end_date).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <>
              <button
                onClick={() => onEdit(goal)}
                className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-md transition-colors"
              >
                <Edit3 className="h-4 w-4" />
              </button>
              <button
                onClick={() => onDelete(goal.id)}
                className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-md transition-colors"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-md transition-colors"
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-slate-700">Progress</span>
          <span className="text-sm font-medium text-slate-900">{goal.progress_percentage}%</span>
        </div>
        <div className="w-full bg-slate-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${
              goal.progress_percentage >= 100
                ? 'bg-emerald-500'
                : goal.progress_percentage >= 50
                ? 'bg-blue-500'
                : 'bg-amber-500'
            }`}
            style={{ width: `${Math.min(goal.progress_percentage, 100)}%` }}
          />
        </div>
      </div>

      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          {goal.description && (
            <div className="mb-4">
              <h4 className="text-sm font-medium text-slate-700 mb-2">Description</h4>
              <p className="text-sm text-slate-600">{goal.description}</p>
            </div>
          )}

          {goal.target_metrics && (
            <div className="mb-4">
              <h4 className="text-sm font-medium text-slate-700 mb-2">Target Metrics</h4>
              <div className="bg-slate-50 rounded-lg p-3">
                <pre className="text-xs text-slate-600 overflow-x-auto">
                  {JSON.stringify(goal.target_metrics, null, 2)}
                </pre>
              </div>
            </div>
          )}

          <div className="text-sm text-slate-500">
            <p>Manager: {goal.manager?.name || 'Not assigned'}</p>
            <p>Created: {new Date(goal.created_at).toLocaleDateString()}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PerformanceGoalsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<PerformanceGoal | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: 'development',
    start_date: '',
    end_date: '',
    weight: '100',
    target_metrics: '',
    progress_percentage: '0',
    status: 'active',
  });

  const { data: goals, isLoading } = useQuery({
    queryKey: ['performance-goals'],
    queryFn: () => performanceApi.getGoals(),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => performanceApi.createGoal(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['performance-goals'] });
      setShowModal(false);
      setSuccessMessage('Performance goal created successfully.');
      setErrorMessage(null);
      resetForm();
    },
    onError: (err: any) => {
      setErrorMessage(err?.response?.data?.message || err?.message || 'Failed to create goal.');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      performanceApi.updateGoal(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['performance-goals'] });
      setShowModal(false);
      setEditingGoal(null);
      setSuccessMessage('Performance goal updated successfully.');
      setErrorMessage(null);
      resetForm();
    },
    onError: (err: any) => {
      setErrorMessage(err?.response?.data?.message || err?.message || 'Failed to update goal.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => performanceApi.deleteGoal(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['performance-goals'] });
      setSuccessMessage('Goal deleted successfully.');
    },
    onError: (err: any) => {
      setErrorMessage(err?.response?.data?.message || err?.message || 'Failed to delete goal.');
    },
  });

  const resetForm = () => {
    setFormData({
      title: '',
      description: '',
      category: 'development',
      start_date: '',
      end_date: '',
      weight: '100',
      target_metrics: '',
      progress_percentage: '0',
      status: 'active',
    });
  };

  const handleEdit = (goal: PerformanceGoal) => {
    setEditingGoal(goal);
    setFormData({
      title: goal.title,
      description: goal.description || '',
      category: goal.category,
      start_date: goal.start_date,
      end_date: goal.end_date,
      weight: goal.weight.toString(),
      target_metrics: goal.target_metrics ? JSON.stringify(goal.target_metrics, null, 2) : '',
      progress_percentage: goal.progress_percentage.toString(),
      status: goal.status,
    });
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const data = {
      ...formData,
      weight: parseInt(formData.weight),
      progress_percentage: parseInt(formData.progress_percentage),
      target_metrics: formData.target_metrics ? JSON.parse(formData.target_metrics) : null,
    };

    if (editingGoal) {
      updateMutation.mutate({ id: editingGoal.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const canManageGoals = canAccess(user, 'performance.manage');
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  // Filter goals
  const filteredGoals = goals?.filter((goal) => {
    if (statusFilter !== 'all' && goal.status !== statusFilter) return false;
    if (categoryFilter !== 'all' && goal.category !== categoryFilter) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="Performance Goals"
        description="Set and track employee performance goals"
      />

      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {successMessage && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <span className="text-sm text-emerald-800">{successMessage}</span>
            <button onClick={() => setSuccessMessage(null)} className="ml-auto">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {errorMessage && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <span className="text-sm text-red-800">{errorMessage}</span>
            <button onClick={() => setErrorMessage(null)} className="ml-auto">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Filters */}
        <SurfaceCard className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-slate-500" />
              <span className="text-sm font-medium text-slate-700">Filters:</span>
            </div>
            <SelectInput
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-32"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </SelectInput>
            <SelectInput
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-40"
            >
              <option value="all">All Categories</option>
              <option value="development">Development</option>
              <option value="performance">Performance</option>
              <option value="behavior">Behavior</option>
              <option value="project">Project</option>
            </SelectInput>
          </div>
        </SurfaceCard>

        {/* Goals List */}
        <SurfaceCard className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Performance Goals</h2>
              <p className="text-sm text-slate-500">
                {filteredGoals?.length || 0} goals
              </p>
            </div>
            {(canManageGoals || isAdmin) && (
              <Button onClick={() => { setEditingGoal(null); resetForm(); setShowModal(true); }}>
                <Plus className="h-4 w-4 mr-2" /> New Goal
              </Button>
            )}
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900"></div>
            </div>
          ) : filteredGoals?.length === 0 ? (
            <div className="text-center py-12">
              <Target className="h-12 w-12 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-slate-900 mb-2">No goals yet</h3>
              <p className="text-sm text-slate-500 max-w-md mx-auto">
                Create performance goals to track employee development and achievements.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredGoals?.map((goal) => (
                <GoalCard
                  key={goal.id}
                  goal={goal}
                  onEdit={handleEdit}
                  onDelete={(id) => deleteMutation.mutate(id)}
                  canManage={canManageGoals || isAdmin}
                />
              ))}
            </div>
          )}
        </SurfaceCard>

        {/* Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-slate-200">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-slate-900">
                    {editingGoal ? 'Edit Performance Goal' : 'Create Performance Goal'}
                  </h2>
                  <button
                    onClick={() => { setShowModal(false); setEditingGoal(null); }}
                    className="text-slate-400 hover:text-slate-600"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Title *
                  </label>
                  <TextInput
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="Enter goal title"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Description
                  </label>
                  <TextArea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={3}
                    placeholder="Enter goal description"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Category *
                    </label>
                    <SelectInput
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                      required
                    >
                      <option value="development">Development</option>
                      <option value="performance">Performance</option>
                      <option value="behavior">Behavior</option>
                      <option value="project">Project</option>
                    </SelectInput>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Status *
                    </label>
                    <SelectInput
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                      required
                    >
                      <option value="active">Active</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                    </SelectInput>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Start Date *
                    </label>
                    <TextInput
                      type="date"
                      value={formData.start_date}
                      onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      End Date *
                    </label>
                    <TextInput
                      type="date"
                      value={formData.end_date}
                      onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Weight (%)
                    </label>
                    <TextInput
                      type="number"
                      min="1"
                      max="100"
                      value={formData.weight}
                      onChange={(e) => setFormData({ ...formData, weight: e.target.value })}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Progress (%)
                    </label>
                    <TextInput
                      type="number"
                      min="0"
                      max="100"
                      value={formData.progress_percentage}
                      onChange={(e) => setFormData({ ...formData, progress_percentage: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Target Metrics (JSON)
                  </label>
                  <TextArea
                    value={formData.target_metrics}
                    onChange={(e) => setFormData({ ...formData, target_metrics: e.target.value })}
                    rows={4}
                    placeholder='{"target": 100, "unit": "hours", "current": 75}'
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Enter valid JSON format for target metrics
                  </p>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => { setShowModal(false); setEditingGoal(null); }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={createMutation.isPending || updateMutation.isPending}
                  >
                    {createMutation.isPending || updateMutation.isPending
                      ? 'Saving...'
                      : editingGoal
                      ? 'Update Goal'
                      : 'Create Goal'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
