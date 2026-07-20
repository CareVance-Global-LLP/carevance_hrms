<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SalaryTemplate;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SalaryStructureController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $templates = SalaryTemplate::query()
            ->where('organization_id', $user->organization_id)
            ->orderBy('is_default', 'desc')
            ->orderBy('name')
            ->get();

        return response()->json([
            'success' => true,
            'templates' => $templates,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'description' => 'nullable|string',
            'basic_percentage' => 'required|numeric|min:0|max:100',
            'hra_percentage' => 'required|numeric|min:0|max:100',
            'conveyance_amount' => 'nullable|numeric|min:0',
            'da_percentage' => 'nullable|numeric|min:0|max:100',
            'cca_amount' => 'nullable|numeric|min:0',
            'education_allowance' => 'nullable|numeric|min:0',
            'internet_allowance' => 'nullable|numeric|min:0',
            'meal_allowance' => 'nullable|numeric|min:0',
            'transport_allowance' => 'nullable|numeric|min:0',
            'uniform_allowance' => 'nullable|numeric|min:0',
            'books_periodicals' => 'nullable|numeric|min:0',
            'fuel_maintenance' => 'nullable|numeric|min:0',
            'nps_percentage' => 'nullable|numeric|min:0|max:100',
            'vpf_percentage' => 'nullable|numeric|min:0|max:100',
            'other_earnings' => 'nullable|array',
            'other_earnings.*.name' => 'required_with:other_earnings|string',
            'other_earnings.*.type' => 'required_with:other_earnings|in:fixed,percentage',
            'other_earnings.*.value' => 'required_with:other_earnings|numeric|min:0',
            'other_deductions' => 'nullable|array',
            'other_deductions.*.name' => 'required_with:other_deductions|string',
            'other_deductions.*.type' => 'required_with:other_deductions|in:fixed,percentage',
            'other_deductions.*.value' => 'required_with:other_deductions|numeric|min:0',
            'is_default' => 'nullable|boolean',
        ]);

        $existing = SalaryTemplate::where('organization_id', $user->organization_id)
            ->where('name', $validated['name'])
            ->first();

        if ($existing) {
            return response()->json([
                'message' => 'A salary structure with this name already exists.',
            ], 422);
        }

        $template = SalaryTemplate::create([
            'organization_id' => $user->organization_id,
            'name' => $validated['name'],
            'description' => $validated['description'] ?? null,
            'basic_percentage' => $validated['basic_percentage'],
            'hra_percentage' => $validated['hra_percentage'],
            'conveyance_amount' => $validated['conveyance_amount'] ?? 0,
            'da_percentage' => $validated['da_percentage'] ?? 0,
            'cca_amount' => $validated['cca_amount'] ?? 0,
            'education_allowance' => $validated['education_allowance'] ?? 0,
            'internet_allowance' => $validated['internet_allowance'] ?? 0,
            'meal_allowance' => $validated['meal_allowance'] ?? 0,
            'transport_allowance' => $validated['transport_allowance'] ?? 0,
            'uniform_allowance' => $validated['uniform_allowance'] ?? 0,
            'books_periodicals' => $validated['books_periodicals'] ?? 0,
            'fuel_maintenance' => $validated['fuel_maintenance'] ?? 0,
            'nps_percentage' => $validated['nps_percentage'] ?? 0,
            'vpf_percentage' => $validated['vpf_percentage'] ?? 0,
            'other_earnings' => $validated['other_earnings'] ?? null,
            'other_deductions' => $validated['other_deductions'] ?? null,
            'is_default' => $validated['is_default'] ?? false,
            'is_active' => true,
            'currency' => 'INR',
        ]);

        if ($template->is_default) {
            SalaryTemplate::where('organization_id', $user->organization_id)
                ->where('id', '!=', $template->id)
                ->update(['is_default' => false]);
        }

        return response()->json([
            'success' => true,
            'message' => 'Salary structure created successfully.',
            'template' => $template,
        ], 201);
    }

    public function show(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $template = SalaryTemplate::query()
            ->where('organization_id', $user->organization_id)
            ->where('id', $id)
            ->first();

        if (!$template) {
            return response()->json(['message' => 'Salary structure not found.'], 404);
        }

        $previewCtc = $request->query('annual_ctc');
        $breakdown = null;
        if ($previewCtc && is_numeric($previewCtc)) {
            $breakdown = $template->calculateBreakdown((float) $previewCtc);
        }

        return response()->json([
            'success' => true,
            'template' => $template,
            'breakdown' => $breakdown,
        ]);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $template = SalaryTemplate::query()
            ->where('organization_id', $user->organization_id)
            ->where('id', $id)
            ->first();

        if (!$template) {
            return response()->json(['message' => 'Salary structure not found.'], 404);
        }

        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'description' => 'nullable|string',
            'basic_percentage' => 'sometimes|numeric|min:0|max:100',
            'hra_percentage' => 'sometimes|numeric|min:0|max:100',
            'conveyance_amount' => 'nullable|numeric|min:0',
            'da_percentage' => 'nullable|numeric|min:0|max:100',
            'cca_amount' => 'nullable|numeric|min:0',
            'education_allowance' => 'nullable|numeric|min:0',
            'internet_allowance' => 'nullable|numeric|min:0',
            'meal_allowance' => 'nullable|numeric|min:0',
            'transport_allowance' => 'nullable|numeric|min:0',
            'uniform_allowance' => 'nullable|numeric|min:0',
            'books_periodicals' => 'nullable|numeric|min:0',
            'fuel_maintenance' => 'nullable|numeric|min:0',
            'nps_percentage' => 'nullable|numeric|min:0|max:100',
            'vpf_percentage' => 'nullable|numeric|min:0|max:100',
            'other_earnings' => 'nullable|array',
            'other_earnings.*.name' => 'required_with:other_earnings|string',
            'other_earnings.*.type' => 'required_with:other_earnings|in:fixed,percentage',
            'other_earnings.*.value' => 'required_with:other_earnings|numeric|min:0',
            'other_deductions' => 'nullable|array',
            'other_deductions.*.name' => 'required_with:other_deductions|string',
            'other_deductions.*.type' => 'required_with:other_deductions|in:fixed,percentage',
            'other_deductions.*.value' => 'required_with:other_deductions|numeric|min:0',
            'is_default' => 'nullable|boolean',
            'is_active' => 'nullable|boolean',
        ]);

        if (isset($validated['name']) && $validated['name'] !== $template->name) {
            $existing = SalaryTemplate::where('organization_id', $user->organization_id)
                ->where('name', $validated['name'])
                ->where('id', '!=', $id)
                ->first();

            if ($existing) {
                return response()->json([
                    'message' => 'A salary structure with this name already exists.',
                ], 422);
            }
        }

        $template->update($validated);

        if ($template->is_default) {
            SalaryTemplate::where('organization_id', $user->organization_id)
                ->where('id', '!=', $template->id)
                ->update(['is_default' => false]);
        }

        return response()->json([
            'success' => true,
            'message' => 'Salary structure updated successfully.',
            'template' => $template->fresh(),
        ]);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $template = SalaryTemplate::query()
            ->where('organization_id', $user->organization_id)
            ->where('id', $id)
            ->first();

        if (!$template) {
            return response()->json(['message' => 'Salary structure not found.'], 404);
        }

        if ($template->is_default) {
            return response()->json([
                'message' => 'Cannot delete the default salary structure.',
            ], 422);
        }

        $template->update(['is_active' => false]);

        return response()->json([
            'success' => true,
            'message' => 'Salary structure deleted successfully.',
        ]);
    }

    public function default(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $template = SalaryTemplate::query()
            ->where('organization_id', $user->organization_id)
            ->where('is_default', true)
            ->where('is_active', true)
            ->first();

        if (!$template) {
            $template = SalaryTemplate::query()
                ->where('organization_id', $user->organization_id)
                ->where('is_active', true)
                ->first();
        }

        if (!$template) {
            return response()->json(['message' => 'No salary structure found.'], 404);
        }

        return response()->json([
            'success' => true,
            'template' => $template,
        ]);
    }

    public function preview(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $validated = $request->validate([
            'annual_ctc' => 'required|numeric|min:0',
        ]);

        $template = SalaryTemplate::query()
            ->where('organization_id', $user->organization_id)
            ->where('id', $id)
            ->first();

        if (!$template) {
            return response()->json(['message' => 'Salary structure not found.'], 404);
        }

        $breakdown = $template->calculateBreakdown((float) $validated['annual_ctc']);

        return response()->json([
            'success' => true,
            'breakdown' => $breakdown,
            'annual_ctc' => $validated['annual_ctc'],
        ]);
    }
}
