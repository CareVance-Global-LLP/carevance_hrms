<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DepartmentPayrollTemplate;
use App\Models\Group;
use App\Services\Payroll\DepartmentTemplateResolver;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class DepartmentPayrollTemplateController extends Controller
{
    public function __construct(private DepartmentTemplateResolver $resolver)
    {
    }

    /**
     * List department templates for the caller's organization.
     */
    public function index(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $templates = DepartmentPayrollTemplate::where('organization_id', $organizationId)
            ->with('department:id,name,slug')
            ->orderBy('department_id')
            ->get();

        $departments = Group::where('organization_id', $organizationId)
            ->where('is_active', true)
            ->orderBy('name')
            ->get(['id', 'name', 'slug']);

        $covered = $templates->pluck('department_id')->all();
        $missing = $departments->reject(fn ($d) => in_array($d->id, $covered, true))->values();

        return response()->json([
            'success' => true,
            'templates' => $templates,
            'departments_without_template' => $missing,
        ]);
    }

    /**
     * Show the template for one department. Returns 200 with the template
     * (which may have all defaults) or 404 if no template exists.
     */
    public function show(Request $request, int $departmentId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $template = DepartmentPayrollTemplate::where('organization_id', $organizationId)
            ->where('department_id', $departmentId)
            ->with('department:id,name,slug')
            ->first();

        if (!$template) {
            return response()->json([
                'success' => false,
                'message' => 'No department template configured. Use store() to create one.',
            ], 404);
        }

        return response()->json([
            'success' => true,
            'template' => $template,
        ]);
    }

    /**
     * Create or update a department template.
     */
    public function upsert(Request $request, int $departmentId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $department = Group::where('organization_id', $organizationId)
            ->where('id', $departmentId)
            ->first();
        if (!$department) {
            return response()->json([
                'success' => false,
                'message' => 'Department not found in your organization.',
            ], 404);
        }

        $validated = $this->validatePayload($request);

        $template = $this->resolver->upsert(
            $organizationId,
            $departmentId,
            $validated,
            $request->user()->id
        );

        return response()->json([
            'success' => true,
            'message' => 'Department template saved.',
            'template' => $template->fresh()->load('department:id,name,slug'),
        ]);
    }

    public function destroy(Request $request, int $departmentId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        $template = DepartmentPayrollTemplate::where('organization_id', $organizationId)
            ->where('department_id', $departmentId)
            ->first();

        if (!$template) {
            return response()->json(['success' => false, 'message' => 'Template not found.'], 404);
        }

        $template->delete();
        return response()->json(['success' => true, 'message' => 'Department template removed.']);
    }

    /**
     * Validate payload; throw ValidationException for any bad input.
     * @return array<string, mixed>
     */
    private function validatePayload(Request $request): array
    {
        $rules = [
            'default_annual_ctc' => 'nullable|numeric|min:0',
            'basic_percentage' => 'nullable|numeric|min:0|max:100',
            'hra_percentage' => 'nullable|numeric|min:0|max:100',
            'da_percentage' => 'nullable|numeric|min:0|max:100',
            'conveyance_allowance' => 'nullable|numeric|min:0',
            'medical_allowance' => 'nullable|numeric|min:0',
            'special_allowance' => 'nullable|numeric|min:0',
            'pf_enabled' => 'nullable|boolean',
            'esi_enabled' => 'nullable|boolean',
            'pt_enabled' => 'nullable|boolean',
            'tds_enabled' => 'nullable|boolean',
            'lwf_enabled' => 'nullable|boolean',
            'nps_enabled' => 'nullable|boolean',
            'vpf_enabled' => 'nullable|boolean',
            'pf_employee_percentage' => 'nullable|numeric|min:0|max:100',
            'pf_employer_percentage' => 'nullable|numeric|min:0|max:100',
            'pf_wage_cap' => 'nullable|numeric|min:0',
            'pf_above_cap' => 'nullable|boolean',
            'esi_employee_percentage' => 'nullable|numeric|min:0|max:100',
            'esi_employer_percentage' => 'nullable|numeric|min:0|max:100',
            'esi_threshold' => 'nullable|numeric|min:0',
            'pt_state' => 'nullable|string|max:64',
            'tax_regime' => 'nullable|in:new,old',
            'is_metro_city' => 'nullable|boolean',
            'component_settings' => 'nullable|array',
            'custom_earnings' => 'nullable|array',
            'custom_deductions' => 'nullable|array',
            'is_active' => 'nullable|boolean',
        ];

        $validator = validator($request->all(), $rules);

        if ($validator->fails()) {
            throw new ValidationException($validator);
        }

        return array_filter(
            $validator->validated(),
            fn ($v) => $v !== null,
        );
    }
}
