<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\InteractsWithApiResponses;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\Settings\UpdateOrganizationRequest;
use App\Http\Requests\Api\Settings\UpdatePasswordRequest as UpdatePasswordFormRequest;
use App\Http\Requests\Api\Settings\UpdatePreferencesRequest;
use App\Http\Requests\Api\Settings\UpdateProfileRequest;
use App\Services\Audit\AuditLogService;
use App\Services\Billing\WorkspaceBillingService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class SettingsController extends Controller
{
    use InteractsWithApiResponses;

    public function __construct(
        private readonly AuditLogService $auditLogService,
        private readonly WorkspaceBillingService $workspaceBillingService,
    )
    {
    }

    public function me(Request $request)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $user->load('organization');

        return $this->successResponse([
            'user' => $user,
            'organization' => $user->organization,
            'can_manage_org' => $this->canManageOrg($user),
        ]);
    }

    public function updateProfile(UpdateProfileRequest $request)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $validated = $request->validated();

        $profileUpdates = [
            'name' => $validated['name'],
            'avatar' => $validated['avatar'] ?? null,
        ];
        $changedFields = ['name', 'avatar'];

        if ($user->role === 'admin' && array_key_exists('email', $validated)) {
            $profileUpdates['email'] = $validated['email'];
            $changedFields[] = 'email';
        }

        $user->update($profileUpdates);

        $this->auditLogService->log(
            action: 'settings.profile_updated',
            actor: $user,
            target: $user,
            metadata: [
                'changed_fields' => $changedFields,
            ],
            request: $request
        );

        return $this->updatedResponse([
            'message' => 'Profile updated successfully.',
            'user' => $user->fresh(),
        ], 'Profile updated successfully.');
    }

    public function updatePassword(UpdatePasswordFormRequest $request)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $validated = $request->validated();

        if (!Hash::check($validated['current_password'], $user->password)) {
            return response()->json(['message' => 'Current password is incorrect.'], 422);
        }

        $user->update([
            'password' => $validated['new_password'],
        ]);

        $this->auditLogService->log(
            action: 'settings.password_updated',
            actor: $user,
            target: $user,
            metadata: [],
            request: $request
        );

        return $this->updatedResponse([], 'Password updated successfully.');
    }

    public function updatePreferences(UpdatePreferencesRequest $request)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $validated = $request->validated();

        $existing = is_array($user->settings) ? $user->settings : [];
        $user->settings = array_merge($existing, [
            'timezone' => $validated['timezone'] ?? ($existing['timezone'] ?? 'Asia/Kolkata'),
            'notifications' => array_merge(
                [
                    'email' => true,
                    'in_app' => true,
                    'desktop_push' => true,
                    'chat_messages' => true,
                    'weekly_summary' => true,
                    'project_updates' => true,
                    'task_assignments' => true,
                ],
                $existing['notifications'] ?? [],
                $validated['notifications'] ?? []
            ),
        ]);
        $user->save();

        $this->auditLogService->log(
            action: 'settings.preferences_updated',
            actor: $user,
            target: $user,
            metadata: [
                'timezone' => $user->settings['timezone'] ?? 'Asia/Kolkata',
                'notification_keys' => array_keys($user->settings['notifications'] ?? []),
            ],
            request: $request
        );

        return $this->updatedResponse([
            'message' => 'Preferences updated successfully.',
            'settings' => $user->settings,
        ], 'Preferences updated successfully.');
    }

    public function updateOrganization(UpdateOrganizationRequest $request)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }
        if (!$this->canManageOrg($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $organization = $user->organization;
        if (!$organization) {
            return response()->json(['message' => 'Organization not found'], 404);
        }

        $validated = $request->validated();

        $slug = Str::slug($validated['slug']) ?: Str::slug($validated['name']);
        if (!$slug) {
            $slug = 'organization-'.$organization->id;
        }

        $baseSlug = $slug;
        $suffix = 1;
        while (
            \App\Models\Organization::where('slug', $slug)
                ->where('id', '!=', $organization->id)
                ->exists()
        ) {
            $slug = $baseSlug.'-'.$suffix;
            $suffix++;
        }

        $organization->update([
            'name' => $validated['name'],
            'slug' => $slug,
        ]);

        $this->auditLogService->log(
            action: 'settings.organization_updated',
            actor: $user,
            target: $organization,
            metadata: [
                'name' => $organization->name,
                'slug' => $organization->slug,
            ],
            request: $request
        );

        return $this->updatedResponse([
            'message' => 'Organization updated successfully.',
            'organization' => $organization->fresh(),
        ], 'Organization updated successfully.');
    }

    public function billing(Request $request)
    {
        $user = $request->user();
        $user?->load('organization');

        return response()->json(
            $this->workspaceBillingService->snapshot($user?->organization) ?? ['plan' => null, 'workspace' => null]
        );
    }

    private function canManageOrg($user): bool
    {
        return in_array($user->role, ['admin', 'manager'], true);
    }
}
