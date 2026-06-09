<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class ReimbursementRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'category' => 'required|string|in:travel,meals,office_supplies,training,medical,other',
            'amount' => 'required|numeric|min:0.01',
            'currency' => 'required|string|size:3',
            'expense_date' => 'required|date|before_or_equal:today',
            'description' => 'required|string|min:10|max:1000',
            'receipt_url' => 'nullable|string|url',
            'merchant_name' => 'nullable|string|max:255',
            'location' => 'nullable|string|max:255',
        ];
    }

    public function messages(): array
    {
        return [
            'category.required' => 'Please select a category.',
            'category.in' => 'Please select a valid category.',
            'amount.required' => 'Please enter the expense amount.',
            'amount.numeric' => 'Amount must be a number.',
            'amount.min' => 'Amount must be greater than 0.',
            'currency.required' => 'Please select a currency.',
            'currency.size' => 'Currency must be a 3-letter code.',
            'expense_date.required' => 'Please select the expense date.',
            'expense_date.before_or_equal' => 'Expense date cannot be in the future.',
            'description.required' => 'Please provide a description.',
            'description.min' => 'Description must be at least 10 characters.',
            'description.max' => 'Description cannot exceed 1000 characters.',
            'receipt_url.url' => 'Please provide a valid receipt URL.',
            'merchant_name.max' => 'Merchant name cannot exceed 255 characters.',
            'location.max' => 'Location cannot exceed 255 characters.',
        ];
    }
}
