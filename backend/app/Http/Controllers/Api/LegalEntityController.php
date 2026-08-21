<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\LegalEntity;
use App\Models\User;
use App\Services\PayrollFilingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * The companies inside an organization that actually employ people and file
 * returns.
 *
 * Administrative: an entity's PAN and TAN decide which return every employee
 * under it appears on, so this is not a field an ordinary user edits.
 */
class LegalEntityController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        $entities = LegalEntity::query()
            ->where('organization_id', $user->organization_id)
            ->withCount('users')
            ->orderByDesc('is_primary')
            ->orderBy('name')
            ->get();

        return response()->json([
            'data' => $entities,
            /*
             * Employees with no explicit entity fall back to the primary, so
             * `users_count` alone understates it. The UI needs this number to
             * explain where everybody actually sits.
             */
            'unassigned_count' => User::query()
                ->where('organization_id', $user->organization_id)
                ->whereNull('legal_entity_id')
                ->count(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        $validated = $this->validated($request);

        $entity = DB::transaction(function () use ($user, $validated) {
            $isFirst = ! LegalEntity::query()->where('organization_id', $user->organization_id)->exists();

            // The first entity is primary whether or not it was asked for:
            // no primary means every unassigned employee has no PAN.
            $validated['is_primary'] = $isFirst ? true : (bool) ($validated['is_primary'] ?? false);

            if ($validated['is_primary']) {
                $this->demoteExistingPrimary($user->organization_id);
            }

            return LegalEntity::query()->create($validated + ['organization_id' => $user->organization_id]);
        });

        return response()->json(['data' => $entity], 201);
    }

    public function update(Request $request, LegalEntity $legalEntity): JsonResponse
    {
        if ((int) $legalEntity->organization_id !== (int) $request->user()->organization_id) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        $validated = $this->validated($request, $legalEntity);

        DB::transaction(function () use ($request, $legalEntity, $validated) {
            if (! empty($validated['is_primary']) && ! $legalEntity->is_primary) {
                $this->demoteExistingPrimary($request->user()->organization_id);
            }

            /*
             * The last primary cannot be demoted. Doing so would leave every
             * employee without an explicit entity — which on the day this ships
             * is all of them — resolving to nothing, and their filings falling
             * back to organization settings that may no longer be maintained.
             */
            if ($legalEntity->is_primary && array_key_exists('is_primary', $validated) && ! $validated['is_primary']) {
                unset($validated['is_primary']);
            }

            $legalEntity->update($validated);
        });

        return response()->json(['data' => $legalEntity->fresh()]);
    }

    public function destroy(Request $request, LegalEntity $legalEntity): JsonResponse
    {
        if ((int) $legalEntity->organization_id !== (int) $request->user()->organization_id) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        if ($legalEntity->is_primary) {
            return response()->json([
                'message' => 'The primary entity cannot be deleted. Make another entity primary first.',
            ], 422);
        }

        /*
         * Refuse rather than orphan. Employees would silently fall back to the
         * primary entity and start filing under a different PAN — a change
         * nobody asked for, visible only in next month's return.
         */
        $assigned = User::query()->where('legal_entity_id', $legalEntity->id)->count();
        if ($assigned > 0) {
            return response()->json([
                'message' => "Move the {$assigned} employee(s) assigned to this entity before deleting it.",
            ], 422);
        }

        $legalEntity->delete();

        return response()->json(['message' => 'Entity deleted.']);
    }

    /** Move employees between entities in one call, so a reorganisation is not 200 requests. */
    public function assignEmployees(Request $request, LegalEntity $legalEntity): JsonResponse
    {
        if ((int) $legalEntity->organization_id !== (int) $request->user()->organization_id) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        $validated = $request->validate([
            'user_ids' => 'required|array|min:1',
            'user_ids.*' => 'integer|exists:users,id',
        ]);

        // Scoped to the caller's organization, so an id from another tenant
        // silently matches nothing rather than reassigning somebody else's staff.
        $moved = User::query()
            ->where('organization_id', $request->user()->organization_id)
            ->whereIn('id', $validated['user_ids'])
            ->update(['legal_entity_id' => $legalEntity->id]);

        return response()->json(['message' => "{$moved} employee(s) moved.", 'moved' => $moved]);
    }

    private function demoteExistingPrimary(int $organizationId): void
    {
        LegalEntity::query()
            ->where('organization_id', $organizationId)
            ->where('is_primary', true)
            ->update(['is_primary' => false]);
    }

    /** @return array<string, mixed> */
    private function validated(Request $request, ?LegalEntity $existing = null): array
    {
        return $request->validate([
            'name' => ($existing ? 'sometimes|' : 'required|').'string|max:255',
            'legal_name' => 'nullable|string|max:255',
            // Format enforced here rather than only at filing time: a PAN that
            // is wrong is discovered when EPFO rejects the upload, which is the
            // worst possible moment to find out.
            'pan' => ['nullable', 'string', 'regex:'.PayrollFilingService::PAN_PATTERN],
            'tan' => ['nullable', 'string', 'size:10'],
            'pf_establishment_code' => 'nullable|string|max:30',
            'esi_code' => 'nullable|string|max:30',
            'lwf_code' => 'nullable|string|max:30',
            'cin' => 'nullable|string|max:21',
            'gstin' => 'nullable|string|max:15',
            'address_line' => 'nullable|string|max:255',
            'city' => 'nullable|string|max:120',
            'state' => 'nullable|string|max:120',
            'pincode' => 'nullable|string|max:10',
            'is_primary' => 'sometimes|boolean',
            'is_active' => 'sometimes|boolean',
        ]);
    }
}
