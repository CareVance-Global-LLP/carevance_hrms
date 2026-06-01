<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\GeofenceLog;
use App\Models\GeofenceZone;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class GeofenceController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['data' => []]);
        }

        $zones = GeofenceZone::activeForOrg((int) $user->organization_id)->get();

        return response()->json(['data' => $zones]);
    }

    public function verifyLocation(Request $request): JsonResponse
    {
        $request->validate([
            'latitude' => 'required|numeric|between:-90,90',
            'longitude' => 'required|numeric|between:-180,180',
            'accuracy' => 'nullable|numeric|min:0',
        ]);

        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['inside_zone' => false, 'zone' => null]);
        }

        $zone = GeofenceZone::activeForOrg((int) $user->organization_id)->first();
        if (!$zone) {
            return response()->json(['inside_zone' => true, 'zone' => null]);
        }

        $inside = $zone->isWithinZone(
            (float) $request->latitude,
            (float) $request->longitude
        );

        return response()->json([
            'inside_zone' => $inside,
            'zone' => [
                'id' => $zone->id,
                'name' => $zone->name,
                'latitude' => $zone->latitude,
                'longitude' => $zone->longitude,
                'radius_meters' => $zone->radius_meters,
            ],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'name' => 'required|string|max:255',
            'latitude' => 'required|numeric|between:-90,90',
            'longitude' => 'required|numeric|between:-180,180',
            'radius_meters' => 'required|integer|min:10|max:10000',
            'is_active' => 'nullable|boolean',
        ]);

        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['message' => 'Organization required'], 422);
        }

        if (!$user->hasPermission('geofence.manage')) {
            return response()->json(['message' => 'Forbidden: geofence.manage permission required'], 403);
        }

        $zone = GeofenceZone::create([
            'organization_id' => $user->organization_id,
            'name' => $request->name,
            'latitude' => $request->latitude,
            'longitude' => $request->longitude,
            'radius_meters' => $request->radius_meters,
            'is_active' => $request->boolean('is_active', true),
        ]);

        return response()->json($zone, 201);
    }

    public function update(Request $request, GeofenceZone $zone): JsonResponse
    {
        $user = $request->user();
        if (!$user || (int) $zone->organization_id !== (int) $user->organization_id) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        if (!$user->hasPermission('geofence.manage')) {
            return response()->json(['message' => 'Forbidden: geofence.manage permission required'], 403);
        }

        $request->validate([
            'name' => 'sometimes|string|max:255',
            'latitude' => 'sometimes|numeric|between:-90,90',
            'longitude' => 'sometimes|numeric|between:-180,180',
            'radius_meters' => 'sometimes|integer|min:10|max:10000',
            'is_active' => 'nullable|boolean',
        ]);

        $zone->update($request->only(['name', 'latitude', 'longitude', 'radius_meters', 'is_active']));

        return response()->json($zone);
    }

    public function destroy(Request $request, GeofenceZone $zone): JsonResponse
    {
        $user = $request->user();
        if (!$user || (int) $zone->organization_id !== (int) $user->organization_id) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        if (!$user->hasPermission('geofence.manage')) {
            return response()->json(['message' => 'Forbidden: geofence.manage permission required'], 403);
        }

        $zone->delete();

        return response()->json(['message' => 'Zone deleted']);
    }
}
