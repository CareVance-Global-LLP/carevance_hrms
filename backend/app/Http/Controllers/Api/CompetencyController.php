<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Competency;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CompetencyController extends Controller
{
    private function isAdmin(Request $request): bool
    {
        $role = $request->user()->role;

        return $role === 'admin' || $role === 'super_admin';
    }

    public function index(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        // First touch seeds the default set so the rating grid always has content
        if (! Competency::where('organization_id', $organizationId)->exists()) {
            Competency::seedDefaults($organizationId);
        }

        $competencies = Competency::where('organization_id', $organizationId)
            ->where('is_active', true)
            ->orderBy('sort_order')
            ->get();

        return response()->json($competencies);
    }

    public function store(Request $request): JsonResponse
    {
        if (! $this->isAdmin($request)) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $data = $request->validate([
            'name' => 'required|string|max:255',
            'description' => 'nullable|string|max:1000',
            'sort_order' => 'nullable|integer|min:0',
        ]);

        $competency = Competency::create([
            ...$data,
            'organization_id' => $request->user()->organization_id,
            'is_active' => true,
        ]);

        return response()->json(['message' => 'Competency created.', 'competency' => $competency], 201);
    }

    public function update(int $id, Request $request): JsonResponse
    {
        if (! $this->isAdmin($request)) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $competency = Competency::where('organization_id', $request->user()->organization_id)->findOrFail($id);

        $data = $request->validate([
            'name' => 'nullable|string|max:255',
            'description' => 'nullable|string|max:1000',
            'sort_order' => 'nullable|integer|min:0',
            'is_active' => 'nullable|boolean',
        ]);

        $competency->update(array_filter($data, fn ($value) => $value !== null));

        return response()->json(['message' => 'Competency updated.', 'competency' => $competency->fresh()]);
    }

    public function destroy(int $id, Request $request): JsonResponse
    {
        if (! $this->isAdmin($request)) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $competency = Competency::where('organization_id', $request->user()->organization_id)->findOrFail($id);

        // Soft-disable so historical review ratings keep their labels
        $competency->update(['is_active' => false]);

        return response()->json(['message' => 'Competency removed.']);
    }
}
