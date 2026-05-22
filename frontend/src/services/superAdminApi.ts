import api from './api';

export interface CreateOrganizationRequest {
  name: string;
  slug?: string;
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
  plan_code: string;
  seats: number;
  admin_name: string;
  admin_email: string;
  admin_password: string;
  subscription_status: 'active' | 'trial';
  send_welcome_email?: boolean;
}

export const superAdminApi = {
  // Dashboard Stats
  getStats: () => api.get('/super-admin/stats'),
  
  // Organizations
  getOrganizations: (params?: { page?: number; search?: string; status?: string }) =>
    api.get('/super-admin/organizations', { params }),
  
  getOrganization: (id: number) =>
    api.get(`/super-admin/organizations/${id}`),

  createOrganization: (data: CreateOrganizationRequest) =>
    api.post('/super-admin/organizations', data),
  
  toggleOrganizationStatus: (id: number) =>
    api.put(`/super-admin/organizations/${id}/toggle-status`),
  
  deleteOrganization: (id: number) =>
    api.delete(`/super-admin/organizations/${id}`),
  
  // Users
  getAllUsers: (params?: { page?: number; search?: string; organization_id?: number; role?: string }) =>
    api.get('/super-admin/users', { params }),
  
  impersonateUser: (userId: number) =>
    api.post(`/super-admin/users/${userId}/impersonate`),
  
  // Billing
  getSubscriptions: (params?: { page?: number }) =>
    api.get('/super-admin/subscriptions', { params }),
  
  getRevenue: () =>
    api.get('/super-admin/revenue'),
  
  // Export
  exportOrganizations: (params?: { search?: string; status?: string }) =>
    api.get('/super-admin/organizations/export', { 
      params,
      responseType: 'blob'
    }),
  
  searchGlobal: (query: string) =>
    api.get('/super-admin/search', { params: { q: query } }),
};
