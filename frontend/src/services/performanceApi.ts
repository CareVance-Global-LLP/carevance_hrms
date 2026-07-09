import api from './api';

export interface PerformanceGoal {
  id: number;
  organization_id: number;
  employee_id: number;
  manager_id: number;
  title: string;
  description: string | null;
  category: 'development' | 'performance' | 'behavior' | 'project';
  start_date: string;
  end_date: string;
  target_metrics: any;
  weight: number;
  progress_percentage: number;
  status: 'active' | 'completed' | 'cancelled';
  created_at: string;
  updated_at: string;
  employee?: { id: number; name: string };
  manager?: { id: number; name: string };
}

export interface PerformanceReview {
  id: number;
  organization_id: number;
  employee_id: number;
  reviewer_id: number;
  goal_id: number | null;
  review_type: 'self' | 'manager' | 'peer' | '360';
  review_period_start: string;
  review_period_end: string;
  overall_rating: number | null;
  strengths: string[] | null;
  areas_for_improvement: string[] | null;
  goals: string[] | null;
  comments: string | null;
  is_confidential: boolean;
  status: 'draft' | 'completed' | 'archived';
  created_at: string;
  updated_at: string;
  employee?: { id: number; name: string };
  reviewer?: { id: number; name: string };
}

export const performanceApi = {
  // Performance Goals
  getGoals: () => api.get<PerformanceGoal[]>('/payroll/performance-goals').then(r => r.data),
  createGoal: (data: Partial<PerformanceGoal>) =>
    api.post<PerformanceGoal>('/payroll/performance-goals', data).then(r => r.data),
  getGoal: (id: number) =>
    api.get<PerformanceGoal>(`/payroll/performance-goals/${id}`).then(r => r.data),
  updateGoal: (id: number, data: Partial<PerformanceGoal>) =>
    api.put<PerformanceGoal>(`/payroll/performance-goals/${id}`, data).then(r => r.data),
  deleteGoal: (id: number) =>
    api.delete(`/payroll/performance-goals/${id}`).then(r => r.data),

  // Performance Reviews
  getReviews: () => api.get<PerformanceReview[]>('/payroll/performance-reviews').then(r => r.data),
  createReview: (data: Partial<PerformanceReview>) =>
    api.post<PerformanceReview>('/payroll/performance-reviews', data).then(r => r.data),
  getReview: (id: number) =>
    api.get<PerformanceReview>(`/payroll/performance-reviews/${id}`).then(r => r.data),
  updateReview: (id: number, data: Partial<PerformanceReview>) =>
    api.put<PerformanceReview>(`/payroll/performance-reviews/${id}`, data).then(r => r.data),
  deleteReview: (id: number) =>
    api.delete(`/payroll/performance-reviews/${id}`).then(r => r.data),
  getEmployeeReviews: (employeeId: number) =>
    api.get<PerformanceReview[]>(`/payroll/performance-reviews/employee/${employeeId}`).then(r => r.data),
  getSummary: () =>
    api.get('/payroll/performance-reviews/summary').then(r => r.data),
};
