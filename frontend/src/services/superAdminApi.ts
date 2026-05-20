import api from './api';

export const superAdminApi = {
  // Dashboard Stats
  getStats: () => api.get('/super-admin/stats'),
  
  // Organizations
  getOrganizations: (params?: { page?: number; search?: string; status?: string }) =>
    api.get('/super-admin/organizations', { params }),
  
  getOrganization: (id: number) =>
    api.get(`/super-admin/organizations/${id}`),
  
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
};
