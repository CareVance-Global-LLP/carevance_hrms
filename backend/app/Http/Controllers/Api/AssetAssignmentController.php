<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Asset;
use App\Models\AssetAssignment;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AssetAssignmentController extends Controller
{
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

        $isSelf = (int) $user->id === (int) $employee;
        if (!$isSelf && !$user->hasPermission('assets.view')) {
            return response()->json(['message' => 'Forbidden: assets.view permission required'], 403);
        }

        $targetExists = User::where('organization_id', $user->organization_id)
            ->where('id', $employee)
            ->exists();
        if (!$targetExists) {
            return response()->json(['message' => 'Employee not found in this organization'], 404);
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
