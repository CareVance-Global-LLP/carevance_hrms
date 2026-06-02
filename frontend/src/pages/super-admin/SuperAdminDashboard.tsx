import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { 
  Building2, 
  Users, 
  DollarSign, 
  TrendingUp,
  Activity,
  ArrowRight,
  CheckCircle2,
  Clock,
  AlertCircle,
  UserCircle,
  Briefcase,
  BarChart3,
  Zap,
  ShieldCheck,
  Calendar,
  Search,
  X,
  Command,
  Loader2,
  RefreshCw,
  TrendingDown,
  Globe,
  CreditCard,
  UsersRound,
  ChevronRight,
  Crown,
  Percent,
} from 'lucide-react';
import { superAdminApi } from '@/services/superAdminApi';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { PageLoadingState, PageErrorState } from '@/components/ui/PageState';
import { useAuth } from '@/contexts/AuthContext';
import { formatDateTime } from '@/lib/dateTime';
import { DEFAULT_APP_TIMEZONE } from '@/lib/timezones';

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
    subscription_status?: string;
    plan_code?: string;
  }>;
}

interface SearchResult {
  type: 'organization' | 'user';
  id: number;
  title: string;
  subtitle: string;
  status: string;
  url: string;
}

// Calculate MRR based on active subscriptions
function calculateMRR(activeSubscriptions: number): number {
  const avgPlanPrice = 1999; // Average plan price in INR
  return activeSubscriptions * avgPlanPrice;
}

// Calculate trial conversion rate
function calculateConversionRate(active: number, trial: number): number {
  const total = active + trial;
  if (total === 0) return 0;
  return Math.round((active / total) * 100);
}

