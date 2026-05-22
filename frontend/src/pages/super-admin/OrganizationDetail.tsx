import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Users,
  Mail,
  Phone,
  MapPin,
  Calendar,
  CreditCard,
  ArrowLeft,
  Power,
  Trash2,
  ExternalLink,
  UserCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Briefcase,
  Shield,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { superAdminApi } from '@/services/superAdminApi';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import { PageLoadingState, PageErrorState, PageEmptyState } from '@/components/ui/PageState';

interface OrganizationDetail {
  id: number;
  name: string;
  slug: string;
  description?: string;
  website?: string;
  industry?: string;
  size?: string;
  phone?: string;
  email?: string;
  address_line?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  subscription_status: string;
  subscription_plan?: string;
  subscription_start_date?: string;
  subscription_end_date?: string;
  created_at: string;
  updated_at: string;
  owner?: {
    id: number;
    name: string;
    email: string;
    role: string;
  };
  users_count: number;
  active_users_count: number;
}

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  created_at: string;
  email_verified_at?: string;
  organization?: {
    id: number;
    name: string;
  };
}

export default function SuperAdminOrganizationDetailPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'billing'>('overview');
  const [usersPage, setUsersPage] = useState(1);

  const orgId = parseInt(organizationId || '0', 10);

  // Fetch organization details
  const { data: organization, isLoading: isLoadingOrg, error: orgError } = useQuery<OrganizationDetail>({
    queryKey: ['super-admin', 'organization', orgId],
    queryFn: async () => {
      const response = await superAdminApi.getOrganization(orgId);
      return response.data.data;
    },
    enabled: !!orgId,
  });

  // Fetch users for this organization
  const { data: usersData, isLoading: isLoadingUsers } = useQuery({
    queryKey: ['super-admin', 'users', 'organization', orgId, usersPage],
    queryFn: async () => {
      const response = await superAdminApi.getAllUsers({
        organization_id: orgId,
        page: usersPage,
      });
      return response.data;
    },
    enabled: !!orgId && activeTab === 'users',
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async () => {
      return superAdminApi.toggleOrganizationStatus(orgId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admin', 'organization', orgId] });
      queryClient.invalidateQueries({ queryKey: ['super-admin', 'organizations'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      return superAdminApi.deleteOrganization(orgId);
    },
    onSuccess: () => {
      navigate('/super-admin/organizations');
    },
  });

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

  const getRoleIcon = (role: string) => {
    switch (role?.toLowerCase()) {
      case 'admin':
        return <Shield className="h-4 w-4 text-blue-600" />;
      case 'manager':
        return <Briefcase className="h-4 w-4 text-violet-600" />;
      default:
        return <UserCircle className="h-4 w-4 text-emerald-600" />;
    }
  };

  const getRoleBadgeClass = (role: string) => {
    switch (role?.toLowerCase()) {
      case 'admin':
        return 'bg-blue-100 text-blue-700';
      case 'manager':
        return 'bg-violet-100 text-violet-700';
      case 'super_admin':
        return 'bg-amber-100 text-amber-700';
      default:
        return 'bg-emerald-100 text-emerald-700';
    }
  };

  if (isLoadingOrg) {
    return <PageLoadingState label="Loading organization details..." />;
  }

  if (orgError) {
    return (
      <PageErrorState
        message="Failed to load organization details"
        action={
          <Button variant="secondary" onClick={() => navigate('/super-admin/organizations')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Organizations
          </Button>
        }
      />
    );
  }

  if (!organization) {
    return (
      <PageErrorState
        message="Organization not found"
        action={
          <Button variant="secondary" onClick={() => navigate('/super-admin/organizations')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Organizations
          </Button>
        }
      />
    );
  }

  const users: User[] = usersData?.data || [];
  const usersPagination = {
    current_page: usersData?.current_page || 1,
    last_page: usersData?.last_page || 1,
    total: usersData?.total || 0,
  };

  return (
    <div className="min-h-screen bg-slate-50/50">
      <PageHeader
        eyebrow="Super Admin"
        title={organization.name}
        description={`Organization ID: ${organization.id} • Slug: ${organization.slug}`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => navigate('/super-admin/organizations')}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Organizations
            </Button>
            <Button
              variant={organization.subscription_status === 'active' ? 'danger' : 'primary'}
              onClick={() => toggleStatusMutation.mutate()}
              disabled={toggleStatusMutation.isPending}
            >
              {toggleStatusMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Power className="mr-2 h-4 w-4" />
              )}
              {organization.subscription_status === 'active' ? 'Suspend' : 'Activate'}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirm('Are you sure you want to delete this organization? This cannot be undone.')) {
                  deleteMutation.mutate();
                }
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Delete
            </Button>
          </div>
        }
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {/* Status Bar */}
        <SurfaceCard className="mb-6 p-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-6 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500">Status:</span>
                {getStatusBadge(organization.subscription_status)}
              </div>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-slate-400" />
                <span className="text-sm text-slate-600">
                  {organization.users_count} users ({organization.active_users_count} active)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-slate-400" />
                <span className="text-sm text-slate-600">
                  Created {new Date(organization.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-slate-400" />
              <span className="text-sm text-slate-600">
                Plan: {organization.subscription_plan || organization.plan_code || 'No plan'}
              </span>
            </div>
          </div>
        </SurfaceCard>

        {/* Tabs */}
        <div className="mb-6">
          <div className="border-b border-slate-200">
            <nav className="-mb-px flex gap-6">
              {(['overview', 'users', 'billing'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => {
                    setActiveTab(tab);
                    if (tab === 'users') setUsersPage(1);
                  }}
                  className={`py-3 px-1 border-b-2 font-medium text-sm capitalize transition-colors ${
                    activeTab === tab
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Organization Info */}
            <SurfaceCard className="p-6 lg:col-span-2">
              <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Building2 className="h-5 w-5 text-blue-600" />
                Organization Information
              </h3>
              <div className="space-y-4">
                {organization.description ? (
                  <div>
                    <label className="text-sm font-medium text-slate-500">Description</label>
                    <p className="text-slate-700 mt-1">{organization.description}</p>
                  </div>
                ) : (
                  <div>
                    <label className="text-sm font-medium text-slate-500">Description</label>
                    <p className="text-slate-400 mt-1 italic">No description provided</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  {organization.industry ? (
                    <div>
                      <label className="text-sm font-medium text-slate-500">Industry</label>
                      <p className="text-slate-700 mt-1 capitalize">{organization.industry}</p>
                    </div>
                  ) : (
                    <div>
                      <label className="text-sm font-medium text-slate-500">Industry</label>
                      <p className="text-slate-400 mt-1 italic">Not specified</p>
                    </div>
                  )}
                  {organization.size ? (
                    <div>
                      <label className="text-sm font-medium text-slate-500">Company Size</label>
                      <p className="text-slate-700 mt-1">{organization.size}</p>
                    </div>
                  ) : (
                    <div>
                      <label className="text-sm font-medium text-slate-500">Company Size</label>
                      <p className="text-slate-400 mt-1 italic">Not specified</p>
                    </div>
                  )}
                </div>
                {organization.website ? (
                  <div>
                    <label className="text-sm font-medium text-slate-500">Website</label>
                    <a
                      href={organization.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-700 flex items-center gap-1 mt-1"
                    >
                      {organization.website}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                ) : (
                  <div>
                    <label className="text-sm font-medium text-slate-500">Website</label>
                    <p className="text-slate-400 mt-1 italic">No website</p>
                  </div>
                )}
              </div>
            </SurfaceCard>

            {/* Contact Info */}
            <SurfaceCard className="p-6">
              <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Mail className="h-5 w-5 text-violet-600" />
                Contact Information
              </h3>
              <div className="space-y-4">
                {organization.email ? (
                  <div className="flex items-center gap-3">
                    <Mail className="h-4 w-4 text-slate-400" />
                    <a
                      href={`mailto:${organization.email}`}
                      className="text-slate-700 hover:text-blue-600"
                    >
                      {organization.email}
                    </a>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <Mail className="h-4 w-4 text-slate-400" />
                    <span className="text-slate-400 italic">No email</span>
                  </div>
                )}
                {organization.phone ? (
                  <div className="flex items-center gap-3">
                    <Phone className="h-4 w-4 text-slate-400" />
                    <span className="text-slate-700">{organization.phone}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <Phone className="h-4 w-4 text-slate-400" />
                    <span className="text-slate-400 italic">No phone</span>
                  </div>
                )}
                {(organization.address_line || organization.city) ? (
                  <div className="flex items-start gap-3">
                    <MapPin className="h-4 w-4 text-slate-400 mt-0.5" />
                    <div className="text-slate-700">
                      {organization.address_line && <div>{organization.address_line}</div>}
                      {(organization.city || organization.state) && (
                        <div>
                          {organization.city}
                          {organization.city && organization.state && ', '}
                          {organization.state}
                        </div>
                      )}
                      {(organization.postal_code || organization.country) && (
                        <div>
                          {organization.postal_code}
                          {organization.postal_code && organization.country && ' '}
                          {organization.country}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <MapPin className="h-4 w-4 text-slate-400 mt-0.5" />
                    <span className="text-slate-400 italic">No address</span>
                  </div>
                )}
              </div>
            </SurfaceCard>

            {/* Owner Info */}
            {organization.owner ? (
              <SurfaceCard className="p-6 lg:col-span-3">
                <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                  <UserCircle className="h-5 w-5 text-emerald-600" />
                  Organization Owner
                </h3>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center text-white text-lg font-bold">
                    {organization.owner.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-medium text-slate-900">{organization.owner.name}</p>
                    <p className="text-sm text-slate-500">{organization.owner.email}</p>
                    <div className="flex items-center gap-1 mt-1">
                      {getRoleIcon(organization.owner.role)}
                      <span className="text-sm text-slate-600 capitalize">
                        {organization.owner.role}
                      </span>
                    </div>
                  </div>
                </div>
              </SurfaceCard>
            ) : (
              <SurfaceCard className="p-6 lg:col-span-3">
                <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                  <UserCircle className="h-5 w-5 text-emerald-600" />
                  Organization Owner
                </h3>
                <p className="text-slate-400 italic">No owner information available</p>
              </SurfaceCard>
            )}
          </div>
        )}

        {/* Users Tab */}
        {activeTab === 'users' && (
          <SurfaceCard className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">Users</h3>
              <span className="text-sm text-slate-500">
                Showing {users.length} of {usersPagination.total} users
              </span>
            </div>
            
            {isLoadingUsers ? (
              <div className="py-8 text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto text-blue-600 mb-2" />
                <p className="text-sm text-slate-500">Loading users...</p>
              </div>
            ) : users.length > 0 ? (
              <>
                <div className="space-y-3">
                  {users.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center justify-between p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center text-white text-sm font-bold">
                          {user.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-slate-900">{user.name}</p>
                          <p className="text-sm text-slate-500">{user.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${getRoleBadgeClass(user.role)}`}>
                          {user.role}
                        </span>
                        <span className="text-sm text-slate-400">
                          Joined {new Date(user.created_at).toLocaleDateString()}
                        </span>
                        {user.email_verified_at ? (
                          <span className="flex items-center gap-1 text-xs text-emerald-600">
                            <CheckCircle2 className="h-3 w-3" />
                            Verified
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-amber-600">
                            <Clock className="h-3 w-3" />
                            Pending
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                
                {/* Pagination */}
                {usersPagination.last_page > 1 && (
                  <div className="mt-6 pt-4 border-t border-slate-200 flex items-center justify-between">
                    <p className="text-sm text-slate-500">
                      Page {usersPagination.current_page} of {usersPagination.last_page}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setUsersPage((p) => Math.max(1, p - 1))}
                        disabled={usersPage === 1}
                        className="flex items-center gap-1 px-3 py-2 border border-slate-200 rounded-lg disabled:opacity-50 hover:bg-slate-50 transition-colors"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Previous
                      </button>
                      <button
                        onClick={() => setUsersPage((p) => Math.min(usersPagination.last_page, p + 1))}
                        disabled={usersPage === usersPagination.last_page}
                        className="flex items-center gap-1 px-3 py-2 border border-slate-200 rounded-lg disabled:opacity-50 hover:bg-slate-50 transition-colors"
                      >
                        Next
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <PageEmptyState
                title="No users found"
                description="This organization has no users yet"
              />
            )}
          </SurfaceCard>
        )}

        {/* Billing Tab */}
        {activeTab === 'billing' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SurfaceCard className="p-6">
              <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-emerald-600" />
                Subscription Details
              </h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500">Status</span>
                  {getStatusBadge(organization.subscription_status)}
                </div>
                <div className="flex items-center justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500">Plan</span>
                  <span className="font-medium text-slate-900 capitalize">
                    {organization.subscription_plan || organization.plan_code || 'No plan'}
                  </span>
                </div>
                {organization.trial_starts_at && (
                  <div className="flex items-center justify-between py-2 border-b border-slate-100">
                    <span className="text-slate-500">Trial Start</span>
                    <span className="font-medium text-slate-900">
                      {new Date(organization.trial_starts_at).toLocaleDateString()}
                    </span>
                  </div>
                )}
                {organization.trial_ends_at && (
                  <div className="flex items-center justify-between py-2 border-b border-slate-100">
                    <span className="text-slate-500">Trial End</span>
                    <span className="font-medium text-slate-900">
                      {new Date(organization.trial_ends_at).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>
            </SurfaceCard>

            <SurfaceCard className="p-6">
              <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Calendar className="h-5 w-5 text-blue-600" />
                Account Timeline
              </h3>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  </div>
                  <div>
                    <p className="font-medium text-slate-900">Account Created</p>
                    <p className="text-sm text-slate-500">
                      {new Date(organization.created_at).toLocaleDateString()} at{' '}
                      {new Date(organization.created_at).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <Clock className="h-4 w-4 text-blue-600" />
                  </div>
                  <div>
                    <p className="font-medium text-slate-900">Last Updated</p>
                    <p className="text-sm text-slate-500">
                      {new Date(organization.updated_at).toLocaleDateString()} at{' '}
                      {new Date(organization.updated_at).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              </div>
            </SurfaceCard>
          </div>
        )}
      </div>
    </div>
  );
}
