import React from 'react';
import OrganizationTree from '@/pages/OrganizationTree';
import { AuthContext } from '@/contexts/AuthContext';

const mockUser: any = {
  id: 1, name: 'Admin', email: 'admin@x.com', role: 'admin', role_name: 'Admin',
  hierarchy_level: 1, department_id: 1, department: 'Engineering', reporting_manager_id: null,
  is_active: true, created_at: '2024-01-01',
};

const mockAuth: any = {
  isAuthenticated: true,
  isAuthLoading: false,
  user: mockUser,
  isLoading: false,
  login: async () => {},
  logout: () => {},
  refetch: () => {},
};

export default function DebugOrgTree() {
  return React.createElement(AuthContext.Provider, { value: mockAuth }, React.createElement(OrganizationTree));
}
