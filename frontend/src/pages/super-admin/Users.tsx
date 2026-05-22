import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { 
  Users, 
  Search, 
  Filter,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Building2,
  UserCircle,
  Eye
} from 'lucide-react';
import { superAdminApi } from '@/services/superAdminApi';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import { PageLoadingState, PageErrorState, PageEmptyState } from '@/components/ui/PageState';

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  created_at: string;
  organization?: {
    id: number;
    name: string;
  };
  is_active: boolean;
}

export default function SuperAdminUsers() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'manager' | 'employee'>('all');
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useQuery({
    queryKey: ['super-admin', 'users', page, search, roleFilter],
    queryFn: async () => {
      const response = await superAdminApi.getAllUsers({
        page,
        search,
        role: roleFilter === 'all' ? undefined : roleFilter,
      });
      return response.data;
    },
  });

  if (isLoading) {
    return <PageLoadingState label="Loading users..." />;
  }

  if (error) {
    return <PageErrorState message="Failed to load users" />;
  }

  const users: User[] = data?.data || [];
  const pagination = {
    current_page: data?.current_page || 1,
    last_page: data?.last_page || 1,
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'blue';
      case 'manager':
        return 'violet';
      case 'employee':
        return 'emerald';
      default:
        return 'neutral';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/50">
      <PageHeader
        title="All Users"
        description="View and manage users across all organizations"
        actions={
          <Button variant="secondary" onClick={() => navigate('/super-admin')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        }
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {/* Filters */}
        <SurfaceCard className="p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search users by name or email..."
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm"
              />
            </div>
            <div className="flex gap-2">
              {(['all', 'admin', 'manager', 'employee'] as const).map((role) => (
                <button
                  key={role}
                  onClick={() => setRoleFilter(role)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium capitalize ${
                    roleFilter === role
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {role}
                </button>
              ))}
            </div>
          </div>
        </SurfaceCard>

        {/* Users Table */}
        <SurfaceCard className="p-0 overflow-hidden">
          {users.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4 font-medium text-slate-700">User</th>
                      <th className="px-6 py-4 font-medium text-slate-700">Organization</th>
                      <th className="px-6 py-4 font-medium text-slate-700">Role</th>
                      <th className="px-6 py-4 font-medium text-slate-700">Status</th>
                      <th className="px-6 py-4 font-medium text-slate-700">Joined</th>
                      <th className="px-6 py-4 font-medium text-slate-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {users.map((user) => (
                      <tr key={user.id} className="hover:bg-slate-50/50">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                              <UserCircle className="h-5 w-5 text-blue-600" />
                            </div>
                            <div>
                              <p className="font-medium text-slate-900">{user.name}</p>
                              <p className="text-xs text-slate-500">{user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {user.organization ? (
                            <div className="flex items-center gap-2">
                              <Building2 className="h-4 w-4 text-slate-400" />
                              <span className="text-sm text-slate-600">{user.organization.name}</span>
                            </div>
                          ) : (
                            <span className="text-sm text-slate-400">No organization</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <StatusBadge tone={getRoleColor(user.role) as any}>
                            {user.role}
                          </StatusBadge>
                        </td>
                        <td className="px-6 py-4">
                          <StatusBadge tone={user.is_active ? 'success' : 'danger'}>
                            {user.is_active ? 'Active' : 'Inactive'}
                          </StatusBadge>
                        </td>
                        <td className="px-6 py-4 text-slate-500">
                          {new Date(user.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => user.organization && navigate(`/super-admin/organizations/${user.organization.id}`)}
                              disabled={!user.organization}
                              className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
                              title="View Organization"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                          </div>
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
              title="No users found"
              description={search ? "Try adjusting your search" : "No users in the system yet"}
            />
          )}
        </SurfaceCard>
      </div>
    </div>
  );
}
