<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StorePerformanceReviewRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'employee_id' => 'required|integer|exists:users,id',
            'review_type' => 'required|string|in:self,manager,peer,360',
            'review_period_start' => 'required|date',
            'review_period_end' => 'required|date|after_or_equal:review_period_start',
            'goal_id' => 'nullable|integer|exists:performance_goals,id',
            'overall_rating' => 'nullable|integer|min:1|max:5',
            'strengths' => 'nullable|array',
            'strengths.*' => 'string|max:500',
            'areas_for_improvement' => 'nullable|array',
            'areas_for_improvement.*' => 'string|max:500',
            'goals' => 'nullable|array',
            'goals.*' => 'string|max:500',
            'comments' => 'nullable|string|max:5000',
            'is_confidential' => 'nullable|boolean',
        ];
    }

    public function messages(): array
    {
        return [
            'employee_id.required' => 'Please select an employee.',
            'employee_id.exists' => 'The selected employee does not exist.',
            'review_type.required' => 'Please select a review type.',
            'review_type.in' => 'Please select a valid review type.',
            'review_period_start.required' => 'Please select a review period start date.',
            'review_period_end.required' => 'Please select a review period end date.',
            'review_period_end.after_or_equal' => 'Review period end must be after or equal to start.',
            'goal_id.exists' => 'The selected goal does not exist.',
            'overall_rating.integer' => 'Rating must be a whole number.',
            'overall_rating.min' => 'Rating must be at least 1.',
            'overall_rating.max' => 'Rating cannot exceed 5.',
            'comments.max' => 'Comments cannot exceed 5000 characters.',
        ];
    }
}
