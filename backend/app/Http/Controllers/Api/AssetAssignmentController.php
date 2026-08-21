<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Asset;
use App\Models\AssetAssignment;
use App\Models\User;
use App\Services\Organization\EmployeeScopeResolver;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Assigning and returning company assets.
 *
 * `assets.manage` says you may move kit around; EmployeeScopeResolver says
 * WHOSE kit. Without the second question a manager could hand a laptop to
 * anybody in the company — the picker in the UI is already narrowed to their own
 * departments by /api/users, so this only ever mattered to a request made by
 * hand, which is exactly the request that needs defending against.
 */
class AssetAssignmentController extends Controller
{
    public function __construct(
        private readonly EmployeeScopeResolver $scopeResolver,
    ) {
    }

    /** The message is the same either way, so it reveals nothing about who exists. */
    private function outOfScope(): JsonResponse
    {
        return response()->json([
            'message' => 'Forbidden: you can only manage assets for people you administer.',
        ], 403);
    }
    public function assign(Request $request, int $asset): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['message' => 'Organization required'], 422);
        }

        if (!$user->hasPermission('assets.manage')) {
            return response()->json(['message' => 'Forbidden: assets.manage permission required'], 403);
        }

        $validated = $request->validate([
            'user_id' => ['required', 'integer'],
            'assigned_date' => ['nullable', 'date'],
        ]);

        $model = Asset::forOrganization((int) $user->organization_id)->find($asset);
        if (!$model) {
            return response()->json(['message' => 'Asset not found'], 404);
        }

        $employee = User::where('organization_id', $user->organization_id)
            ->where('id', $validated['user_id'])
            ->first();
        if (!$employee) {
            return response()->json(['message' => 'Employee not found in this organization'], 422);
        }

        // An admin reaches everyone; anybody else only their own department, and
        // only people below them. Checked here rather than trusted from the
        // picker, which a hand-made request never goes through.
        if (!$this->scopeResolver->canActOn($user, $employee)) {
            return $this->outOfScope();
        }

        $hasActiveAssignment = AssetAssignment::where('asset_id', $model->id)
            ->whereNull('returned_date')
            ->exists();

        if ($hasActiveAssignment || $model->status === Asset::STATUS_ASSIGNED) {
            return response()->json([
                'message' => 'This asset is already assigned. Return it before assigning again.',
            ], 422);
        }

        $assignment = DB::transaction(function () use ($model, $employee, $user, $validated) {
            $created = AssetAssignment::create([
                'organization_id' => $model->organization_id,
                'asset_id' => $model->id,
                'user_id' => $employee->id,
                'assigned_by' => $user->id,
                'assigned_date' => $validated['assigned_date'] ?? now()->toDateString(),
                'returned_date' => null,
            ]);

            $model->update(['status' => Asset::STATUS_ASSIGNED]);

            return $created;
        });

        $assignment->load(['user:id,name,email']);

        return response()->json([
            'message' => 'Asset assigned successfully',
            'data' => [
                'assignment_id' => $assignment->id,
                'asset_id' => $model->id,
                'status' => Asset::STATUS_ASSIGNED,
                'assigned_to' => [
                    'user_id' => $assignment->user->id,
                    'name' => $assignment->user->name,
                    'email' => $assignment->user->email,
                    'assigned_date' => optional($assignment->assigned_date)->toDateString(),
                ],
            ],
        ], 201);
    }

    public function return(Request $request, int $asset): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['message' => 'Organization required'], 422);
        }

        if (!$user->hasPermission('assets.manage')) {
            return response()->json(['message' => 'Forbidden: assets.manage permission required'], 403);
        }

        $validated = $request->validate([
            'returned_date' => ['nullable', 'date'],
        ]);

        $model = Asset::forOrganization((int) $user->organization_id)->find($asset);
        if (!$model) {
            return response()->json(['message' => 'Asset not found'], 404);
        }

        $assignment = AssetAssignment::where('asset_id', $model->id)
            ->whereNull('returned_date')
            ->latest('id')
            ->first();

        if (!$assignment) {
            return response()->json(['message' => 'This asset has no active assignment to return.'], 422);
        }

        /*
         * The holder decides who may take it back.
         *
         * Scoping the assign but not the return would leave the same hole with
         * one extra step: take the laptop off somebody outside your team, then
         * assign it to yourself.
         */
        $holder = User::find($assignment->user_id);
        if ($holder && !$this->scopeResolver->canActOn($user, $holder)) {
            return $this->outOfScope();
        }

        DB::transaction(function () use ($model, $assignment, $validated) {
            $assignment->update([
                'returned_date' => $validated['returned_date'] ?? now()->toDateString(),
            ]);

            $model->update(['status' => Asset::STATUS_AVAILABLE]);
        });

        return response()->json([
            'message' => 'Asset returned successfully',
            'data' => [
                'asset_id' => $model->id,
                'status' => Asset::STATUS_AVAILABLE,
                'returned_date' => optional($assignment->fresh()->returned_date)->toDateString(),
            ],
        ]);
    }

    public function employeeAssets(Request $request, int $employee): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['data' => []]);
        }

        // Your own kit is never gated — the Settings > Assets tab depends on it.
        $isSelf = (int) $user->id === (int) $employee;
        if (!$isSelf && !$user->hasPermission('assets.view')) {
            return response()->json(['message' => 'Forbidden: assets.view permission required'], 403);
        }

        $target = User::where('organization_id', $user->organization_id)
            ->where('id', $employee)
            ->first();
        if (!$target) {
            return response()->json(['message' => 'Employee not found in this organization'], 404);
        }

        // Same scope as the writes. Narrowing who a manager may assign to while
        // leaving them able to read anybody's inventory would be incoherent.
        if (!$isSelf && !$this->scopeResolver->canActOn($user, $target)) {
            return $this->outOfScope();
        }

        $assignments = AssetAssignment::where('organization_id', $user->organization_id)
            ->where('user_id', $employee)
            ->whereNull('returned_date')
            ->with(['asset:id,asset_tag,name,category,status'])
            ->orderByDesc('assigned_date')
            ->get()
            ->filter(fn (AssetAssignment $assignment) => $assignment->asset !== null)
            ->map(fn (AssetAssignment $assignment) => [
                'assignment_id' => $assignment->id,
                'asset_id' => $assignment->asset->id,
                'asset_tag' => $assignment->asset->asset_tag,
                'name' => $assignment->asset->name,
                'category' => $assignment->asset->category,
                'assigned_date' => optional($assignment->assigned_date)->toDateString(),
            ])
            ->values();

        return response()->json(['data' => $assignments]);
    }
}