export default function SuperAdminDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const viewerTimezone = (user?.settings as any)?.timezone || DEFAULT_APP_TIMEZONE;
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const { data: stats, isLoading, error, refetch } = useQuery<StatsData>({
    queryKey: ['super-admin', 'stats'],
    queryFn: async () => {
      const response = await superAdminApi.getStats();
      return response.data.data;
    },
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });

  // Handle search
  useEffect(() => {
    const delayDebounce = setTimeout(async () => {
      if (searchQuery.length >= 2) {
        setIsSearching(true);
        try {
          const response = await superAdminApi.searchGlobal(searchQuery);
          setSearchResults(response.data.data || []);
        } catch (err) {
          console.error('Search error:', err);
        } finally {
          setIsSearching(false);
        }
      } else {
        setSearchResults([]);
      }
    }, 300);

    return () => clearTimeout(delayDebounce);
  }, [searchQuery]);

  // Handle click outside to close search
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setIsSearchOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen(true);
        searchInputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setIsSearchOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setTimeout(() => setRefreshing(false), 500);
  };

  const handleResultClick = (result: SearchResult) => {
    navigate(result.url);
    setIsSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  const formatNumber = (num: number) => new Intl.NumberFormat('en-IN').format(num);
  
  const formatCurrency = (num: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(num);
  };

  const getStatusBadge = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'active':
        return <StatusBadge tone="success">Active</StatusBadge>;
      case 'trial':
        return <StatusBadge tone="warning">Trial</StatusBadge>;
      case 'cancelled':
      case 'suspended':
        return <StatusBadge tone="danger">Suspended</StatusBadge>;
      default:
        return <StatusBadge tone="neutral">{status || 'Unknown'}</StatusBadge>;
    }
  };

  const getPlanBadge = (plan?: string) => {
    switch (plan?.toLowerCase()) {
      case 'basic':
      case 'starter':
        return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">Basic</span>;
      case 'advanced_tracker':
      case 'growth':
      case 'professional':
        return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-600">Pro</span>;
      case 'enterprise':
        return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-600">Enterprise</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">No Plan</span>;
    }
  };

  if (isLoading) {
    return <PageLoadingState label="Loading super admin dashboard..." />;
  }

  if (error) {
    console.error('Dashboard stats error:', error);
    return <PageErrorState message="Failed to load dashboard stats" onRetry={() => refetch()} />;
  }

  if (!stats) {
    return <PageErrorState message="No data available" />;
  }

  const mrr = calculateMRR(stats.active_subscriptions);
  const arr = mrr * 12;
  const conversionRate = calculateConversionRate(stats.active_subscriptions, stats.trialing_subscriptions);
  const revenueGrowth = 12; // Mock growth percentage

  return (
    <div className="min-h-screen bg-slate-50/50">
      <PageHeader
        title="Super Admin Dashboard"
        description="System-wide overview and management"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className={`p-2 rounded-lg hover:bg-slate-100 transition-all ${refreshing ? 'animate-spin' : ''}`}
              title="Refresh data"
            >
              <RefreshCw className="h-5 w-5 text-slate-600" />
            </button>
          </div>
        }
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          {/* Global Search Bar */}
          <div ref={searchContainerRef} className="relative">
            <SurfaceCard 
              className={`p-4 cursor-pointer transition-all duration-300 ${isSearchOpen ? 'ring-2 ring-blue-500 shadow-lg scale-[1.02]' : 'hover:shadow-md hover:scale-[1.01]'}`}
              onClick={() => {
                setIsSearchOpen(true);
                searchInputRef.current?.focus();
              }}
            >
              <div className="flex items-center gap-3">
                <Search className={`h-5 w-5 transition-colors ${isSearchOpen ? 'text-blue-500' : 'text-slate-400'}`} />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search organizations, users, or anything..."
                  className="flex-1 bg-transparent border-none outline-none text-slate-700 placeholder-slate-400"
                  onClick={(e) => e.stopPropagation()}
                />
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="hidden sm:inline-flex items-center gap-1 px-2 py-1 bg-slate-100 rounded">
                    <Command className="h-3 w-3" /> K
                  </span>
                  {searchQuery && (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setSearchQuery('');
                        searchInputRef.current?.focus();
                      }}
                      className="p-1 hover:bg-slate-100 rounded transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </SurfaceCard>

            {/* Search Results Dropdown */}
            {(searchQuery.length >= 2 || searchResults.length > 0) && isSearchOpen && (
              <SurfaceCard className="absolute top-full left-0 right-0 mt-2 max-h-96 overflow-y-auto z-50 shadow-xl animate-in fade-in slide-in-from-top-2 duration-200">
                {isSearching ? (
                  <div className="p-8 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-blue-600 mb-2" />
                    <p className="text-sm text-slate-500">Searching...</p>
                  </div>
                ) : searchResults.length > 0 ? (
                  <div className="py-2">
                    <div className="px-4 py-2 text-xs font-medium text-slate-400 uppercase">
                      Results ({searchResults.length})
                    </div>
                    {searchResults.map((result) => (
                      <button
                        key={`${result.type}-${result.id}`}
                        onClick={() => handleResultClick(result)}
                        className="w-full px-4 py-3 hover:bg-slate-50 flex items-center gap-3 text-left transition-colors"
                      >
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          result.type === 'organization' 
                            ? 'bg-blue-100 text-blue-600' 
                            : 'bg-violet-100 text-violet-600'
                        }`}>
                          {result.type === 'organization' ? (
                            <Building2 className="h-5 w-5" />
                          ) : (
                            <UserCircle className="h-5 w-5" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-slate-900 truncate">{result.title}</p>
                          <p className="text-sm text-slate-500 truncate">{result.subtitle}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {getStatusBadge(result.status)}
                          <ArrowRight className="h-4 w-4 text-slate-300" />
                        </div>
                      </button>
                    ))}
                  </div>
                ) : searchQuery.length >= 2 ? (
                  <div className="p-8 text-center">
                    <Search className="h-8 w-8 mx-auto text-slate-300 mb-2" />
                    <p className="text-sm text-slate-500">No results found for &quot;{searchQuery}&quot;</p>
                  </div>
                ) : null}
              </SurfaceCard>
            )}
          </div>

          {/* Welcome Banner */}
          <SurfaceCard className="mb-8 bg-gradient-to-r from-blue-600 via-violet-600 to-purple-600 text-white p-6 relative overflow-hidden">
            <div className="absolute inset-0 opacity-10">
              <div className="absolute inset-0" style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
              }} />
            </div>
            <div className="flex items-center justify-between relative z-10">
              <div>
                <h2 className="text-2xl font-bold">Welcome back, {user?.name || 'Super Admin'}</h2>
                <p className="mt-1 text-blue-100">
                  You have full system access. Manage organizations, users, and monitor system health.
                </p>
                <div className="mt-4 flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2 text-sm text-blue-200">
                    <Globe className="h-4 w-4" />
                    <span>{stats.total_organizations} Organizations</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-blue-200">
                    <Users className="h-4 w-4" />
                    <span>{stats.total_users} Users</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-blue-200">
                    <CreditCard className="h-4 w-4" />
                    <span>{formatCurrency(mrr)} MRR</span>
                  </div>
                </div>
              </div>
              <div className="hidden md:block">
                <ShieldCheck className="h-16 w-16 text-white/30" />
              </div>
            </div>
          </SurfaceCard>

          {/* Main KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Organizations Card */}
            <SurfaceCard 
              className="p-6 cursor-pointer hover:shadow-xl transition-all duration-300 border-l-4 border-blue-500 group"
              onClick={() => navigate('/super-admin/organizations')}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="p-1.5 bg-blue-100 rounded-lg">
                      <Building2 className="h-4 w-4 text-blue-600" />
                    </div>
                    <p className="text-sm font-medium text-slate-500">Organizations</p>
                  </div>
                  <p className="text-3xl font-bold text-slate-900">{formatNumber(stats.total_organizations)}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <span className="flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-600 rounded-full">
                      <CheckCircle2 className="h-3 w-3" />
                      {stats.active_organizations} Active
                    </span>
                    <span className="flex items-center gap-1 px-2 py-1 bg-amber-50 text-amber-600 rounded-full">
                      <Clock className="h-3 w-3" />
                      {stats.trialing_subscriptions} Trial
                    </span>
                    <span className="flex items-center gap-1 px-2 py-1 bg-rose-50 text-rose-600 rounded-full">
                      <AlertCircle className="h-3 w-3" />
                      {stats.suspended_organizations} Suspended
                    </span>
                  </div>
                </div>
                <div className="p-3 bg-blue-50 rounded-xl group-hover:scale-110 transition-transform">
                  <Building2 className="h-6 w-6 text-blue-600" />
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-400">Click to manage all</span>
                <ArrowRight className="h-4 w-4 text-blue-600 group-hover:translate-x-1 transition-transform" />
              </div>
            </SurfaceCard>

            {/* Users Card */}
            <SurfaceCard 
              className="p-6 cursor-pointer hover:shadow-xl transition-all duration-300 border-l-4 border-violet-500 group"
              onClick={() => navigate('/super-admin/users')}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="p-1.5 bg-violet-100 rounded-lg">
                      <Users className="h-4 w-4 text-violet-600" />
                    </div>
                    <p className="text-sm font-medium text-slate-500">Total Users</p>
                  </div>
                  <p className="text-3xl font-bold text-slate-900">{formatNumber(stats.total_users)}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <div className="flex -space-x-2">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-400 to-violet-600 border-2 border-white flex items-center justify-center text-[8px] text-white font-medium">
                          {String.fromCharCode(64 + i)}
                        </div>
                      ))}
                    </div>
                    <span className="text-xs text-slate-500">
                      <span className="text-emerald-600 font-medium">{stats.active_users}</span> active
                    </span>
                  </div>
                </div>
                <div className="p-3 bg-violet-50 rounded-xl group-hover:scale-110 transition-transform">
                  <UsersRound className="h-6 w-6 text-violet-600" />
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-400">View all users</span>
                <ArrowRight className="h-4 w-4 text-violet-600 group-hover:translate-x-1 transition-transform" />
              </div>
            </SurfaceCard>

            {/* Revenue Card */}
            <SurfaceCard 
              className="p-6 cursor-pointer hover:shadow-xl transition-all duration-300 border-l-4 border-emerald-500 group"
              onClick={() => navigate('/super-admin/billing')}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="p-1.5 bg-emerald-100 rounded-lg">
                      <DollarSign className="h-4 w-4 text-emerald-600" />
                    </div>
                    <p className="text-sm font-medium text-slate-500">Monthly Revenue</p>
                  </div>
                  <p className="text-3xl font-bold text-slate-900">{formatCurrency(mrr)}</p>
                  <div className="mt-3 flex items-center gap-2 text-xs">
                    {revenueGrowth >= 0 ? (
                      <span className="flex items-center gap-1 text-emerald-600">
                        <TrendingUp className="h-3 w-3" />
                        +{revenueGrowth}%
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-rose-600">
                        <TrendingDown className="h-3 w-3" />
                        {revenueGrowth}%
                      </span>
                    )}
                    <span className="text-slate-400">vs last month</span>
                  </div>
                </div>
                <div className="p-3 bg-emerald-50 rounded-xl group-hover:scale-110 transition-transform">
                  <CreditCard className="h-6 w-6 text-emerald-600" />
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-400">ARR: {formatCurrency(arr)}</span>
                <ArrowRight className="h-4 w-4 text-emerald-600 group-hover:translate-x-1 transition-transform" />
              </div>
            </SurfaceCard>

            {/* Conversion Rate Card */}
            <SurfaceCard 
              className="p-6 cursor-pointer hover:shadow-xl transition-all duration-300 border-l-4 border-amber-500 group"
              onClick={() => navigate('/super-admin/organizations')}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="p-1.5 bg-amber-100 rounded-lg">
                      <Percent className="h-4 w-4 text-amber-600" />
                    </div>
                    <p className="text-sm font-medium text-slate-500">Trial Conversion</p>
                  </div>
                  <p className="text-3xl font-bold text-slate-900">{conversionRate}%</p>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-lg font-semibold text-slate-900">{stats.new_signups_today}</p>
                      <p className="text-xs text-slate-400">Today</p>
                    </div>
                    <div className="border-x border-slate-100">
                      <p className="text-lg font-semibold text-slate-900">{stats.new_signups_this_week}</p>
                      <p className="text-xs text-slate-400">This Week</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-slate-900">{stats.new_signups_this_month}</p>
                      <p className="text-xs text-slate-400">This Month</p>
                    </div>
                  </div>
                </div>
                <div className="p-3 bg-amber-50 rounded-xl group-hover:scale-110 transition-transform">
                  <Zap className="h-6 w-6 text-amber-600" />
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-400">View trial companies</span>
                <ArrowRight className="h-4 w-4 text-amber-600 group-hover:translate-x-1 transition-transform" />
              </div>
            </SurfaceCard>
          </div>

          {/* Secondary Stats Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* User Distribution */}
            <SurfaceCard className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-violet-600" />
                  <h3 className="text-lg font-semibold text-slate-900">User Distribution</h3>
                </div>
                <span className="text-sm text-slate-400">By Role</span>
              </div>
              
              <div className="space-y-4">
                {[
                  { label: 'Admins', count: stats.users_by_role.admin, color: 'bg-blue-500', icon: Briefcase, total: stats.total_users },
                  { label: 'Managers', count: stats.users_by_role.manager, color: 'bg-violet-500', icon: Users, total: stats.total_users },
                  { label: 'Employees', count: stats.users_by_role.employee, color: 'bg-emerald-500', icon: UserCircle, total: stats.total_users },
                ].map((role) => (
                  <div key={role.label} className="relative">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full ${role.color.replace('bg-', 'bg-opacity-10 bg-')} flex items-center justify-center`}>
                          <role.icon className={`h-5 w-5 ${role.color.replace('bg-', 'text-')}`} />
                        </div>
                        <div>
                          <p className="font-medium text-slate-900">{role.label}</p>
                          <p className="text-xs text-slate-400">
                            {((role.count / role.total) * 100).toFixed(1)}% of total
                          </p>
                        </div>
                      </div>
                      <span className="text-2xl font-bold text-slate-900">{formatNumber(role.count)}</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className={`h-full ${role.color} rounded-full transition-all duration-1000`}
                        style={{ width: `${(role.count / role.total) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </SurfaceCard>

            {/* Subscription Health */}
            <SurfaceCard className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-emerald-600" />
                  <h3 className="text-lg font-semibold text-slate-900">Subscription Health</h3>
                </div>
              </div>
              
              <div className="space-y-4">
                {[
                  { 
                    label: 'Active', 
                    count: stats.active_subscriptions, 
                    total: stats.total_organizations,
                    color: 'bg-emerald-500',
                    icon: CheckCircle2,
                    textColor: 'text-emerald-600'
                  },
                  { 
                    label: 'In Trial', 
                    count: stats.trialing_subscriptions, 
                    total: stats.total_organizations,
                    color: 'bg-blue-500',
                    icon: Clock,
                    textColor: 'text-blue-600'
                  },
                  { 
                    label: 'Past Due', 
                    count: stats.past_due_subscriptions, 
                    total: stats.total_organizations,
                    color: 'bg-rose-500',
                    icon: AlertCircle,
                    textColor: 'text-rose-600'
                  },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${item.color.replace('bg-', 'bg-opacity-10 bg-')}`}>
                      <item.icon className={`h-5 w-5 ${item.textColor}`} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-slate-700">{item.label}</span>
                        <span className={`text-sm font-bold ${item.textColor}`}>{item.count}</span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div 
                          className={`h-full ${item.color} rounded-full transition-all duration-1000`}
                          style={{ width: `${item.total > 0 ? (item.count / item.total) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </SurfaceCard>

            {/* Recent Organizations */}
            <SurfaceCard className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-blue-600" />
                  <h3 className="text-lg font-semibold text-slate-900">Recent Signups</h3>
                </div>
                <button
                  onClick={() => navigate('/super-admin/organizations')}
                  className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1 transition-colors"
                >
                  View all <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              
              <div className="space-y-3">
                {stats.recent_organizations.slice(0, 5).map((org, index) => (
                  <div
                    key={org.id}
                    className="flex items-center justify-between p-3 bg-slate-50 rounded-lg hover:bg-slate-100 cursor-pointer transition-all group"
                    onClick={() => navigate(`/super-admin/organizations/${org.id}`)}
                    style={{ animationDelay: `${index * 0.1}s` }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center text-white text-xs font-bold">
                        {org.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-slate-900 text-sm">{org.name}</p>
                        <p className="text-xs text-slate-500">
                          {new Date(org.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {getPlanBadge(org.plan_code)}
                      {getStatusBadge(org.subscription_status)}
                    </div>
                  </div>
                ))}
              </div>
            </SurfaceCard>
          </div>

          {/* Quick Actions */}
          <SurfaceCard className="p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-6">Quick Actions</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                {
                  icon: Building2,
                  title: 'Manage Organizations',
                  description: 'View, edit, suspend orgs',
                  color: 'blue',
                  path: '/super-admin/organizations',
                },
                {
                  icon: Users,
                  title: 'All Users',
                  description: 'View users across orgs',
                  color: 'violet',
                  path: '/super-admin/users',
                },
                {
                  icon: DollarSign,
                  title: 'Revenue & Billing',
                  description: 'View MRR, subscriptions',
                  color: 'emerald',
                  path: '/super-admin/billing',
                },
                {
                  icon: Crown,
                  title: 'Plan Management',
                  description: 'Configure pricing plans',
                  color: 'amber',
                  path: '/super-admin/plans',
                },
              ].map((action) => (
                <button
                  key={action.title}
                  onClick={() => navigate(action.path)}
                  className={`flex items-center gap-4 p-4 bg-${action.color}-50 rounded-xl hover:bg-${action.color}-100 transition-all duration-300 text-left group hover:shadow-md`}
                >
                  <div className={`p-3 bg-${action.color}-100 rounded-lg group-hover:bg-${action.color}-200 group-hover:scale-110 transition-all`}>
                    <action.icon className={`h-6 w-6 text-${action.color}-600`} />
                  </div>
                  <div>
                    <p className={`font-semibold text-${action.color}-900`}>{action.title}</p>
                    <p className={`text-xs text-${action.color}-600`}>{action.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </SurfaceCard>

          {/* Footer Info */}
          <div className="text-center text-sm text-slate-400 pt-4">
            <div className="flex items-center justify-center gap-6">
              <span className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                System Operational
              </span>
              <span>Last updated: {formatDateTime(new Date(), viewerTimezone)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
