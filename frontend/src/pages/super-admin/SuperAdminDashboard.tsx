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
  Settings,
  Zap,
  ShieldCheck,
  Calendar,
  Search,
  X,
  Command,
  Loader2
} from 'lucide-react';
import { superAdminApi } from '@/services/superAdminApi';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import StatusBadge from '@/components/ui/StatusBadge';
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
    subscription_status?: string;
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

export default function SuperAdminDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const { data: stats, isLoading, error } = useQuery<StatsData>({
    queryKey: ['super-admin', 'stats'],
    queryFn: async () => {
      const response = await superAdminApi.getStats();
      return response.data.data;
    },
  });

  // Handle search
  useEffect(() => {
    const delayDebounce = setTimeout(async () => {
      if (searchQuery.length >= 2) {
        setIsSearching(true);
        console.log('Searching for:', searchQuery);
        try {
          const response = await superAdminApi.searchGlobal(searchQuery);
          console.log('Search response:', response.data);
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

  const handleResultClick = (result: SearchResult) => {
    navigate(result.url);
    setIsSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  const formatNumber = (num: number) => new Intl.NumberFormat().format(num);

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

  if (isLoading) {
    return <PageLoadingState label="Loading super admin dashboard..." />;
  }

  if (error) {
    return <PageErrorState message="Failed to load dashboard stats" />;
  }

  if (!stats) {
    return <PageErrorState message="No data available" />;
  }

  return (
    <div className="min-h-screen bg-slate-50/50">
      <PageHeader
        title="Super Admin Dashboard"
        description="System-wide overview and management"
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {/* Global Search Bar */}
        <div ref={searchContainerRef} className="relative mb-6">
          <SurfaceCard 
            className={`p-4 cursor-pointer transition-all ${isSearchOpen ? 'ring-2 ring-blue-500 shadow-lg' : 'hover:shadow-md'}`}
            onClick={() => {
              setIsSearchOpen(true);
              searchInputRef.current?.focus();
            }}
          >
            <div className="flex items-center gap-3">
              <Search className="h-5 w-5 text-slate-400" />
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
                    className="p-1 hover:bg-slate-100 rounded"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </SurfaceCard>

          {/* Search Results Dropdown */}
          {(searchQuery.length >= 2 || searchResults.length > 0) && (
            <SurfaceCard className="absolute top-full left-0 right-0 mt-2 max-h-96 overflow-y-auto z-50 shadow-xl">
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
                  {searchResults.map((result, index) => (
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
                  <p className="text-sm text-slate-500">No results found for "{searchQuery}"</p>
                </div>
              ) : null}
            </SurfaceCard>
          )}
        </div>

        {/* Welcome Banner */}
        <SurfaceCard className="mb-8 bg-gradient-to-r from-blue-600 to-violet-600 text-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">Welcome back, {user?.name || 'Super Admin'}</h2>
              <p className="mt-1 text-blue-100">
                You have full system access. Manage organizations, users, and monitor system health.
              </p>
            </div>
            <div className="hidden md:block">
              <ShieldCheck className="h-16 w-16 text-white/30" />
            </div>
          </div>
        </SurfaceCard>

        {/* Main Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {/* Organizations Card */}
          <SurfaceCard 
            className="p-6 cursor-pointer hover:shadow-lg transition-all border-l-4 border-blue-500"
            onClick={() => navigate('/super-admin/organizations')}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Building2 className="h-5 w-5 text-blue-600" />
                  <p className="text-sm font-medium text-slate-500">Organizations</p>
                </div>
                <p className="text-3xl font-bold text-slate-900">{formatNumber(stats.total_organizations)}</p>
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="flex items-center gap-1 text-emerald-600">
                    <CheckCircle2 className="h-3 w-3" />
                    {stats.active_organizations} Active
                  </span>
                  <span className="text-slate-300">|</span>
                  <span className="flex items-center gap-1 text-rose-600">
                    <AlertCircle className="h-3 w-3" />
                    {stats.suspended_organizations} Suspended
                  </span>
                </div>
              </div>
              <div className="p-3 bg-blue-50 rounded-xl">
                <Building2 className="h-6 w-6 text-blue-600" />
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-400">Click to manage all</span>
              <ArrowRight className="h-4 w-4 text-blue-600" />
            </div>
          </SurfaceCard>

          {/* Users Card */}
          <SurfaceCard 
            className="p-6 cursor-pointer hover:shadow-lg transition-all border-l-4 border-violet-500"
            onClick={() => navigate('/super-admin/users')}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Users className="h-5 w-5 text-violet-600" />
                  <p className="text-sm font-medium text-slate-500">Total Users</p>
                </div>
                <p className="text-3xl font-bold text-slate-900">{formatNumber(stats.total_users)}</p>
                <div className="mt-2 text-xs text-slate-500">
                  <span className="text-emerald-600 font-medium">{stats.active_users}</span> active users
                </div>
              </div>
              <div className="p-3 bg-violet-50 rounded-xl">
                <Users className="h-6 w-6 text-violet-600" />
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-400">View all users</span>
              <ArrowRight className="h-4 w-4 text-violet-600" />
            </div>
          </SurfaceCard>

          {/* Subscriptions Card */}
          <SurfaceCard 
            className="p-6 cursor-pointer hover:shadow-lg transition-all border-l-4 border-emerald-500"
            onClick={() => navigate('/super-admin/billing')}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="h-5 w-5 text-emerald-600" />
                  <p className="text-sm font-medium text-slate-500">Subscriptions</p>
                </div>
                <p className="text-3xl font-bold text-slate-900">{formatNumber(stats.active_subscriptions)}</p>
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="flex items-center gap-1 text-blue-600">
                    <Clock className="h-3 w-3" />
                    {stats.trialing_subscriptions} Trial
                  </span>
                  <span className="text-slate-300">|</span>
                  <span className="flex items-center gap-1 text-rose-600">
                    <AlertCircle className="h-3 w-3" />
                    {stats.past_due_subscriptions} Past Due
                  </span>
                </div>
              </div>
              <div className="p-3 bg-emerald-50 rounded-xl">
                <DollarSign className="h-6 w-6 text-emerald-600" />
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-400">View billing details</span>
              <ArrowRight className="h-4 w-4 text-emerald-600" />
            </div>
          </SurfaceCard>

          {/* New Signups Card */}
          <SurfaceCard className="p-6 border-l-4 border-amber-500">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="h-5 w-5 text-amber-600" />
                  <p className="text-sm font-medium text-slate-500">New Signups</p>
                </div>
                <p className="text-3xl font-bold text-slate-900">{stats.new_signups_this_month}</p>
                <p className="mt-2 text-xs text-slate-500">This month</p>
              </div>
              <div className="p-3 bg-amber-50 rounded-xl">
                <Zap className="h-6 w-6 text-amber-600" />
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-3 gap-2 text-center">
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
          </SurfaceCard>
        </div>

        {/* Secondary Stats Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
          {/* User Distribution */}
          <SurfaceCard className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-violet-600" />
                <h3 className="text-lg font-semibold text-slate-900">User Distribution</h3>
              </div>
              <span className="text-sm text-slate-400">By Role</span>
            </div>
            
            <div className="space-y-4">
              <div className="relative">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                      <Briefcase className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-900">Admins</p>
                      <p className="text-xs text-slate-400">Full system access</p>
                    </div>
                  </div>
                  <span className="text-2xl font-bold text-slate-900">{stats.users_by_role.admin}</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${(stats.users_by_role.admin / stats.total_users) * 100}%` }}
                  />
                </div>
              </div>

              <div className="relative">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-violet-100 flex items-center justify-center">
                      <Users className="h-5 w-5 text-violet-600" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-900">Managers</p>
                      <p className="text-xs text-slate-400">Team oversight</p>
                    </div>
                  </div>
                  <span className="text-2xl font-bold text-slate-900">{stats.users_by_role.manager}</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-violet-500 rounded-full transition-all"
                    style={{ width: `${(stats.users_by_role.manager / stats.total_users) * 100}%` }}
                  />
                </div>
              </div>

              <div className="relative">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                      <UserCircle className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-900">Employees</p>
                      <p className="text-xs text-slate-400">Regular users</p>
                    </div>
                  </div>
                  <span className="text-2xl font-bold text-slate-900">{stats.users_by_role.employee}</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${(stats.users_by_role.employee / stats.total_users) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </SurfaceCard>

          {/* Subscription Overview */}
          <SurfaceCard className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-emerald-600" />
                <h3 className="text-lg font-semibold text-slate-900">Subscription Health</h3>
              </div>
            </div>
            
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                  <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-slate-900">Active</span>
                    <span className="text-lg font-bold text-emerald-600">{stats.active_subscriptions}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-emerald-500 rounded-full"
                      style={{ width: `${(stats.active_subscriptions / stats.total_organizations) * 100}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                  <Clock className="h-6 w-6 text-blue-600" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-slate-900">In Trial</span>
                    <span className="text-lg font-bold text-blue-600">{stats.trialing_subscriptions}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${(stats.trialing_subscriptions / stats.total_organizations) * 100}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center">
                  <AlertCircle className="h-6 w-6 text-rose-600" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-slate-900">Past Due</span>
                    <span className="text-lg font-bold text-rose-600">{stats.past_due_subscriptions}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-rose-500 rounded-full"
                      style={{ width: `${(stats.past_due_subscriptions / stats.total_organizations) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </SurfaceCard>

          {/* Recent Organizations */}
          <SurfaceCard className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-blue-600" />
                <h3 className="text-lg font-semibold text-slate-900">Recent Organizations</h3>
              </div>
              <button
                onClick={() => navigate('/super-admin/organizations')}
                className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
              >
                View all <ArrowRight className="h-4 w-4" />
              </button>
            </div>
            
            {stats.recent_organizations.length > 0 ? (
              <div className="space-y-3">
                {stats.recent_organizations.map((org, index) => (
                  <div
                    key={org.id}
                    className="flex items-center justify-between p-3 bg-slate-50 rounded-lg hover:bg-slate-100 cursor-pointer transition-colors"
                    onClick={() => navigate(`/super-admin/organizations/${org.id}`)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center text-white text-xs font-bold">
                        {org.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-slate-900">{org.name}</p>
                        <p className="text-xs text-slate-500">
                          Joined {new Date(org.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    {getStatusBadge(org.subscription_status)}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-slate-400">
                <Building2 className="h-12 w-12 mx-auto mb-2 opacity-30" />
                <p>No organizations yet</p>
              </div>
            )}
          </SurfaceCard>
        </div>

        {/* Quick Actions */}
        <SurfaceCard className="p-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-6">Quick Actions</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <button
              onClick={() => navigate('/super-admin/organizations')}
              className="flex items-center gap-4 p-4 bg-blue-50 rounded-xl hover:bg-blue-100 transition-colors text-left group"
            >
              <div className="p-3 bg-blue-100 rounded-lg group-hover:bg-blue-200 transition-colors">
                <Building2 className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="font-semibold text-blue-900">Manage Organizations</p>
                <p className="text-xs text-blue-600">View, edit, suspend orgs</p>
              </div>
            </button>
            
            <button
              onClick={() => navigate('/super-admin/users')}
              className="flex items-center gap-4 p-4 bg-violet-50 rounded-xl hover:bg-violet-100 transition-colors text-left group"
            >
              <div className="p-3 bg-violet-100 rounded-lg group-hover:bg-violet-200 transition-colors">
                <Users className="h-6 w-6 text-violet-600" />
              </div>
              <div>
                <p className="font-semibold text-violet-900">All Users</p>
                <p className="text-xs text-violet-600">View users across orgs</p>
              </div>
            </button>
            
            <button
              onClick={() => navigate('/super-admin/billing')}
              className="flex items-center gap-4 p-4 bg-emerald-50 rounded-xl hover:bg-emerald-100 transition-colors text-left group"
            >
              <div className="p-3 bg-emerald-100 rounded-lg group-hover:bg-emerald-200 transition-colors">
                <DollarSign className="h-6 w-6 text-emerald-600" />
              </div>
              <div>
                <p className="font-semibold text-emerald-900">Revenue & Billing</p>
                <p className="text-xs text-emerald-600">View MRR, subscriptions</p>
              </div>
            </button>

            <button
              onClick={() => navigate('/settings')}
              className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors text-left group"
            >
              <div className="p-3 bg-slate-100 rounded-lg group-hover:bg-slate-200 transition-colors">
                <Settings className="h-6 w-6 text-slate-600" />
              </div>
              <div>
                <p className="font-semibold text-slate-900">System Settings</p>
                <p className="text-xs text-slate-600">Configure global settings</p>
              </div>
            </button>
          </div>
        </SurfaceCard>

        {/* Footer Info */}
        <div className="mt-8 text-center text-sm text-slate-400">
          <p>System Status: <span className="text-emerald-500 font-medium">Operational</span></p>
          <p className="mt-1">Last updated: {new Date().toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
}
