import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { 
  Building2, 
  Search, 
  Filter,
  MoreHorizontal,
  Edit,
  Eye,
  Power,
  Trash2,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Loader2
} from 'lucide-react';
import { superAdminApi } from '@/services/superAdminApi';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import { PageLoadingState, PageErrorState, PageEmptyState } from '@/components/ui/PageState';
import { FeedbackBanner } from '@/components/ui/PageState';

interface Organization {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
  users_count: number;
  subscription?: {
    status: string;
    plan?: {
      name: string;
    };
  };
  owner?: {
    name: string;
    email: string;
  };
}

export default function SuperAdminOrganizations() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [page, setPage] = useState(1);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['super-admin', 'organizations', page, search, statusFilter],
    queryFn: async () => {
      const response = await superAdminApi.getOrganizations({
        page,
        search,
        status: statusFilter === 'all' ? undefined : statusFilter,
      });
      return response.data;
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async (orgId: number) => {
      return superAdminApi.toggleOrganizationStatus(orgId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admin', 'organizations'] });
      setFeedback({ tone: 'success', message: 'Organization status updated' });
    },
    onError: () => {
      setFeedback({ tone: 'error', message: 'Failed to update status' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (orgId: number) => {
      return superAdminApi.deleteOrganization(orgId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admin', 'organizations'] });
      setFeedback({ tone: 'success', message: 'Organization deleted' });
    },
    onError: () => {
      setFeedback({ tone: 'error', message: 'Failed to delete organization' });
    },
  });

  if (isLoading) {
    return <PageLoadingState label="Loading organizations..." />;
  }

  if (error) {
    return <PageErrorState message="Failed to load organizations" />;
  }

  const organizations: Organization[] = data?.data || [];
  const pagination = data?.meta || { current_page: 1, last_page: 1 };

  return (
    <div className="min-h-screen bg-slate-50/50">
      <PageHeader
        title="Organizations"
        description="Manage all organizations in the system"
        actions={
          <Button variant="secondary" onClick={() => navigate('/super-admin')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        }
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {feedback && (
          <FeedbackBanner tone={feedback.tone} message={feedback.message} className="mb-6" />
        )}

        {/* Filters */}
        <SurfaceCard className="p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search organizations..."
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm"
              />
            </div>
            <div className="flex gap-2">
              {(['all', 'active', 'suspended'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium capitalize ${
                    statusFilter === status
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
        </SurfaceCard>

        {/* Organizations Table */}
        <SurfaceCard className="p-0 overflow-hidden">
          {organizations.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4 font-medium text-slate-700">Organization</th>
                      <th className="px-6 py-4 font-medium text-slate-700">Plan</th>
                      <th className="px-6 py-4 font-medium text-slate-700">Users</th>
                      <th className="px-6 py-4 font-medium text-slate-700">Status</th>
                      <th className="px-6 py-4 font-medium text-slate-700">Created</th>
                      <th className="px-6 py-4 font-medium text-slate-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {organizations.map((org) => (
                      <tr key={org.id} className="hover:bg-slate-50/50">
                        <td className="px-6 py-4">
                          <div>
                            <p className="font-medium text-slate-900">{org.name}</p>
                            <p className="text-xs text-slate-500">{org.slug}</p>
                            {org.owner && (
                              <p className="text-xs text-slate-400 mt-1">
                                Owner: {org.owner.name}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-slate-600">
                            {org.subscription?.plan?.name || 'No plan'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-slate-600">
                            {org.users_count} users
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <StatusBadge tone={org.is_active ? 'success' : 'danger'}>
                            {org.is_active ? 'Active' : 'Suspended'}
                          </StatusBadge>
                        </td>
                        <td className="px-6 py-4 text-slate-500">
                          {new Date(org.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => navigate(`/super-admin/organizations/${org.id}`)}
                              className="p-2 hover:bg-slate-100 rounded-lg text-slate-600"
                              title="View Details"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => toggleStatusMutation.mutate(org.id)}
                              disabled={toggleStatusMutation.isPending}
                              className="p-2 hover:bg-slate-100 rounded-lg text-slate-600"
                              title={org.is_active ? 'Suspend' : 'Activate'}
                            >
                              <Power className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => {
                                if (confirm('Are you sure you want to delete this organization? This cannot be undone.')) {
                                  deleteMutation.mutate(org.id);
                                }
                              }}
                              disabled={deleteMutation.isPending}
                              className="p-2 hover:bg-rose-100 rounded-lg text-rose-600"
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
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
              title="No organizations found"
              description={search ? "Try adjusting your search" : "No organizations in the system yet"}
            />
          )}
        </SurfaceCard>
      </div>
    </div>
  );
}
