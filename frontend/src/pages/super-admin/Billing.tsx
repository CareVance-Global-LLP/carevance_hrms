import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { 
  DollarSign, 
  TrendingUp,
  TrendingDown,
  Users,
  Building2,
  CreditCard,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Calendar,
  CheckCircle2,
  Clock,
  AlertCircle
} from 'lucide-react';
import { superAdminApi } from '@/services/superAdminApi';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import { PageLoadingState, PageErrorState, PageEmptyState } from '@/components/ui/PageState';

interface RevenueData {
  total_revenue: number;
  monthly_recurring_revenue: number;
  revenue_growth: number;
  total_paid_subscriptions: number;
  total_trialing_subscriptions: number;
  total_past_due_subscriptions: number;
  average_revenue_per_user: number;
}

interface Subscription {
  id: number;
  organization_id: number;
  organization_name: string;
  plan_name: string;
  plan_price: number;
  status: string;
  current_period_start: string;
  current_period_end: string;
  created_at: string;
}

export default function SuperAdminBilling() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const { data: revenueData, isLoading: isRevenueLoading, error: revenueError } = useQuery({
    queryKey: ['super-admin', 'revenue'],
    queryFn: async () => {
      const response = await superAdminApi.getRevenue();
      return response.data.data as RevenueData;
    },
  });

  const { data: subscriptionsData, isLoading: isSubscriptionsLoading, error: subscriptionsError } = useQuery({
    queryKey: ['super-admin', 'subscriptions', page],
    queryFn: async () => {
      const response = await superAdminApi.getSubscriptions({ page });
      return response.data;
    },
  });

  const isLoading = isRevenueLoading || isSubscriptionsLoading;
  const error = revenueError || subscriptionsError;

  if (isLoading) {
    return <PageLoadingState label="Loading billing data..." />;
  }

  if (error) {
    return <PageErrorState message="Failed to load billing data" />;
  }

  const subscriptions: Subscription[] = subscriptionsData?.data || [];
  const pagination = {
    current_page: subscriptionsData?.current_page || 1,
    last_page: subscriptionsData?.last_page || 1,
  };

  const formatCurrency = (amount: number) => {
    // Handle NaN or invalid values
    if (isNaN(amount) || amount === null || amount === undefined) {
      return '₹0.00';
    }
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <CheckCircle2 className="h-5 w-5 text-emerald-600" />;
      case 'trialing':
        return <Clock className="h-5 w-5 text-blue-600" />;
      case 'past_due':
        return <AlertCircle className="h-5 w-5 text-rose-600" />;
      default:
        return <AlertCircle className="h-5 w-5 text-slate-400" />;
    }
  };

  const getStatusTone = (status: string): 'success' | 'warning' | 'danger' | 'neutral' => {
    switch (status) {
      case 'active':
        return 'success';
      case 'trialing':
        return 'warning';
      case 'past_due':
        return 'danger';
      default:
        return 'neutral';
    }
  };

  const revenue = revenueData || {
    total_revenue: 0,
    monthly_recurring_revenue: 0,
    revenue_growth: 0,
    total_paid_subscriptions: 0,
    total_trialing_subscriptions: 0,
    total_past_due_subscriptions: 0,
    average_revenue_per_user: 0,
  };

  return (
    <div className="min-h-screen bg-slate-50/50">
      <PageHeader
        title="Revenue & Billing"
        description="View subscription details and revenue metrics"
        actions={
          <Button variant="secondary" onClick={() => navigate('/super-admin')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        }
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {/* Revenue Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <SurfaceCard className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">Total Revenue</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {formatCurrency(revenue.total_revenue)}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-emerald-50">
                <DollarSign className="h-6 w-6 text-emerald-600" />
              </div>
            </div>
          </SurfaceCard>

          <SurfaceCard className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">Monthly Recurring Revenue</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {formatCurrency(revenue.monthly_recurring_revenue)}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-blue-50">
                <TrendingUp className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </SurfaceCard>

          <SurfaceCard className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">Revenue Growth</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {revenue.revenue_growth > 0 ? '+' : ''}{revenue.revenue_growth}%
                </p>
              </div>
              <div className={`p-3 rounded-lg ${revenue.revenue_growth >= 0 ? 'bg-emerald-50' : 'bg-rose-50'}`}>
                {revenue.revenue_growth >= 0 ? (
                  <TrendingUp className="h-6 w-6 text-emerald-600" />
                ) : (
                  <TrendingDown className="h-6 w-6 text-rose-600" />
                )}
              </div>
            </div>
          </SurfaceCard>

          <SurfaceCard className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">ARPU</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {formatCurrency(revenue.average_revenue_per_user)}
                </p>
                <p className="text-xs text-slate-400 mt-1">Average revenue per user</p>
              </div>
              <div className="p-3 rounded-lg bg-violet-50">
                <Users className="h-6 w-6 text-violet-600" />
              </div>
            </div>
          </SurfaceCard>
        </div>

        {/* Subscription Status Overview */}
        <SurfaceCard className="p-6 mb-8">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Subscription Overview</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="flex items-center gap-4 p-4 bg-emerald-50 rounded-lg">
              <div className="p-3 bg-emerald-100 rounded-lg">
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Active</p>
                <p className="text-2xl font-semibold text-slate-900">{revenue.total_paid_subscriptions}</p>
              </div>
            </div>

            <div className="flex items-center gap-4 p-4 bg-blue-50 rounded-lg">
              <div className="p-3 bg-blue-100 rounded-lg">
                <Clock className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-slate-600">In Trial</p>
                <p className="text-2xl font-semibold text-slate-900">{revenue.total_trialing_subscriptions}</p>
              </div>
            </div>

            <div className="flex items-center gap-4 p-4 bg-rose-50 rounded-lg">
              <div className="p-3 bg-rose-100 rounded-lg">
                <AlertCircle className="h-6 w-6 text-rose-600" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Past Due</p>
                <p className="text-2xl font-semibold text-slate-900">{revenue.total_past_due_subscriptions}</p>
              </div>
            </div>
          </div>
        </SurfaceCard>

        {/* Subscriptions Table */}
        <SurfaceCard className="p-0 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h3 className="text-lg font-semibold text-slate-900">Active Subscriptions</h3>
          </div>
          
          {subscriptions.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4 font-medium text-slate-700">Organization</th>
                      <th className="px-6 py-4 font-medium text-slate-700">Plan</th>
                      <th className="px-6 py-4 font-medium text-slate-700">Status</th>
                      <th className="px-6 py-4 font-medium text-slate-700">Current Period</th>
                      <th className="px-6 py-4 font-medium text-slate-700">Price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {subscriptions.map((sub) => (
                      <tr key={sub.id} className="hover:bg-slate-50/50">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-slate-400" />
                            <span className="font-medium text-slate-900">{sub.organization_name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <CreditCard className="h-4 w-4 text-slate-400" />
                            <span className="text-sm text-slate-600">{sub.plan_name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            {getStatusIcon(sub.status)}
                            <StatusBadge tone={getStatusTone(sub.status)}>
                              {sub.status}
                            </StatusBadge>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2 text-slate-500">
                            <Calendar className="h-4 w-4" />
                            <span className="text-sm">
                              {new Date(sub.current_period_start).toLocaleDateString()} - {new Date(sub.current_period_end).toLocaleDateString()}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="font-medium text-slate-900">
                            {formatCurrency(sub.plan_price)}/mo
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between">
                <p className="text-sm text-slate-500">
                  Page {pagination.current_page} of {pagination.last_page}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-2 border border-slate-200 rounded-lg disabled:opacity-50"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(pagination.last_page, p + 1))}
                    disabled={page === pagination.last_page}
                    className="p-2 border border-slate-200 rounded-lg disabled:opacity-50"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <PageEmptyState
              title="No subscriptions found"
              description="No active subscriptions in the system yet"
            />
          )}
        </SurfaceCard>
      </div>
    </div>
  );
}
