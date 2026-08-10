import api from './api';

export interface GoalMilestone {
  id: string;
  title: string;
  done: boolean;
}

/**
 * Stored in the performance_goals.target_metrics JSON column.
 * `milestones` is what the UI edits; any other keys (from legacy
 * hand-typed JSON) are preserved untouched on update.
 */
export interface GoalTargetMetrics {
  milestones?: GoalMilestone[];
  [key: string]: unknown;
}

export type GoalScope = 'individual' | 'team' | 'company';

export interface PerformanceGoal {
  id: number;
  organization_id: number;
  employee_id: number | null;
  manager_id: number;
  scope: GoalScope;
  parent_goal_id: number | null;
  group_id: number | null;
  title: string;
  description: string | null;
  category: 'development' | 'performance' | 'behavior' | 'project';
  start_date: string;
  end_date: string;
  target_metrics: GoalTargetMetrics | null;
  weight: number;
  progress_percentage: number;
  status: 'active' | 'completed' | 'cancelled';
  created_at: string;
  updated_at: string;
  employee?: { id: number; name: string } | null;
  manager?: { id: number; name: string };
  group?: { id: number; name: string } | null;
  parent?: { id: number; title: string; scope: GoalScope } | null;
}

export interface GoalCheckIn {
  id: number;
  goal_id: number;
  user_id: number;
  progress_percentage: number;
  note: string | null;
  created_at: string;
  user?: { id: number; name: string };
}

export interface Competency {
  id: number;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface CompetencyRating {
  id: number;
  review_id: number;
  competency_id: number;
  rating: number;
  comment: string | null;
  competency?: { id: number; name: string };
}

export type CyclePhase = 'draft' | 'self' | 'manager' | 'shared' | 'closed';

export interface ReviewCycle {
  id: number;
  organization_id: number;
  name: string;
  period_start: string;
  period_end: string;
  self_due: string | null;
  manager_due: string | null;
  share_date: string | null;
  phase: CyclePhase;
  anonymize_peer: boolean;
  participants_count?: number;
  created_at: string;
  updated_at: string;
}

export interface CycleParticipant {
  id: number;
  review_cycle_id: number;
  employee_id: number;
  self_review_id: number | null;
  manager_review_id: number | null;
  shared_at: string | null;
  acknowledged_at: string | null;
}

export interface ActiveCycleResponse {
  cycle: ReviewCycle | null;
  me?: CycleParticipant | null;
  counts?: { enrolled: number; self_done: number; manager_done: number };
}

export interface CycleStats {
  enrolled: number;
  self_done: number;
  manager_done: number;
  blocked_managers: number;
  by_department: Array<{ department: string; enrolled: number; self_done: number; manager_done: number }>;
}

export interface Aggregate360 {
  reviewer_count: number;
  review_count: number;
  average_rating: number | null;
  competencies: Array<{ competency_id: number; name: string; avg: number; count: number }>;
  comments: Array<{ review_type: string; comment: string; reviewer_name: string | null }>;
}

export interface PerformanceReview {
  id: number;
  organization_id: number;
  employee_id: number;
  /** null when the reviewer is anonymized (peer/360) */
  reviewer_id: number | null;
  goal_id: number | null;
  review_cycle_id: number | null;
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
  reviewer?: { id: number; name: string } | null;
  competency_ratings?: CompetencyRating[];
  cycle?: { id: number; name: string; anonymize_peer: boolean } | null;
}

export interface ReviewSummary {
  total_reviews: number;
  completed_reviews: number;
  average_rating: number | null;
  reviews_by_type: Array<{
    review_type: string;
    count: number;
    avg_rating: number | null;
  }>;
}

export type CompetencyRatingInput = { competency_id: number; rating: number; comment?: string };

/** Write payload: competency_ratings goes up in input shape, not the response shape. */
export type ReviewWriteInput = Partial<Omit<PerformanceReview, 'competency_ratings'>> & {
  competency_ratings?: CompetencyRatingInput[];
};

export const performanceApi = {
  // Performance Goals
  getGoals: () => api.get<PerformanceGoal[]>('/performance/goals').then(r => r.data),
  createGoal: (data: Partial<PerformanceGoal>) =>
    api.post<{ message: string; goal: PerformanceGoal }>('/performance/goals', data).then(r => r.data.goal),
  getGoal: (id: number) =>
    api.get<PerformanceGoal>(`/performance/goals/${id}`).then(r => r.data),
  updateGoal: (id: number, data: Partial<PerformanceGoal>) =>
    api.put<{ message: string; goal: PerformanceGoal }>(`/performance/goals/${id}`, data).then(r => r.data.goal),
  deleteGoal: (id: number) =>
    api.delete<{ message: string }>(`/performance/goals/${id}`).then(r => r.data),

  // Goal check-ins
  getCheckIns: (goalId: number) =>
    api.get<GoalCheckIn[]>(`/performance/goals/${goalId}/check-ins`).then(r => r.data),
  createCheckIn: (goalId: number, data: { progress_percentage: number; note?: string }) =>
    api.post<{ message: string; check_in: GoalCheckIn; goal: PerformanceGoal }>(`/performance/goals/${goalId}/check-ins`, data).then(r => r.data),

  // Performance Reviews
  getReviews: () => api.get<PerformanceReview[]>('/performance/reviews').then(r => r.data),
  createReview: (data: ReviewWriteInput) =>
    api.post<{ message: string; review: PerformanceReview }>('/performance/reviews', data).then(r => r.data.review),
  getReview: (id: number) =>
    api.get<PerformanceReview>(`/performance/reviews/${id}`).then(r => r.data),
  updateReview: (id: number, data: ReviewWriteInput) =>
    api.put<{ message: string; review: PerformanceReview }>(`/performance/reviews/${id}`, data).then(r => r.data.review),
  deleteReview: (id: number) =>
    api.delete<{ message: string }>(`/performance/reviews/${id}`).then(r => r.data),
  getEmployeeReviews: (employeeId: number) =>
    api.get<PerformanceReview[]>(`/performance/reviews/employee/${employeeId}`).then(r => r.data),
  getSummary: () =>
    api.get<ReviewSummary>('/performance/reviews/summary').then(r => r.data),
  getAggregate360: (params: { employee_id: number; period_start: string; period_end: string }) =>
    api.get<Aggregate360>('/performance/reviews/aggregate-360', { params }).then(r => r.data),

  // Review cycles
  getActiveCycle: () =>
    api.get<ActiveCycleResponse>('/performance/cycles/active').then(r => r.data),
  getCycles: () =>
    api.get<ReviewCycle[]>('/performance/cycles').then(r => r.data),
  createCycle: (data: Partial<ReviewCycle>) =>
    api.post<{ message: string; cycle: ReviewCycle }>('/performance/cycles', data).then(r => r.data.cycle),
  getCycle: (id: number) =>
    api.get<{ cycle: ReviewCycle; stats: CycleStats }>(`/performance/cycles/${id}`).then(r => r.data),
  updateCycle: (id: number, data: Partial<ReviewCycle>) =>
    api.put<{ message: string; cycle: ReviewCycle }>(`/performance/cycles/${id}`, data).then(r => r.data.cycle),
  deleteCycle: (id: number) =>
    api.delete<{ message: string }>(`/performance/cycles/${id}`).then(r => r.data),

  // Competencies
  getCompetencies: () =>
    api.get<Competency[]>('/performance/competencies').then(r => r.data),
};
