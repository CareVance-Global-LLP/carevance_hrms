import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { 
  Crown,
  Plus,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  Edit3,
  Trash2,
  Users,
  IndianRupee,
  Star,
  LayoutGrid,
  List,
  ChevronRight,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { superAdminApi } from '@/services/superAdminApi';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import { PageLoadingState, PageErrorState, PageEmptyState } from '@/components/ui/PageState';
import { FeedbackBanner } from '@/components/ui/PageState';

interface Plan {
  id: number;
  code: string;
  name: string;
  description: string;
  price_monthly: number;
  price_yearly: number | null;
  max_employees: number;
  features: string[];
  is_active: boolean;
  is_popular: boolean;
  display_order: number;
}

interface FeatureMatrix {
  plans: Plan[];
  features: Record<string, string>;
  matrix: Array<{
    feature_key: string;
    feature_name: string;
    [planCode: string]: boolean | string;
  }>;
}

export default function PlansManagement() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<'cards' | 'matrix'>('cards');
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const { data: plansData, isLoading: plansLoading, error: plansError } = useQuery({
    queryKey: ['super-admin', 'plans'],
    queryFn: async () => {
      const response = await superAdminApi.getPlans();
      return response.data.data as Plan[];
    },
  });

  const { data: matrixData, isLoading: matrixLoading } = useQuery({
    queryKey: ['super-admin', 'plans', 'matrix'],
    queryFn: async () => {
      const response = await superAdminApi.getPlanComparison();
      return response.data.data as FeatureMatrix;
    },
    enabled: viewMode === 'matrix',
  });

  const toggleFeatureMutation = useMutation({
    mutationFn: async ({ planCode, feature, enabled }: { planCode: string; feature: string; enabled: boolean }) => {
      return superAdminApi.togglePlanFeature(planCode, feature, enabled);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admin', 'plans'] });
      setFeedback({ tone: 'success', message: 'Feature updated successfully' });
    },
    onError: () => {
      setFeedback({ tone: 'error', message: 'Failed to update feature' });
    },
  });

  const deletePlanMutation = useMutation({
    mutationFn: async (code: string) => {
      return superAdminApi.deletePlan(code);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admin', 'plans'] });
      setFeedback({ tone: 'success', message: 'Plan deleted successfully' });
    },
    onError: (error: any) => {
      setFeedback({ tone: 'error', message: error.response?.data?.message || 'Failed to delete plan' });
    },
  });

  const togglePlanStatusMutation = useMutation({
    mutationFn: async ({ code, isActive }: { code: string; isActive: boolean }) => {
      return superAdminApi.updatePlan(code, { is_active: isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admin', 'plans'] });
      setFeedback({ tone: 'success', message: 'Plan status updated' });
    },
    onError: () => {
      setFeedback({ tone: 'error', message: 'Failed to update plan status' });
    },
  });

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(price);
  };

  const getMaxEmployeesLabel = (count: number) => {
    return count === -1 ? 'Unlimited' : `${count} employees`;
  };

  if (plansLoading) {
    return <PageLoadingState label="Loading plans..." />;
  }

  if (plansError) {
    return <PageErrorState message="Failed to load plans" />;
  }

  const plans: Plan[] = plansData || [];

  return (
    <div className="min-h-screen bg-slate-50/50">
      <PageHeader
        title="Plan Management"
        description="Manage subscription plans and feature access"
        actions={
          <div className="flex items-center gap-2">
            <div className="flex bg-slate-100 rounded-lg p-1 mr-2">
              <button
                onClick={() => setViewMode('cards')}
                className={`p-2 rounded-md transition-all ${viewMode === 'cards' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-600 hover:text-slate-900'}`}
                title="Card view"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode('matrix')}
                className={`p-2 rounded-md transition-all ${viewMode === 'matrix' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-600 hover:text-slate-900'}`}
                title="Feature matrix"
              >
                <List className="h-4 w-4" />
              </button>
            </div>
            <Button variant="secondary" onClick={() => navigate('/super-admin')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <Button variant="primary" onClick={() => setIsCreateModalOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Plan
            </Button>
          </div>
        }
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {feedback && (
          <FeedbackBanner 
            tone={feedback.tone} 
            message={feedback.message} 
            className="mb-6"
            onDismiss={() => setFeedback(null)}
          />
        )}

        {viewMode === 'cards' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {plans.length > 0 ? (
              plans.map((plan) => (
                <SurfaceCard 
                  key={plan.code}
                  className={`p-6 transition-all duration-300 hover:shadow-xl ${
                    plan.is_popular ? 'ring-2 ring-amber-400' : ''
                  } ${!plan.is_active ? 'opacity-60' : ''}`}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-xl font-bold text-slate-900">{plan.name}</h3>
                        {plan.is_popular && (
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded-full flex items-center gap-1">
                            <Star className="h-3 w-3" />
                            Popular
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-500 mt-1">{plan.description}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setEditingPlan(plan)}
                        className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
                        title="Edit plan"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('Are you sure you want to delete this plan?')) {
                            deletePlanMutation.mutate(plan.code);
                          }
                        }}
                        className="p-2 hover:bg-rose-100 rounded-lg text-rose-600 transition-colors"
                        title="Delete plan"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Pricing */}
                  <div className="mb-6">
                    <div className="flex items-baseline gap-1">
                      <IndianRupee className="h-6 w-6 text-slate-900" />
                      <span className="text-4xl font-bold text-slate-900">
                        {Math.floor(plan.price_monthly).toLocaleString()}
                      </span>
                      <span className="text-slate-500">/month</span>
                    </div>
                    {plan.price_yearly && (
                      <p className="text-sm text-emerald-600 mt-1">
                        ₹{Math.floor(plan.price_yearly / 12).toLocaleString()}/month billed annually
                      </p>
                    )}
                  </div>

                  {/* Limits */}
                  <div className="flex items-center gap-2 text-sm text-slate-600 mb-4">
                    <Users className="h-4 w-4" />
                    <span>Up to {getMaxEmployeesLabel(plan.max_employees)}</span>
                  </div>

                  {/* Features */}
                  <div className="space-y-2 mb-6">
                    {plan.features && plan.features.length > 0 ? (
                      plan.features.slice(0, 6).map((feature) => (
                        <div key={feature} className="flex items-center gap-2 text-sm">
                          <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                          <span className="text-slate-700 capitalize">
                            {feature.replace(/_/g, ' ')}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-slate-400">No features configured</p>
                    )}
                    {plan.features && plan.features.length > 6 && (
                      <p className="text-xs text-slate-400 pl-6">
                        +{plan.features.length - 6} more features
                      </p>
                    )}
                  </div>

                  {/* Status Toggle */}
                  <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-sm text-slate-500">
                      {plan.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <button
                      onClick={() => togglePlanStatusMutation.mutate({ code: plan.code, isActive: !plan.is_active })}
                      disabled={togglePlanStatusMutation.isPending}
                      className="transition-colors"
                    >
                      {plan.is_active ? (
                        <ToggleRight className="h-6 w-6 text-emerald-500" />
                      ) : (
                        <ToggleLeft className="h-6 w-6 text-slate-400" />
                      )}
                    </button>
                  </div>
                </SurfaceCard>
              ))
            ) : (
              <PageEmptyState
                title="No plans configured"
                description="Create your first subscription plan to get started"
                action={
                  <Button variant="primary" onClick={() => setIsCreateModalOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Plan
                  </Button>
                }
              />
            )}
          </div>
        ) : (
          /* Feature Matrix View */
          <SurfaceCard className="p-0 overflow-hidden">
            {matrixLoading ? (
              <div className="p-8 text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto text-blue-600 mb-2" />
                <p className="text-slate-500">Loading feature matrix...</p>
              </div>
            ) : matrixData ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-6 py-4 text-left text-sm font-medium text-slate-700 sticky left-0 bg-slate-50 z-10">
                        Feature
                      </th>
                      {matrixData.plans.map((plan) => (
                        <th key={plan.code} className="px-4 py-4 text-center text-sm font-medium text-slate-700 min-w-[120px]">
                          <div className="flex flex-col items-center gap-1">
                            <span>{plan.name}</span>
                            {plan.is_popular && (
                              <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full">
                                Popular
                              </span>
                            )}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {matrixData.matrix.map((row) => (
                      <tr key={row.feature_key} className="hover:bg-slate-50/50">
                        <td className="px-6 py-3 text-sm text-slate-700 sticky left-0 bg-white z-10 font-medium">
                          {row.feature_name}
                        </td>
                        {matrixData.plans.map((plan) => {
                          const isEnabled = row[plan.code] as boolean;
                          return (
                            <td key={plan.code} className="px-4 py-3 text-center">
                              <button
                                onClick={() => toggleFeatureMutation.mutate({
                                  planCode: plan.code,
                                  feature: row.feature_key as string,
                                  enabled: !isEnabled,
                                })}
                                disabled={toggleFeatureMutation.isPending}
                                className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
                              >
                                {isEnabled ? (
                                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                                ) : (
                                  <XCircle className="h-5 w-5 text-slate-300" />
                                )}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <PageEmptyState title="No data available" />
            )}
          </SurfaceCard>
        )}
      </div>
    </div>
  );
}
