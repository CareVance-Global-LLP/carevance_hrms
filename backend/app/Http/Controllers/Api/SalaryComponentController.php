<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SalaryComponent;
use App\Models\SalaryFormula;
use App\Services\SalaryFormulaEngine;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class SalaryComponentController extends Controller
{
    /**
     * List all salary components for the organization.
     */
    public function index(Request $request): JsonResponse
    {
        $orgId = $request->user()->organization_id;

        $components = SalaryComponent::where('organization_id', $orgId)
            ->with(['formulas' => fn ($q) => $q->orderBy('id')])
            ->orderBy('category')
            ->orderBy('name')
            ->get();

        return response()->json([
            'success' => true,
            'components' => $components,
        ]);
    }

    /**
     * Show a single component with its formulas.
     */
    public function show(Request $request, int $id): JsonResponse
    {
        $orgId = $request->user()->organization_id;

        $component = SalaryComponent::where('organization_id', $orgId)
            ->with(['formulas' => fn ($q) => $q->orderBy('id')])
            ->findOrFail($id);

        return response()->json([
            'success' => true,
            'component' => $component,
        ]);
    }

    /**
     * Create a new salary component.
     */
    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'name'               => 'required|string|max:100',
            'code'               => 'required|string|max:50',
            'category'           => 'required|in:earning,deduction',
            'value_type'         => 'required|in:flat,percentage,formula',
            'calculation_basis'  => 'nullable|in:ctc,basic,gross',
            'default_value'      => 'nullable|numeric|min:0',
            'is_taxable'         => 'boolean',
            'is_compliance_component' => 'boolean',
        ]);

        $orgId = $request->user()->organization_id;

        // Duplicate code check
        $exists = SalaryComponent::where('organization_id', $orgId)
            ->where('code', $request->code)
            ->exists();
        if ($exists) {
            return response()->json([
                'success' => false,
                'message' => "Component code '{$request->code}' already exists.",
            ], 422);
        }

        $component = SalaryComponent::create([
            'organization_id'        => $orgId,
            'name'                   => $request->name,
            'code'                   => strtoupper($request->code),
            'category'               => $request->category,
            'impact'                 => $request->category === 'deduction' ? 'deduction' : 'earning',
            'value_type'             => $request->value_type,
            'calculation_basis'      => $request->calculation_basis,
            'default_value'          => $request->default_value ?? 0,
            'is_taxable'             => $request->boolean('is_taxable', true),
            'is_compliance_component' => $request->boolean('is_compliance_component', false),
            'is_system_default'      => false,
            'is_active'              => true,
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Component created successfully',
            'component' => $component,
        ], 201);
    }

    /**
     * Update a salary component.
     */
    public function update(Request $request, int $id): JsonResponse
    {
        $request->validate([
            'name'          => 'sometimes|string|max:100',
            'category'      => 'sometimes|in:earning,deduction',
            'value_type'    => 'sometimes|in:flat,percentage,formula',
            'default_value' => 'sometimes|numeric|min:0',
            'is_taxable'    => 'sometimes|boolean',
            'is_active'     => 'sometimes|boolean',
            // The per-component override gate. Keka's wording is "Allow this
            // component to be customized and overridden at the employee level",
            // and the point of it is that an ungated component is never offered
            // in the override UI rather than offered and then refused.
            'allow_employee_override' => 'sometimes|boolean',
        ]);

        $orgId = $request->user()->organization_id;

        $component = SalaryComponent::where('organization_id', $orgId)
            ->findOrFail($id);

        // Don't allow editing system defaults (code/category are locked)
        $component->update($request->only([
            'name', 'category', 'value_type', 'calculation_basis',
            'default_value', 'is_taxable', 'is_compliance_component', 'is_active',
            'allow_employee_override',
        ]));

        return response()->json([
            'success' => true,
            'message' => 'Component updated successfully',
            'component' => $component->fresh(),
        ]);
    }

    /**
     * Delete a salary component (system defaults cannot be deleted).
     */
    public function destroy(Request $request, int $id): JsonResponse
    {
        $orgId = $request->user()->organization_id;

        $component = SalaryComponent::where('organization_id', $orgId)
            ->findOrFail($id);

        if ($component->is_system_default) {
            return response()->json([
                'success' => false,
                'message' => 'Cannot delete system default components.',
            ], 422);
        }

        // Check for dependencies before deleting
        DB::table('salary_template_components')
            ->where('salary_component_id', $id)
            ->delete();

        SalaryFormula::where('salary_component_id', $id)->delete();
        $component->delete();

        return response()->json([
            'success' => true,
            'message' => 'Component deleted successfully',
        ]);
    }

    /**
     * Toggle component active status.
     */
    public function toggle(Request $request, int $id): JsonResponse
    {
        $orgId = $request->user()->organization_id;

        $component = SalaryComponent::where('organization_id', $orgId)
            ->findOrFail($id);

        $component->update(['is_active' => !$component->is_active]);

        return response()->json([
            'success' => true,
            'message' => $component->is_active ? 'Component enabled' : 'Component disabled',
            'component' => $component->fresh(),
        ]);
    }

    /**
     * Save a formula for a component.
     */
    public function saveFormula(Request $request, int $componentId): JsonResponse
    {
        $request->validate([
            'formula_expression' => 'required|string',
            'description'        => 'nullable|string|max:255',
        ]);

        $orgId = $request->user()->organization_id;

        $component = SalaryComponent::where('organization_id', $orgId)
            ->findOrFail($componentId);

        // Validate the formula before saving
        $engine = new SalaryFormulaEngine();
        if (!$engine->validateFormula($request->formula_expression)) {
            return response()->json([
                'success' => false,
                'message' => 'Invalid formula expression. Please check syntax.',
            ], 422);
        }

        $formula = SalaryFormula::updateOrCreate(
            [
                'salary_component_id' => $componentId,
                'organization_id'     => $orgId,
            ],
            [
                'name'              => $component->name . ' Formula',
                'formula_expression' => $request->formula_expression,
                'description'        => $request->description,
                'effective_from'    => now(),
                'is_active'         => true,
            ]
        );

        return response()->json([
            'success' => true,
            'message' => 'Formula saved successfully',
            'formula' => $formula,
            'component' => $component->fresh()->load('formulas'),
        ]);
    }

    /**
     * Delete a formula.
     */
    public function deleteFormula(Request $request, int $componentId, int $formulaId): JsonResponse
    {
        $orgId = $request->user()->organization_id;

        $formula = SalaryFormula::where('organization_id', $orgId)
            ->where('salary_component_id', $componentId)
            ->where('id', $formulaId)
            ->firstOrFail();

        $formula->delete();

        return response()->json([
            'success' => true,
            'message' => 'Formula deleted successfully',
        ]);
    }

    /**
     * Validate a formula expression (dry-run).
     */
    public function validateFormula(Request $request, int $componentId): JsonResponse
    {
        $request->validate([
            'formula_expression' => 'required|string',
        ]);

        $engine = new SalaryFormulaEngine();
        $valid = $engine->validateFormula($request->formula_expression);

        return response()->json([
            'success' => true,
            'valid'   => $valid,
            'message' => $valid ? 'Formula is valid' : 'Invalid formula expression',
        ]);
    }
}
