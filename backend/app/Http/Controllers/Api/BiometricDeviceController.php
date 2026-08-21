<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\BiometricDevice;
use App\Models\BiometricDeviceUser;
use App\Models\User;
use App\Services\Attendance\BiometricPunchProcessor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Registering punch devices, and saying whose finger is whose.
 *
 * Administrative: a device posts attendance into this tenant, and a mapping
 * decides whose day a reading becomes.
 */
class BiometricDeviceController extends Controller
{
    public function __construct(
        private readonly BiometricPunchProcessor $processor,
    ) {
    }

    public function index(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $devices = BiometricDevice::query()
            ->where('organization_id', $organizationId)
            ->orderBy('name')
            ->get()
            ->map(fn (BiometricDevice $device) => array_merge($device->toArray(), [
                /*
                 * The failure nobody notices: a device that stops talking
                 * produces no attendance, which looks exactly like everybody
                 * being absent. Computed here so the UI does not have to know
                 * what "too long" means.
                 */
                'is_stale' => $device->isStale(),
                // Separate from is_stale on purpose: "never connected" needs a
                // setup instruction, "stopped connecting" needs an alarm.
                'has_ever_reported' => $device->hasEverReported(),
            ]));

        return response()->json([
            'data' => $devices,
            // Per device id rather than a total: "47 unmapped" is not
            // actionable, "id 77 has 47 punches" is.
            'unmapped' => $this->processor->unmappedSummary($organizationId),
            'endpoint' => rtrim(config('app.url'), '/').'/api/iclock',
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            // The device sends this on every request and it is the only thing
            // identifying it, so it must be registered before anything is
            // accepted from it.
            'serial_number' => 'required|string|max:64|unique:biometric_devices,serial_number',
            'name' => 'required|string|max:255',
            'location' => 'nullable|string|max:255',
            'legal_entity_id' => 'nullable|integer|exists:legal_entities,id',
            'vendor' => 'nullable|string|max:32',
        ]);

        $device = BiometricDevice::query()->create($validated + [
            'organization_id' => $request->user()->organization_id,
            'is_active' => true,
        ]);

        return response()->json(['data' => $device], 201);
    }

    public function update(Request $request, BiometricDevice $biometricDevice): JsonResponse
    {
        if ((int) $biometricDevice->organization_id !== (int) $request->user()->organization_id) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        $biometricDevice->update($request->validate([
            'name' => 'sometimes|string|max:255',
            'location' => 'nullable|string|max:255',
            'legal_entity_id' => 'nullable|integer|exists:legal_entities,id',
            'is_active' => 'sometimes|boolean',
        ]));

        return response()->json(['data' => $biometricDevice->fresh()]);
    }

    /**
     * Claim a device id for a person.
     *
     * The punches already collected under that id are left alone rather than
     * rewritten: the processor picks them up on its next run, so a late mapping
     * recovers somebody's history instead of losing it.
     */
    public function claim(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'device_user_id' => 'required|string|max:64',
            'user_id' => 'required|integer|exists:users,id',
        ]);

        $organizationId = $request->user()->organization_id;

        // Scoped, so an id from another tenant matches nothing rather than
        // attaching somebody else's staff to this organization's punches.
        $subject = User::query()
            ->where('organization_id', $organizationId)
            ->find($validated['user_id']);

        if (! $subject) {
            return response()->json(['message' => 'That employee is not in this workspace.'], 422);
        }

        $mapping = BiometricDeviceUser::query()->updateOrCreate(
            ['organization_id' => $organizationId, 'device_user_id' => $validated['device_user_id']],
            ['user_id' => $subject->id],
        );

        // Attach the backlog so the next processor run turns it into attendance.
        $updated = \App\Models\BiometricPunch::query()
            ->where('organization_id', $organizationId)
            ->where('device_user_id', $validated['device_user_id'])
            ->whereNull('user_id')
            ->update(['user_id' => $subject->id]);

        return response()->json([
            'data' => $mapping,
            'message' => $updated > 0
                ? "{$updated} earlier punch(es) will become attendance on the next run."
                : 'Mapping saved.',
        ]);
    }
}
