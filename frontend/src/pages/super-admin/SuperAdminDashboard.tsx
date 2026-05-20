import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { 
  Building2, 
  Users, 
  DollarSign, 
  TrendingUp,
  Activity,
  ArrowRight,
  Loader2
} from 'lucide-react';
import { superAdminApi } from '@/services/superAdminApi';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { PageLoadingState, PageErrorState } from '@/components/ui/PageState';
import { useAuth } from '@/contexts/AuthContext';

interface StatsData {
  total_organizations: number;
  active_organizations: number;
  suspended_organizations: number;
  total_users: number;
  active_users: number;
  users_by_role: {
    admin: number;
    manager: number;
    employee: number;
  };
  new_signups_today: number;
  new_signups_this_week: number;
  new_signups_this_month: number;
  active_subscriptions: number;
  trialing_subscriptions: number;
  past_due_subscriptions: number;
  recent_organizations: Array<{
    id: number;
    name: string;
    created_at: string;
  }>;
}

export default function SuperAdminDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: stats, isLoading, error } = useQuery<StatsData>({
    queryKey: ['super-admin', 'stats'],
    queryFn: async () => {
      const response = await superAdminApi.getStats();
      return response.data.data;
    },
  });

  if (isLoading) {
    return <PageLoadingState label="Loading super admin dashboard..." />;
  }

  if (error) {
    return <PageErrorState message="Failed to load dashboard stats" />;
  }

  if (!stats) {
    return <PageErrorState message="No data available" />;
  }

  const statCards = [
    {
      label: 'Total Organizations',
      value: stats.total_organizations,
      subtext: `${stats.active_organizations} active, ${stats.suspended_organizations} suspended`,
      icon: Building2,
      color: 'blue',
      to: '/super-admin/organizations'
    },
    {
      label: 'Total Users',
      value: stats.total_users,
      subtext: `${stats.active_users} active (7 days)`,
      icon: Users,
      color: 'violet',
      to: '/super-admin/users'
    },
    {
      label: 'Active Subscriptions',
      value: stats.active_subscriptions,
      subtext: `${stats.trialing_subscriptions} in trial`,
      icon: DollarSign,
      color: 'emerald',
      to: '/super-admin/billing'
    },
    {
      label: 'New This Month',
      value: stats.new_signups_this_month,
      subtext: `${stats.new_signups_this_week} this week, ${stats.new_signups_today} today`,
      icon: TrendingUp,
      color: 'amber',
      to: '/super-admin/organizations'
    }
  ];

  const getColorClasses = (color: string) => {
    const colors: Record<string, { bg: string; text: string; icon: string }> = {
      blue: { bg: 'bg-blue-50', text: 'text-blue-700', icon: 'text-blue-600' },
      violet: { bg: 'bg-violet-50', text: 'text-violet-700', icon: 'text-violet-600' },
      emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'text-emerald-600' },
      amber: { bg: 'bg-amber-50', text: 'text-amber-700', icon: 'text-amber-600' },
    };
    return colors[color] || colors.blue;
  };

  return (
    <div className="min-h-screen bg-slate-50/50">
      <PageHeader
        title="Super Admin Dashboard"
        description="System-wide overview and management"
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-slate-900">
            Welcome back, {user?.name || 'Super Admin'}
          </h2>
          <p className="text-sm text-slate-500">
            Manage all organizations, users, and system settings
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {statCards.map((card) => {
            const colors = getColorClasses(card.color);
            const Icon = card.icon;
            
            return (
              <SurfaceCard
                key={card.label}
                className="p-6 cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate(card.to)}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-500">{card.label}</p>
                    <p className="mt-2 text-3xl font-semibold text-slate-900">{card.value}</p>
                    <p className="mt-1 text-xs text-slate-400">{card.subtext}</p>
                  </div>
                  <div className={`p-3 rounded-lg ${colors.bg}`}>
                    <Icon className={`h-6 w-6 ${colors.icon}`} />
                  </div>
                </div>
                <div className="mt-4 flex items-center text-sm text-slate-500 hover:text-slate-700">
                  <span>View details</span>
                  <ArrowRight className="ml-1 h-4 w-4" />
                </div>
              </SurfaceCard>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Recent Organizations */}
          <SurfaceCard className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">Recent Organizations</h3>
              <button
                onClick={() => navigate('/super-admin/organizations')}
                className="text-sm text-blue-600 hover:text-blue-700 flex items-center"
              >
                View all <ArrowRight className="ml-1 h-4 w-4" />
              </button>
            </div>
            
            {stats.recent_organizations.length > 0 ? (
              <div className="space-y-3">
                {stats.recent_organizations.map((org) => (
                  <div
                    key={org.id}
                    className="flex items-center justify-between p-3 bg-slate-50 rounded-lg hover:bg-slate-100 cursor-pointer"
                    onClick={() => navigate(`/super-admin/organizations/${org.id}`)}
                  >
                    <div>
                      <p className="font-medium text-slate-900">{org.name}</p>
                      <p className="text-xs text-slate-500">
                        Joined {new Date(org.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-400" />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500 text-center py-4">No organizations yet</p>
            )}
          </SurfaceCard>

          {/* User Distribution */}
          <SurfaceCard className="p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">User Distribution</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-blue-500" />
                  <span className="text-sm text-slate-600">Admins</span>
                </div>
                <span className="font-semibold text-slate-900">{stats.users_by_role.admin}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-violet-500" />
                  <span className="text-sm text-slate-600">Managers</span>
                </div>
                <span className="font-semibold text-slate-900">{stats.users_by_role.manager}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-emerald-500" />
                  <span className="text-sm text-slate-600">Employees</span>
                </div>
                <span className="font-semibold text-slate-900">{stats.users_by_role.employee}</span>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-slate-100">
              <h4 className="text-sm font-medium text-slate-700 mb-3">Subscription Status</h4>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Active</span>
                  <span className="font-medium text-emerald-600">{stats.active_subscriptions}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">In Trial</span>
                  <span className="font-medium text-blue-600">{stats.trialing_subscriptions}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Past Due</span>
                  <span className="font-medium text-rose-600">{stats.past_due_subscriptions}</span>
                </div>
              </div>
            </div>
          </SurfaceCard>
        </div>

        {/* Quick Actions */}
        <SurfaceCard className="mt-8 p-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Quick Actions</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <button
              onClick={() => navigate('/super-admin/organizations')}
              className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors text-left"
            >
              <Building2 className="h-5 w-5 text-blue-600" />
              <div>
                <p className="font-medium text-blue-900">Manage Organizations</p>
                <p className="text-xs text-blue-600">View, edit, suspend orgs</p>
              </div>
            </button>
            
            <button
              onClick={() => navigate('/super-admin/users')}
              className="flex items-center gap-3 p-4 bg-violet-50 rounded-lg hover:bg-violet-100 transition-colors text-left"
            >
              <Users className="h-5 w-5 text-violet-600" />
              <div>
                <p className="font-medium text-violet-900">All Users</p>
                <p className="text-xs text-violet-600">View users across orgs</p>
              </div>
            </button>
            
            <button
              onClick={() => navigate('/super-admin/billing')}
              className="flex items-center gap-3 p-4 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors text-left"
            >
              <DollarSign className="h-5 w-5 text-emerald-600" />
              <div>
                <p className="font-medium text-emerald-900">Revenue & Billing</p>
                <p className="text-xs text-emerald-600">View MRR, subscriptions</p>
              </div>
            </button>
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
}
