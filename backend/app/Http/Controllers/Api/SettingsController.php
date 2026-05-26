<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\InteractsWithApiResponses;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\Settings\UpdateOrganizationRequest;
use App\Http\Requests\Api\Settings\UpdatePasswordRequest as UpdatePasswordFormRequest;
use App\Http\Requests\Api\Settings\UpdatePreferencesRequest;
use App\Http\Requests\Api\Settings\UpdateProfileRequest;
use App\Models\EmployeeProfile;
use App\Models\User;
use App\Services\Audit\AuditLogService;
use App\Services\Billing\WorkspaceBillingService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
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

    public function publicMedia(string $path)
    {
        $normalizedPath = trim($path, '/');

        if ($normalizedPath === '' || str_contains($normalizedPath, '..')) {
            abort(404);
        }

        if (! Str::startsWith($normalizedPath, ['avatars/', 'organizations/', 'selfies/'])) {
            abort(404);
        }

        if (! Storage::disk('public')->exists($normalizedPath)) {
            abort(404);
        }

        $mime = Storage::disk('public')->mimeType($normalizedPath) ?: 'application/octet-stream';

        return response()->file(Storage::disk('public')->path($normalizedPath), [
            'Content-Type' => $mime,
            'Cache-Control' => 'public, max-age=86400',
        ]);
    }

    public function me(Request $request)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $user->load(['organization', 'employeeProfile']);

        return $this->successResponse([
            'user' => $user,
            'organization' => $user->organization,
            'can_manage_org' => $this->canManageOrg($user),
            'employee_profile' => $user->employeeProfile,
            'profile_onboarding_completed' => $this->isProfileOnboardingComplete($user),
            'profile_onboarding_skipped' => $this->isProfileOnboardingSkipped($user),
        ]);
    }

    public function updateOnboardingProfile(Request $request)
    {
        $user = $request->user();
        if (! $user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $validated = $request->validate([
            'first_name' => 'required|string|max:120',
            'last_name' => 'required|string|max:120',
            'display_name' => 'required|string|max:120',
            'gender' => 'required|string|max:32',
            'date_of_birth' => 'required|date',
            'phone' => 'required|string|max:64',
            'personal_email' => 'required|email',
            'address_line' => 'required|string|max:255',
            'city' => 'required|string|max:120',
            'state' => 'required|string|max:120',
            'postal_code' => 'required|string|max:32',
            'emergency_contact_name' => 'required|string|max:120',
            'emergency_contact_number' => 'required|string|max:64',
            'emergency_contact_relationship' => 'required|string|max:120',
        ]);

        $profile = EmployeeProfile::query()->firstOrNew([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
        ]);

        $profile->fill($validated);
        $profile->organization_id = $user->organization_id;
        $profile->user_id = $user->id;
        $profile->save();

        $settings = is_array($user->settings) ? $user->settings : [];
        $settings['profile_onboarding_completed'] = true;
        $settings['profile_onboarding_completed_at'] = now()->toIso8601String();
        $user->settings = $settings;
        $user->save();

        $this->auditLogService->log(
            action: 'settings.profile_onboarding_completed',
            actor: $user,
            target: $user,
            metadata: [
                'changed_fields' => array_keys($validated),
            ],
            request: $request
        );

        return $this->updatedResponse([
            'message' => 'Profile details saved successfully.',
            'user' => $user->fresh(['organization', 'employeeProfile']),
            'employee_profile' => $profile->fresh(),
            'profile_onboarding_completed' => true,
        ], 'Profile details saved successfully.');
    }

    public function skipOnboardingProfile(Request $request)
    {
        $user = $request->user();
        if (! $user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $settings = is_array($user->settings) ? $user->settings : [];
        $settings['profile_onboarding_skipped'] = true;
        $settings['profile_onboarding_skipped_at'] = now()->toIso8601String();
        $user->settings = $settings;
        $user->save();

        $this->auditLogService->log(
            action: 'settings.profile_onboarding_skipped',
            actor: $user,
            target: $user,
            metadata: [],
            request: $request
        );

        return $this->updatedResponse([
            'message' => 'Profile setup skipped for now.',
            'user' => $user->fresh(['organization', 'employeeProfile']),
            'profile_onboarding_skipped' => true,
        ], 'Profile setup skipped for now.');
    }

    public function updateProfile(UpdateProfileRequest $request)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $validated = $request->validated();
        $existingAvatarUrl = $user->avatar;

        $profileUpdates = [
            'name' => $validated['name'],
            'avatar' => $validated['avatar'] ?? null,
        ];
        $changedFields = ['name', 'avatar'];

        if ($request->hasFile('avatar_file')) {
            $avatarPath = $request->file('avatar_file')->store("avatars/{$user->id}", 'public');
            $profileUpdates['avatar'] = '/api/media/public/'.$avatarPath;
            $changedFields[] = 'avatar_file';
            $this->deleteManagedPublicFile($existingAvatarUrl, "avatars/{$user->id}/");
        }

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

        $existingSettings = is_array($organization->settings) ? $organization->settings : [];
        $attendanceSettings = is_array($existingSettings['attendance'] ?? null)
            ? $existingSettings['attendance']
            : [];
        $brandingSettings = is_array($existingSettings['branding'] ?? null)
            ? $existingSettings['branding']
            : [];

        if (array_key_exists('office_start_time', $validated)) {
            $attendanceSettings['office_start_time'] = $validated['office_start_time']
                ? Carbon::parse($validated['office_start_time'])->format('H:i:s')
                : null;
        }

        if (array_key_exists('late_after_time', $validated)) {
            $attendanceSettings['late_after_time'] = $validated['late_after_time']
                ? Carbon::parse($validated['late_after_time'])->format('H:i:s')
                : null;
        }

        if ($request->hasFile('logo_file')) {
            $existingLogoUrl = isset($brandingSettings['logo_url']) ? (string) $brandingSettings['logo_url'] : null;
            $logoPath = $request->file('logo_file')->store("organizations/{$organization->id}/branding", 'public');
            $brandingSettings['logo_url'] = '/api/media/public/'.$logoPath;
            $this->deleteManagedPublicFile($existingLogoUrl, "organizations/{$organization->id}/branding/");
        }

        $leavePolicySettings = is_array($existingSettings['leave_policy'] ?? null)
            ? $existingSettings['leave_policy']
            : [];
        $leaveCategoriesInput = $this->resolveLeaveCategoriesInput($validated);
        if ($leaveCategoriesInput !== null) {
            if ($user->role !== 'admin') {
                return response()->json(['message' => 'Only admins can update leave policy settings.'], 403);
            }

            $leavePolicySettings['categories'] = $this->normalizeLeaveCategories($leaveCategoriesInput);
        }

        $updatedSettings = array_merge($existingSettings, [
            'attendance' => $attendanceSettings,
            'branding' => $brandingSettings,
            'leave_policy' => $leavePolicySettings,
        ]);

        $organization->update([
            'name' => $validated['name'],
            'slug' => $slug,
            'settings' => $updatedSettings,
        ]);

        $this->auditLogService->log(
            action: 'settings.organization_updated',
            actor: $user,
            target: $organization,
            metadata: [
                'name' => $organization->name,
                'slug' => $organization->slug,
                'office_start_time' => $attendanceSettings['office_start_time'] ?? null,
                'late_after_time' => $attendanceSettings['late_after_time'] ?? null,
                'logo_url' => $brandingSettings['logo_url'] ?? null,
                'leave_categories' => $leavePolicySettings['categories'] ?? [],
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

    private function deleteManagedPublicFile(?string $publicUrl, string $expectedPrefix): void
    {
        if (! $publicUrl) {
            return;
        }

        $relativePath = $this->extractManagedPublicRelativePath($publicUrl);
        if (! $relativePath || ! str_starts_with($relativePath, $expectedPrefix)) {
            return;
        }

        if (Storage::disk('public')->exists($relativePath)) {
            Storage::disk('public')->delete($relativePath);
        }
    }

    private function resolveLeaveCategoriesInput(array $validated): ?array
    {
        if (array_key_exists('leave_categories', $validated) && is_array($validated['leave_categories'])) {
            return $validated['leave_categories'];
        }

        $rawJson = trim((string) ($validated['leave_categories_json'] ?? ''));
        if ($rawJson === '') {
            return null;
        }

        $decoded = json_decode($rawJson, true);
        return is_array($decoded) ? $decoded : [];
    }

    private function normalizeLeaveCategories(array $categories): array
    {
        $fallback = [
            ['code' => 'paid', 'name' => 'Paid Leave', 'annual_quota' => 21],
            ['code' => 'sick', 'name' => 'Sick Leave', 'annual_quota' => 12],
            ['code' => 'birthday', 'name' => 'Birthday Leave', 'annual_quota' => 1],
        ];

        $normalized = collect($categories)
            ->map(function ($item) {
                $code = strtolower(trim((string) data_get($item, 'code', '')));
                $name = trim((string) data_get($item, 'name', ''));
                $annualQuota = max(0.0, (float) data_get($item, 'annual_quota', 0));

                if ($code === '' || $name === '' || $code === 'unpaid') {
                    return null;
                }

                $normalizedCode = preg_replace('/[^a-z0-9_\-]/', '', str_replace(' ', '_', $code));
                if (!$normalizedCode) {
                    return null;
                }

                return [
                    'code' => $normalizedCode,
                    'name' => $name,
                    'annual_quota' => round($annualQuota, 2),
                ];
            })
            ->filter()
            ->unique('code')
            ->values();

        return $normalized->isEmpty() ? $fallback : $normalized->all();
    }

    private function extractManagedPublicRelativePath(string $publicUrl): ?string
    {
        $path = (string) parse_url($publicUrl, PHP_URL_PATH);
        if ($path === '' && str_starts_with($publicUrl, '/')) {
            $path = $publicUrl;
        }

        if ($path === '') {
            return null;
        }

        $normalizedPath = ltrim($path, '/');
        if (str_starts_with($normalizedPath, 'storage/')) {
            return substr($normalizedPath, strlen('storage/'));
        }

        $mediaPrefix = 'api/media/public/';
        if (str_starts_with($normalizedPath, $mediaPrefix)) {
            return substr($normalizedPath, strlen($mediaPrefix));
        }

        return null;
    }

    private function canManageOrg($user): bool
    {
        return in_array($user->role, ['admin', 'manager'], true);
    }

    private function isProfileOnboardingComplete(User $user): bool
    {
        $settings = is_array($user->settings) ? $user->settings : [];
        if (! empty($settings['profile_onboarding_completed'])) {
            return true;
        }

        $profile = $user->employeeProfile;
        if (! $profile) {
            return false;
        }

        $requiredFields = [
            'first_name',
            'last_name',
            'display_name',
            'gender',
            'date_of_birth',
            'phone',
            'personal_email',
            'address_line',
            'city',
            'state',
            'postal_code',
            'emergency_contact_name',
            'emergency_contact_number',
            'emergency_contact_relationship',
        ];

        foreach ($requiredFields as $field) {
            $value = data_get($profile, $field);
            if ($value === null || trim((string) $value) === '') {
                return false;
            }
        }

        return true;
    }

    private function isProfileOnboardingSkipped(User $user): bool
    {
        $settings = is_array($user->settings) ? $user->settings : [];

        return ! empty($settings['profile_onboarding_skipped']);
    }
}
