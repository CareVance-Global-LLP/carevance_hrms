import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { 
  Building2, 
  Search, 
  Filter,
  Eye,
  Power,
  Trash2,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Loader2,
  X,
  CheckCircle2,
  AlertCircle
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
  subscription_status: string;
  created_at: string;
  users_count: number;
  plan_code?: string;
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
  const [isExporting, setIsExporting] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['super-admin', 'organizations', page, search, statusFilter],
    queryFn: async () => {
      const response = await superAdminApi.getOrganizations({
        page,
        search: search || undefined,
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
      setFeedback({ tone: 'success', message: 'Organization status updated successfully' });
    },
    onError: () => {
      setFeedback({ tone: 'error', message: 'Failed to update organization status' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (orgId: number) => {
      return superAdminApi.deleteOrganization(orgId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admin', 'organizations'] });
      setFeedback({ tone: 'success', message: 'Organization deleted successfully' });
    },
    onError: () => {
      setFeedback({ tone: 'error', message: 'Failed to delete organization' });
    },
  });

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await superAdminApi.exportOrganizations({
        search: search || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter,
      });
      
      // Create blob from response
      const blob = new Blob([response.data], { 
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
      });
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `organizations_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      setFeedback({ tone: 'success', message: 'Excel file downloaded successfully' });
    } catch (err) {
      setFeedback({ tone: 'error', message: 'Failed to export data' });
    } finally {
      setIsExporting(false);
    }
  };

  const clearSearch = () => {
    setSearch('');
    searchInputRef.current?.focus();
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

  if (isLoading) {
    return <PageLoadingState label="Loading organizations..." />;
  }

  if (error) {
    return <PageErrorState message="Failed to load organizations" />;
  }

  const organizations: Organization[] = data?.data || [];
  const pagination = {
    current_page: data?.current_page || 1,
    last_page: data?.last_page || 1,
    total: data?.total || 0,
  };

  const hasActiveFilters = search || statusFilter !== 'all';

  return (
    <div className="min-h-screen bg-slate-50/50">
      <PageHeader
        title="Organizations"
        description="Manage all organizations in the system"
        actions={
          <div className="flex items-center gap-2">
            <Button 
              variant="secondary" 
              onClick={handleExport}
              disabled={isExporting || organizations.length === 0}
              className="flex items-center gap-2"
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-4 w-4" />
              )}
              Export to Excel
            </Button>
            <Button variant="secondary" onClick={() => navigate('/super-admin')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Button>
            <Button variant="primary" onClick={() => navigate('/super-admin/organizations/create')}>
              <Building2 className="mr-2 h-4 w-4" />
              Create Organization
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

        {/* Search and Filters */}
        <SurfaceCard className="p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Search Input */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search organizations by name, slug, or owner..."
                className="w-full pl-10 pr-10 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              {search && (
                <button
                  onClick={clearSearch}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <X className="h-4 w-4 text-slate-400" />
                </button>
              )}
            </div>
            
            {/* Status Filters */}
            <div className="flex gap-2">
              {(['all', 'active', 'suspended'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => {
                    setStatusFilter(status);
                    setPage(1);
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                    statusFilter === status
                      ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-500 ring-offset-1'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {status === 'all' && 'All'}
                  {status === 'active' && (
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Active
                    </span>
                  )}
                  {status === 'suspended' && (
                    <span className="flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" /> Suspended
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Active Filters Display */}
          {hasActiveFilters && (
            <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-2 text-sm">
              <span className="text-slate-500">Active filters:</span>
              {search && (
                <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded-full text-xs flex items-center gap-1">
                  Search: "{search}"
                  <button onClick={() => setSearch('')} className="hover:text-blue-900">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              {statusFilter !== 'all' && (
                <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded-full text-xs flex items-center gap-1 capitalize">
                  Status: {statusFilter}
                  <button onClick={() => setStatusFilter('all')} className="hover:text-blue-900">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              <button
                onClick={() => {
                  setSearch('');
                  setStatusFilter('all');
                  setPage(1);
                }}
                className="text-xs text-slate-400 hover:text-slate-600 underline"
              >
                Clear all
              </button>
            </div>
          )}
        </SurfaceCard>

        {/* Results Summary */}
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-slate-600">
            Showing <span className="font-semibold text-slate-900">{organizations.length}</span> of{' '}
            <span className="font-semibold text-slate-900">{pagination.total}</span> organizations
          </p>
          {hasActiveFilters && (
            <p className="text-xs text-slate-400">
              Filtered results
            </p>
          )}
        </div>

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
                      <th className="px-6 py-4 font-medium text-slate-700 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {organizations.map((org) => (
                      <tr key={org.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center text-white text-xs font-bold">
                              {org.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-medium text-slate-900">{org.name}</p>
                              <p className="text-xs text-slate-500">{org.slug}</p>
                              {org.owner && (
                                <p className="text-xs text-slate-400 mt-0.5">
                                  Owner: {org.owner.name}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 capitalize">
                            {org.plan_code || 'No plan'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                            <span className="text-sm text-slate-600">
                              {org.users_count} users
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {getStatusBadge(org.subscription_status)}
                        </td>
                        <td className="px-6 py-4 text-slate-500">
                          {new Date(org.created_at).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric'
                          })}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => navigate(`/super-admin/organizations/${org.id}`)}
                              className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
                              title="View Details"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => toggleStatusMutation.mutate(org.id)}
                              disabled={toggleStatusMutation.isPending}
                              className={`p-2 hover:bg-slate-100 rounded-lg transition-colors ${
                                org.subscription_status === 'active' 
                                  ? 'text-amber-600 hover:text-amber-700' 
                                  : 'text-emerald-600 hover:text-emerald-700'
                              }`}
                              title={org.subscription_status === 'active' ? 'Suspend' : 'Activate'}
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
                              className="p-2 hover:bg-rose-100 rounded-lg text-rose-600 transition-colors"
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
                    className="flex items-center gap-1 px-3 py-2 border border-slate-200 rounded-lg disabled:opacity-50 hover:bg-slate-50 transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(pagination.last_page, p + 1))}
                    disabled={page === pagination.last_page}
                    className="flex items-center gap-1 px-3 py-2 border border-slate-200 rounded-lg disabled:opacity-50 hover:bg-slate-50 transition-colors"
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <PageEmptyState
              title="No organizations found"
              description={
                hasActiveFilters 
                  ? "Try adjusting your search or filters" 
                  : "No organizations in the system yet"
              }
            />
          )}
        </SurfaceCard>
      </div>
    </div>
  );
}
