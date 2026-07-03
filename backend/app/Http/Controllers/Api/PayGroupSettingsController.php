<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PayGroup;
use App\Models\PayGroupFilingDetail;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PayGroupSettingsController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $payGroups = PayGroup::query()
            ->with(['salaryTemplate', 'filingDetails'])
            ->where('organization_id', $user->organization_id)
            ->orderBy('name')
            ->get()
            ->map(function ($pg) {
                return [
                    'id' => $pg->id,
                    'name' => $pg->name,
                    'code' => $pg->code,
                    'description' => $pg->description,
                    'pay_frequency' => $pg->pay_frequency,
                    'pay_day' => $pg->pay_day,
                    'pay_day_type' => $pg->pay_day_type,
                    'salary_template_id' => $pg->salary_template_id,
                    'salary_template' => $pg->salaryTemplate ? [
                        'id' => $pg->salaryTemplate->id,
                        'name' => $pg->salaryTemplate->name,
                    ] : null,
                    'statutory_rules' => $pg->statutory_rules ?? [],
                    'filing_details' => $pg->filingDetails->map(fn ($fd) => [
                        'id' => $fd->id,
                        'state_code' => $fd->state_code,
                        'state_name' => $fd->state_name,
                        'pt_enabled' => $fd->pt_enabled,
                        'pt_establishment_id' => $fd->pt_establishment_id,
                        'pt_registration_date' => $fd->pt_registration_date,
                        'pt_signatory' => $fd->pt_signatory,
                        'lwf_enabled' => $fd->lwf_enabled,
                        'lwf_establishment_id' => $fd->lwf_establishment_id,
                        'lwf_registration_date' => $fd->lwf_registration_date,
                        'lwf_signatory' => $fd->lwf_signatory,
                        'pf_registration_number' => $fd->pf_registration_number,
                        'pf_group_code' => $fd->pf_group_code,
                        'esi_registration_number' => $fd->esi_registration_number,
                    ])->values(),
                    'is_active' => $pg->is_active,
                ];
            });

        return response()->json([
            'success' => true,
            'pay_groups' => $payGroups,
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
            'code' => 'required|string|max:50',
            'description' => 'nullable|string',
            'pay_frequency' => 'required|in:monthly,weekly,biweekly',
            'pay_day' => 'nullable|integer|min:1|max:31',
            'pay_day_type' => 'nullable|in:fixed,last_working,last_day',
            'salary_template_id' => 'nullable|integer|exists:salary_templates,id',
            'statutory_rules' => 'nullable|array',
            'statutory_rules.pf_enabled' => 'nullable|boolean',
            'statutory_rules.esi_enabled' => 'nullable|boolean',
            'statutory_rules.pt_enabled' => 'nullable|boolean',
            'statutory_rules.lwf_enabled' => 'nullable|boolean',
            'statutory_rules.tds_enabled' => 'nullable|boolean',
        ]);

        $existing = PayGroup::where('organization_id', $user->organization_id)
            ->where('code', $validated['code'])
            ->first();

        if ($existing) {
            return response()->json([
                'message' => 'A pay group with this code already exists.',
            ], 422);
        }

        $payGroup = PayGroup::create([
            'organization_id' => $user->organization_id,
            'name' => $validated['name'],
            'code' => $validated['code'],
            'description' => $validated['description'] ?? null,
            'pay_frequency' => $validated['pay_frequency'],
            'pay_day' => $validated['pay_day'] ?? 1,
            'pay_day_type' => $validated['pay_day_type'] ?? 'last_working',
            'salary_template_id' => $validated['salary_template_id'] ?? null,
            'statutory_rules' => $validated['statutory_rules'] ?? [
                'pf_enabled' => true,
                'esi_enabled' => true,
                'pt_enabled' => true,
                'lwf_enabled' => false,
                'tds_enabled' => true,
            ],
            'is_active' => true,
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Pay group created successfully.',
            'pay_group' => $payGroup->load(['salaryTemplate', 'filingDetails']),
        ], 201);
    }

    public function show(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $payGroup = PayGroup::query()
            ->with(['salaryTemplate', 'filingDetails'])
            ->where('organization_id', $user->organization_id)
            ->where('id', $id)
            ->first();

        if (!$payGroup) {
            return response()->json(['message' => 'Pay group not found.'], 404);
        }

        return response()->json([
            'success' => true,
            'pay_group' => [
                'id' => $payGroup->id,
                'name' => $payGroup->name,
                'code' => $payGroup->code,
                'description' => $payGroup->description,
                'pay_frequency' => $payGroup->pay_frequency,
                'pay_day' => $payGroup->pay_day,
                'pay_day_type' => $payGroup->pay_day_type,
                'salary_template_id' => $payGroup->salary_template_id,
                'salary_template' => $payGroup->salaryTemplate ? [
                    'id' => $payGroup->salaryTemplate->id,
                    'name' => $payGroup->salaryTemplate->name,
                ] : null,
                'statutory_rules' => $payGroup->statutory_rules ?? [],
                'filing_details' => $payGroup->filingDetails,
                'is_active' => $payGroup->is_active,
            ],
        ]);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $payGroup = PayGroup::query()
            ->where('organization_id', $user->organization_id)
            ->where('id', $id)
            ->first();

        if (!$payGroup) {
            return response()->json(['message' => 'Pay group not found.'], 404);
        }

        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'code' => 'sometimes|required|string|max:50',
            'description' => 'nullable|string',
            'pay_frequency' => 'sometimes|required|in:monthly,weekly,biweekly',
            'pay_day' => 'nullable|integer|min:1|max:31',
            'pay_day_type' => 'nullable|in:fixed,last_working,last_day',
            'salary_template_id' => 'nullable|integer|exists:salary_templates,id',
            'statutory_rules' => 'nullable|array',
            'statutory_rules.pf_enabled' => 'nullable|boolean',
            'statutory_rules.esi_enabled' => 'nullable|boolean',
            'statutory_rules.pt_enabled' => 'nullable|boolean',
            'statutory_rules.lwf_enabled' => 'nullable|boolean',
            'statutory_rules.tds_enabled' => 'nullable|boolean',
            'is_active' => 'nullable|boolean',
        ]);

        if (isset($validated['code']) && $validated['code'] !== $payGroup->code) {
            $existing = PayGroup::where('organization_id', $user->organization_id)
                ->where('code', $validated['code'])
                ->where('id', '!=', $id)
                ->first();

            if ($existing) {
                return response()->json([
                    'message' => 'A pay group with this code already exists.',
                ], 422);
            }
        }

        $payGroup->update($validated);

        return response()->json([
            'success' => true,
            'message' => 'Pay group updated successfully.',
            'pay_group' => $payGroup->fresh(['salaryTemplate', 'filingDetails']),
        ]);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $payGroup = PayGroup::query()
            ->where('organization_id', $user->organization_id)
            ->where('id', $id)
            ->first();

        if (!$payGroup) {
            return response()->json(['message' => 'Pay group not found.'], 404);
        }

        // Hard-delete the pay group. The database cascade on
        // pay_group_assignments.pay_group_id will automatically remove
        // all assignment rows, freeing those employees to appear in
        // the unassigned-employees list for new pay groups.
        $payGroup->delete();

        return response()->json([
            'success' => true,
            'message' => 'Pay group deleted successfully.',
        ]);
    }

    public function updateFilingDetails(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $payGroup = PayGroup::query()
            ->where('organization_id', $user->organization_id)
            ->where('id', $id)
            ->first();

        if (!$payGroup) {
            return response()->json(['message' => 'Pay group not found.'], 404);
        }

        $validated = $request->validate([
            'filing_details' => 'required|array',
            'filing_details.*.state_code' => 'required|string',
            'filing_details.*.state_name' => 'required|string',
            'filing_details.*.pt_enabled' => 'nullable|boolean',
            'filing_details.*.pt_establishment_id' => 'nullable|string',
            'filing_details.*.pt_registration_date' => 'nullable|date',
            'filing_details.*.pt_signatory' => 'nullable|string',
            'filing_details.*.lwf_enabled' => 'nullable|boolean',
            'filing_details.*.lwf_establishment_id' => 'nullable|string',
            'filing_details.*.lwf_registration_date' => 'nullable|date',
            'filing_details.*.lwf_signatory' => 'nullable|string',
            'filing_details.*.pf_registration_number' => 'nullable|string',
            'filing_details.*.pf_group_code' => 'nullable|string',
            'filing_details.*.esi_registration_number' => 'nullable|string',
        ]);

        DB::transaction(function () use ($payGroup, $validated) {
            foreach ($validated['filing_details'] as $detail) {
                $stateCode = $detail['state_code'];

                $existing = PayGroupFilingDetail::where('pay_group_id', $payGroup->id)
                    ->where('state_code', $stateCode)
                    ->first();

                $data = [
                    'pay_group_id' => $payGroup->id,
                    'state_code' => $stateCode,
                    'state_name' => $detail['state_name'],
                    'pt_enabled' => $detail['pt_enabled'] ?? false,
                    'pt_establishment_id' => $detail['pt_establishment_id'] ?? null,
                    'pt_registration_date' => $detail['pt_registration_date'] ?? null,
                    'pt_signatory' => $detail['pt_signatory'] ?? null,
                    'lwf_enabled' => $detail['lwf_enabled'] ?? false,
                    'lwf_establishment_id' => $detail['lwf_establishment_id'] ?? null,
                    'lwf_registration_date' => $detail['lwf_registration_date'] ?? null,
                    'lwf_signatory' => $detail['lwf_signatory'] ?? null,
                    'pf_registration_number' => $detail['pf_registration_number'] ?? null,
                    'pf_group_code' => $detail['pf_group_code'] ?? null,
                    'esi_registration_number' => $detail['esi_registration_number'] ?? null,
                ];

                if ($existing) {
                    $existing->update($data);
                } else {
                    PayGroupFilingDetail::create($data);
                }
            }
        });

        return response()->json([
            'success' => true,
            'message' => 'Filing details updated successfully.',
            'pay_group' => $payGroup->fresh(['salaryTemplate', 'filingDetails']),
        ]);
    }

    public function updateStatutoryRules(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $payGroup = PayGroup::query()
            ->where('organization_id', $user->organization_id)
            ->where('id', $id)
            ->first();

        if (!$payGroup) {
            return response()->json(['message' => 'Pay group not found.'], 404);
        }

        $validated = $request->validate([
            'pf_enabled' => 'nullable|boolean',
            'esi_enabled' => 'nullable|boolean',
            'pt_enabled' => 'nullable|boolean',
            'lwf_enabled' => 'nullable|boolean',
            'tds_enabled' => 'nullable|boolean',
        ]);

        $currentRules = $payGroup->statutory_rules ?? [
            'pf_enabled' => true,
            'esi_enabled' => true,
            'pt_enabled' => true,
            'lwf_enabled' => false,
            'tds_enabled' => true,
        ];

        $updatedRules = array_merge($currentRules, $validated);

        $payGroup->update(['statutory_rules' => $updatedRules]);

        return response()->json([
            'success' => true,
            'message' => 'Statutory rules updated successfully.',
            'statutory_rules' => $updatedRules,
        ]);
    }
}
