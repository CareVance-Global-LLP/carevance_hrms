import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Target,
  TrendingUp,
  Star,
  Calendar,
  User,
  CheckCircle2,
  Clock,
  Plus,
  MoreHorizontal,
  Edit3,
  Trash2,
  X,
  ChevronDown,
  ChevronUp,
  Award,
  AlertCircle,
  BarChart3,
  PieChart,
} from 'lucide-react';
import { performanceApi, type PerformanceReview } from '@/services/performanceApi';
import { useAuth } from '@/contexts/AuthContext';
import Button from '@/components/ui/Button';
import { TextInput, TextareaInput as TextArea, SelectInput } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';
import { canAccess } from '@/lib/permissions';

interface ReviewSummary {
  total_reviews: number;
  completed_reviews: number;
  average_rating: number;
  reviews_by_type: Array<{
    review_type: string;
    count: number;
    avg_rating: number;
  }>;
}

function RatingStars({ rating }: { rating: number | null }) {
  if (!rating) return <span className="text-slate-400">Not rated</span>;
  
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`h-4 w-4 ${
            star <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-200'
          }`}
        />
      ))}
      <span className="ml-1 text-sm font-medium text-slate-700">{rating}/5</span>
    </div>
  );
}

function ReviewCard({
  review,
  onDelete,
  canManage,
}: {
  review: PerformanceReview;
  onDelete: (id: number) => void;
  canManage: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="border border-slate-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span
              className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                review.status === 'completed'
                  ? 'bg-emerald-100 text-emerald-700'
                  : review.status === 'draft'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {review.status}
            </span>
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700 capitalize">
              {review.review_type}
            </span>
            {review.is_confidential && (
              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-rose-100 text-rose-700">
                Confidential
              </span>
            )}
          </div>
          <h3 className="font-semibold text-slate-900">
            {review.employee?.name || 'Unknown Employee'}
          </h3>
          <p className="text-sm text-slate-500">
            Reviewed by {review.reviewer?.name || 'Unknown'} •{' '}
            {new Date(review.review_period_start).toLocaleDateString()} -{' '}
            {new Date(review.review_period_end).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RatingStars rating={review.overall_rating} />
          {canManage && (
            <button
              onClick={() => onDelete(review.id)}
              className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-md transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-md transition-colors"
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          {review.comments && (
            <div className="mb-4">
              <h4 className="text-sm font-medium text-slate-700 mb-2">Comments</h4>
              <p className="text-sm text-slate-600">{review.comments}</p>
            </div>
          )}

          {review.strengths && review.strengths.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-medium text-slate-700 mb-2">Strengths</h4>
              <ul className="space-y-1">
                {review.strengths.map((strength, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm text-slate-600">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                    {strength}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {review.areas_for_improvement && review.areas_for_improvement.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-medium text-slate-700 mb-2">Areas for Improvement</h4>
              <ul className="space-y-1">
                {review.areas_for_improvement.map((area, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm text-slate-600">
                    <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                    {area}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {review.goals && review.goals.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-slate-700 mb-2">Goals</h4>
              <ul className="space-y-1">
                {review.goals.map((goal, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm text-slate-600">
                    <Target className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    {goal}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PerformancePage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    employee_id: '',
    review_type: 'self',
    review_period_start: '',
    review_period_end: '',
    overall_rating: '',
    strengths: [''],
    areas_for_improvement: [''],
    goals: [''],
    comments: '',
    is_confidential: false,
  });

  const { data: reviews, isLoading } = useQuery({
    queryKey: ['performance-reviews'],
    queryFn: () => performanceApi.getReviews(),
  });

  const { data: summary } = useQuery<ReviewSummary>({
    queryKey: ['performance-summary'],
    queryFn: () => performanceApi.getSummary(),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => performanceApi.createReview(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['performance-reviews'] });
      queryClient.invalidateQueries({ queryKey: ['performance-summary'] });
      setShowCreateModal(false);
      setSuccessMessage('Performance review created successfully.');
      setErrorMessage(null);
      resetForm();
    },
    onError: (err: any) => {
      setErrorMessage(err?.response?.data?.message || err?.message || 'Failed to create review.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => performanceApi.deleteReview(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['performance-reviews'] });
      queryClient.invalidateQueries({ queryKey: ['performance-summary'] });
      setSuccessMessage('Review deleted successfully.');
    },
    onError: (err: any) => {
      setErrorMessage(err?.response?.data?.message || err?.message || 'Failed to delete review.');
    },
  });

  const resetForm = () => {
    setFormData({
      employee_id: '',
      review_type: 'self',
      review_period_start: '',
      review_period_end: '',
      overall_rating: '',
      strengths: [''],
      areas_for_improvement: [''],
      goals: [''],
      comments: '',
      is_confidential: false,
    });
  };

  const canManageReviews = canAccess(user, 'performance.manage');
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      ...formData,
      overall_rating: formData.overall_rating ? parseInt(formData.overall_rating) : undefined,
      strengths: formData.strengths.filter(s => s.trim()),
      areas_for_improvement: formData.areas_for_improvement.filter(a => a.trim()),
      goals: formData.goals.filter(g => g.trim()),
    };
    createMutation.mutate(data);
  };

  const addArrayField = (field: 'strengths' | 'areas_for_improvement' | 'goals') => {
    setFormData({
      ...formData,
      [field]: [...formData[field], ''],
    });
  };

  const updateArrayField = (
    field: 'strengths' | 'areas_for_improvement' | 'goals',
    index: number,
    value: string
  ) => {
    const newArray = [...formData[field]];
    newArray[index] = value;
    setFormData({ ...formData, [field]: newArray });
  };

  const removeArrayField = (
    field: 'strengths' | 'areas_for_improvement' | 'goals',
    index: number
  ) => {
    const newArray = formData[field].filter((_, i) => i !== index);
    setFormData({ ...formData, [field]: newArray });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="Performance Reviews"
        description="Manage employee performance reviews and feedback"
      />

      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {successMessage && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <span className="text-sm text-emerald-800">{successMessage}</span>
            <button onClick={() => setSuccessMessage(null)} className="ml-auto">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {errorMessage && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <span className="text-sm text-red-800">{errorMessage}</span>
            <button onClick={() => setErrorMessage(null)} className="ml-auto">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Stats Cards */}
        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <SurfaceCard className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <BarChart3 className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Total Reviews</p>
                  <p className="text-2xl font-bold text-slate-900">{summary.total_reviews}</p>
                </div>
              </div>
            </SurfaceCard>

            <SurfaceCard className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-100 rounded-lg">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Completed</p>
                  <p className="text-2xl font-bold text-slate-900">{summary.completed_reviews}</p>
                </div>
              </div>
            </SurfaceCard>

            <SurfaceCard className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 rounded-lg">
                  <Star className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Average Rating</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {summary.average_rating ? summary.average_rating.toFixed(1) : 'N/A'}
                  </p>
                </div>
              </div>
            </SurfaceCard>

            <SurfaceCard className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <PieChart className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Review Types</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {summary.reviews_by_type?.length || 0}
                  </p>
                </div>
              </div>
            </SurfaceCard>
          </div>
        )}

        {/* Reviews List */}
        <SurfaceCard className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Performance Reviews</h2>
              <p className="text-sm text-slate-500">
                View and manage performance reviews
              </p>
            </div>
            <Button onClick={() => setShowCreateModal(true)}>
              <Plus className="h-4 w-4 mr-2" /> New Review
            </Button>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900"></div>
            </div>
          ) : reviews?.length === 0 ? (
            <div className="text-center py-12">
              <Award className="h-12 w-12 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-slate-900 mb-2">No reviews yet</h3>
              <p className="text-sm text-slate-500 max-w-md mx-auto">
                Start by creating a performance review for yourself or your team members.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {reviews?.map((review) => (
                <ReviewCard
                  key={review.id}
                  review={review}
                  onDelete={(id) => deleteMutation.mutate(id)}
                  canManage={canManageReviews || isAdmin}
                />
              ))}
            </div>
          )}
        </SurfaceCard>

        {/* Create Modal */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-slate-200">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-slate-900">Create Performance Review</h2>
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="text-slate-400 hover:text-slate-600"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Review Type
                    </label>
                    <SelectInput
                      value={formData.review_type}
                      onChange={(e) =>
                        setFormData({ ...formData, review_type: e.target.value })
                      }
                    >
                      <option value="self">Self Review</option>
                      <option value="manager">Manager Review</option>
                      <option value="peer">Peer Review</option>
                      <option value="360">360 Review</option>
                    </SelectInput>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Overall Rating
                    </label>
                    <SelectInput
                      value={formData.overall_rating}
                      onChange={(e) =>
                        setFormData({ ...formData, overall_rating: e.target.value })
                      }
                    >
                      <option value="">Select rating</option>
                      <option value="5">5 - Outstanding</option>
                      <option value="4">4 - Exceeds Expectations</option>
                      <option value="3">3 - Meets Expectations</option>
                      <option value="2">2 - Needs Improvement</option>
                      <option value="1">1 - Unsatisfactory</option>
                    </SelectInput>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Review Period Start
                    </label>
                    <TextInput
                      type="date"
                      value={formData.review_period_start}
                      onChange={(e) =>
                        setFormData({ ...formData, review_period_start: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Review Period End
                    </label>
                    <TextInput
                      type="date"
                      value={formData.review_period_end}
                      onChange={(e) =>
                        setFormData({ ...formData, review_period_end: e.target.value })
                      }
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Comments
                  </label>
                  <TextArea
                    value={formData.comments}
                    onChange={(e) =>
                      setFormData({ ...formData, comments: e.target.value })
                    }
                    rows={4}
                    placeholder="Enter detailed feedback and comments..."
                  />
                </div>

                {/* Strengths */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Strengths
                  </label>
                  {formData.strengths.map((strength, index) => (
                    <div key={index} className="flex gap-2 mb-2">
                      <TextInput
                        value={strength}
                        onChange={(e) =>
                          updateArrayField('strengths', index, e.target.value)
                        }
                        placeholder={`Strength ${index + 1}`}
                        className="flex-1"
                      />
                      {formData.strengths.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeArrayField('strengths', index)}
                          className="p-2 text-slate-400 hover:text-red-500"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addArrayField('strengths')}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                  >
                    + Add Strength
                  </button>
                </div>

                {/* Areas for Improvement */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Areas for Improvement
                  </label>
                  {formData.areas_for_improvement.map((area, index) => (
                    <div key={index} className="flex gap-2 mb-2">
                      <TextInput
                        value={area}
                        onChange={(e) =>
                          updateArrayField('areas_for_improvement', index, e.target.value)
                        }
                        placeholder={`Area ${index + 1}`}
                        className="flex-1"
                      />
                      {formData.areas_for_improvement.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeArrayField('areas_for_improvement', index)}
                          className="p-2 text-slate-400 hover:text-red-500"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addArrayField('areas_for_improvement')}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                  >
                    + Add Area for Improvement
                  </button>
                </div>

                {/* Goals */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Goals
                  </label>
                  {formData.goals.map((goal, index) => (
                    <div key={index} className="flex gap-2 mb-2">
                      <TextInput
                        value={goal}
                        onChange={(e) => updateArrayField('goals', index, e.target.value)}
                        placeholder={`Goal ${index + 1}`}
                        className="flex-1"
                      />
                      {formData.goals.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeArrayField('goals', index)}
                          className="p-2 text-slate-400 hover:text-red-500"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addArrayField('goals')}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                  >
                    + Add Goal
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is_confidential"
                    checked={formData.is_confidential}
                    onChange={(e) =>
                      setFormData({ ...formData, is_confidential: e.target.checked })
                    }
                    className="rounded border-slate-300"
                  />
                  <label htmlFor="is_confidential" className="text-sm text-slate-700">
                    Mark as confidential (only visible to admins and reviewer)
                  </label>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShowCreateModal(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending ? 'Creating...' : 'Create Review'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
