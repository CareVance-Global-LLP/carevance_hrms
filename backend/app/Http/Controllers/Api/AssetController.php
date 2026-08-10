<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Asset;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AssetController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['data' => []]);
        }

        if (!$user->hasPermission('assets.view')) {
            return response()->json(['message' => 'Forbidden: assets.view permission required'], 403);
        }

        $request->validate([
            'status' => ['nullable', Rule::in([Asset::STATUS_AVAILABLE, Asset::STATUS_ASSIGNED])],
            'category' => ['nullable', 'string', 'max:255'],
            'search' => ['nullable', 'string', 'max:255'],
            'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:200'],
        ]);

        // Every category the organization owns, independent of the filters
        // applied below. The client used to derive its dropdown options from
        // the rows it had just filtered, so picking "Laptop" left "Laptop" as
        // the only option and there was no way back without clearing.
        $categories = Asset::forOrganization((int) $user->organization_id)
            ->select('category')
            ->distinct()
            ->orderBy('category')
            ->pluck('category')
            ->filter()
            ->values();

        $query = Asset::forOrganization((int) $user->organization_id)
            ->with(['currentAssignment.user:id,name,email'])
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->when($request->filled('category'), fn ($q) => $q->where('category', $request->string('category')))
            ->when($request->filled('search'), function ($q) use ($request) {
                $term = '%' . $request->string('search') . '%';
                $q->where(function ($inner) use ($term) {
                    $inner->where('asset_tag', 'like', $term)
                        ->orWhere('name', 'like', $term)
                        ->orWhere('serial_number', 'like', $term);
                });
            })
            ->orderByDesc('created_at');

        // Paginated — this used to return every asset an organization owned in
        // one response, and the page rendered all of them.
        $perPage = (int) ($request->integer('per_page') ?: 25);
        $page = max(1, (int) $request->integer('page', 1));
        $paginator = $query->paginate($perPage, ['*'], 'page', $page);

        return response()->json([
            'data' => collect($paginator->items())->map(fn (Asset $asset) => $this->transformAsset($asset))->values(),
            'categories' => $categories,
            'meta' => [
                'current_page' => $paginator->currentPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
                'last_page' => $paginator->lastPage(),
            ],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['message' => 'Organization required'], 422);
        }

        if (!$user->hasPermission('assets.manage')) {
            return response()->json(['message' => 'Forbidden: assets.manage permission required'], 403);
        }

        $validated = $request->validate([
            'asset_tag' => [
                'required', 'string', 'max:255',
                Rule::unique('assets', 'asset_tag')
                    ->where(fn ($query) => $query->where('organization_id', $user->organization_id)->whereNull('deleted_at')),
            ],
            'name' => ['required', 'string', 'max:255'],
            'category' => ['required', 'string', 'max:255'],
            'serial_number' => ['nullable', 'string', 'max:255'],
            'purchase_date' => ['nullable', 'date'],
        ]);

        $asset = Asset::create([
            'organization_id' => $user->organization_id,
            'asset_tag' => $validated['asset_tag'],
            'name' => $validated['name'],
            'category' => $validated['category'],
            'serial_number' => $validated['serial_number'] ?? null,
            'purchase_date' => $validated['purchase_date'] ?? null,
            'status' => Asset::STATUS_AVAILABLE,
        ]);

        return response()->json(['data' => $this->transformAsset($asset->fresh(['currentAssignment.user:id,name,email']))], 201);
    }

    public function show(Request $request, int $asset): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['message' => 'Organization required'], 422);
        }

        if (!$user->hasPermission('assets.view')) {
            return response()->json(['message' => 'Forbidden: assets.view permission required'], 403);
        }

        $model = Asset::forOrganization((int) $user->organization_id)
            ->with([
                'currentAssignment.user:id,name,email',
                'assignments' => fn ($q) => $q->orderByDesc('assigned_date')->orderByDesc('id'),
                'assignments.user:id,name,email',
                'assignments.assignedBy:id,name,email',
            ])
            ->find($asset);

        if (!$model) {
            return response()->json(['message' => 'Asset not found'], 404);
        }

        $data = $this->transformAsset($model);
        $data['history'] = $model->assignments->map(fn ($assignment) => $this->transformAssignment($assignment))->values();

        return response()->json(['data' => $data]);
    }

    public function update(Request $request, int $asset): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['message' => 'Organization required'], 422);
        }

        if (!$user->hasPermission('assets.manage')) {
            return response()->json(['message' => 'Forbidden: assets.manage permission required'], 403);
        }

        $model = Asset::forOrganization((int) $user->organization_id)->find($asset);
        if (!$model) {
            return response()->json(['message' => 'Asset not found'], 404);
        }

        $validated = $request->validate([
            'asset_tag' => [
                'sometimes', 'required', 'string', 'max:255',
                Rule::unique('assets', 'asset_tag')
                    ->where(fn ($query) => $query->where('organization_id', $user->organization_id)->whereNull('deleted_at'))
                    ->ignore($model->id),
            ],
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'category' => ['sometimes', 'required', 'string', 'max:255'],
            'serial_number' => ['nullable', 'string', 'max:255'],
            'purchase_date' => ['nullable', 'date'],
        ]);

        $model->update($validated);

        return response()->json(['data' => $this->transformAsset($model->fresh(['currentAssignment.user:id,name,email']))]);
    }

    public function destroy(Request $request, int $asset): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['message' => 'Organization required'], 422);
        }

        if (!$user->hasPermission('assets.manage')) {
            return response()->json(['message' => 'Forbidden: assets.manage permission required'], 403);
        }

        $model = Asset::forOrganization((int) $user->organization_id)->find($asset);
        if (!$model) {
            return response()->json(['message' => 'Asset not found'], 404);
        }

        $model->delete();

        return response()->json(['message' => 'Asset archived']);
    }

    private function transformAsset(Asset $asset): array
    {
        $current = $asset->relationLoaded('currentAssignment') ? $asset->currentAssignment : null;

        return [
            'id' => $asset->id,
            'asset_tag' => $asset->asset_tag,
            'name' => $asset->name,
            'category' => $asset->category,
            'serial_number' => $asset->serial_number,
            'status' => $asset->status,
            'purchase_date' => optional($asset->purchase_date)->toDateString(),
            'created_at' => optional($asset->created_at)->toIso8601String(),
            'assigned_to' => $current && $current->user ? [
                'assignment_id' => $current->id,
                'user_id' => $current->user->id,
                'name' => $current->user->name,
                'email' => $current->user->email,
                'assigned_date' => optional($current->assigned_date)->toDateString(),
            ] : null,
        ];
    }

    private function transformAssignment(\App\Models\AssetAssignment $assignment): array
    {
        return [
            'id' => $assignment->id,
            'user' => $assignment->user ? [
                'id' => $assignment->user->id,
                'name' => $assignment->user->name,
                'email' => $assignment->user->email,
            ] : null,
            'assigned_by' => $assignment->assignedBy ? [
                'id' => $assignment->assignedBy->id,
                'name' => $assignment->assignedBy->name,
            ] : null,
            'assigned_date' => optional($assignment->assigned_date)->toDateString(),
            'returned_date' => optional($assignment->returned_date)->toDateString(),
            'is_active' => $assignment->returned_date === null,
        ];
    }
}
