<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StorePerformanceGoalRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'employee_id' => 'required|integer|exists:users,id',
            'title' => 'required|string|max:255',
            'description' => 'nullable|string',
            'category' => 'required|string|in:development,performance,behavior,project',
            'start_date' => 'required|date',
            'end_date' => 'required|date|after_or_equal:start_date',
            'target_metrics' => 'nullable|array',
            'weight' => 'nullable|integer|min:1|max:100',
        ];
    }

    public function messages(): array
    {
        return [
            'employee_id.required' => 'Please select an employee.',
            'employee_id.exists' => 'The selected employee does not exist.',
            'title.required' => 'Please enter a goal title.',
            'title.max' => 'Goal title cannot exceed 255 characters.',
            'category.required' => 'Please select a category.',
            'category.in' => 'Please select a valid category.',
            'start_date.required' => 'Please select a start date.',
            'start_date.date' => 'Please enter a valid start date.',
            'end_date.required' => 'Please select an end date.',
            'end_date.date' => 'Please enter a valid end date.',
            'end_date.after_or_equal' => 'End date must be after or equal to start date.',
            'weight.integer' => 'Weight must be a whole number.',
            'weight.min' => 'Weight must be at least 1%.',
            'weight.max' => 'Weight cannot exceed 100%.',
        ];
    }
}
