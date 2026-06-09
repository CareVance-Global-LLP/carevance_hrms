<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\InteractsWithApiResponses;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\Auth\LoginRequest;
use App\Http\Requests\Api\Auth\ResendVerificationEmailRequest;
use App\Http\Requests\Api\Auth\SignupOwnerRequest;
use App\Models\Organization;
use App\Models\User;
use App\Services\Auth\ApiTokenService;
use App\Services\Audit\AuditLogService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Cookie;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    use InteractsWithApiResponses;

    public function __construct(
        private readonly AuditLogService $auditLogService,
        private readonly ApiTokenService $apiTokenService,
    )
    {
    }

    public function register(SignupOwnerRequest $request)
    {
        return $this->signupOwner($request);
    }

    public function signupOwner(SignupOwnerRequest $request)
    {
        $validated = $request->validated();
        $organizationName = trim((string) ($validated['company_name'] ?? $validated['organization_name'] ?? ''));
        $signupMode = (string) ($validated['signup_mode'] ?? 'trial');
        $planCode = $signupMode === 'trial' ? 'basic' : (string) ($validated['plan_code'] ?? config('carevance.default_plan', 'basic'));
        $billingCycle = $validated['billing_cycle'] ?? config('carevance.default_billing_cycle', 'monthly');
        $trialDays = max(1, (int) config('carevance.trial_days', 14));
        $seats = $signupMode === 'trial' ? 5 : max(10, (int) ($validated['seats'] ?? 10));

        $result = DB::transaction(function () use ($validated, $organizationName, $planCode, $signupMode, $billingCycle, $trialDays, $seats, $request) {
            $existingUser = User::whereRaw('LOWER(email) = ?', [strtolower($validated['email'])])->first();

            if ($existingUser && $existingUser->organization && $existingUser->organization->subscription_status === 'inactive') {
                $orgId = $existingUser->organization->id;
                $existingUser->organization->delete();
                $existingUser->delete();

                DB::table('personal_access_tokens')->where('tokenable_id', $existingUser->id)->delete();
            } elseif ($existingUser) {
                // Existing user trying to sign up again — check trial abuse
                if ($signupMode === 'trial' && $existingUser->hasConsumedTrial()) {
                    throw ValidationException::withMessages([
                        'email' => ['You have already used your free trial. Please sign in or choose a paid plan.'],
                    ]);
                }
                throw ValidationException::withMessages([
                    'email' => ['This email is already registered. Please sign in or use a different email.'],
                ]);
            }

            $orgSettings = [];
            if (!empty($validated['timezone'])) {
                $orgSettings['timezone'] = $validated['timezone'];
            }

            $organization = Organization::create([
                'name' => $organizationName,
                'slug' => $this->generateUniqueOrganizationSlug($organizationName),
                'description' => $validated['description'] ?? null,
                'website' => $validated['website'] ?? null,
                'industry' => $validated['industry'] ?? null,
                'size' => $validated['size'] ?? null,
                'phone' => $validated['phone'] ?? null,
                'email' => $validated['org_email'] ?? null,
                'address_line' => $validated['address_line'] ?? null,
                'city' => $validated['city'] ?? null,
                'state' => $validated['state'] ?? null,
                'postal_code' => $validated['postal_code'] ?? null,
                'country' => $validated['country'] ?? null,
                'plan_code' => $planCode,
                'billing_cycle' => $billingCycle,
                'subscription_status' => $signupMode === 'paid' ? 'inactive' : 'trial',
                'subscription_intent' => $signupMode === 'paid' ? 'paid' : 'trial',
                'trial_starts_at' => $signupMode === 'trial' ? now() : null,
                'trial_ends_at' => $signupMode === 'trial' ? now()->addDays($trialDays) : null,
                'subscription_expires_at' => $signupMode === 'trial' ? now()->addDays($trialDays)->toDateString() : null,
                'max_seats' => $seats,
                'settings' => !empty($orgSettings) ? $orgSettings : null,
            ]);

            $userSettings = [];
            if (!empty($validated['timezone'])) {
                $userSettings['timezone'] = $validated['timezone'];
            }

            $user = User::create([
                'name' => $validated['name'],
                'email' => $validated['email'],
                'password' => Hash::make($validated['password']),
                'role' => 'admin',
                'organization_id' => $organization->id,
                'settings' => !empty($userSettings) ? $userSettings : null,
            ]);

            // Track trial usage per user (prevents deleting org + re-signup for another trial)
            if ($signupMode === 'trial') {
                $user->markTrialUsed();
            }

            $organization->forceFill([
                'owner_user_id' => $user->id,
            ])->save();

            $user->load(['organization', 'groups', 'employeeProfile']);

            $this->auditLogService->log(
                action: 'auth.owner_signup',
                actor: $user,
                target: $organization,
                metadata: [
                    'plan_code' => $organization->plan_code,
                    'subscription_status' => $organization->subscription_status,
                    'signup_mode' => $signupMode,
                ],
                request: $request
            );

            return compact('user', 'organization');
        });

        $verificationEmailSent = $this->sendVerificationEmailSafely($result['user']);

        return $this->createdResponse([
            'user' => $result['user'],
            'organization' => $result['organization'],
            'requires_verification' => true,
            'email' => $result['user']->email,
            'verification_email_sent' => $verificationEmailSent,
        ], 'Account created successfully. Please verify your email before signing in.');
    }

    public function checkEmail(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
        ]);

        $email = strtolower(trim($request->input('email')));
        $user = User::whereRaw('LOWER(email) = ?', [$email])->first();

        return $this->successResponse([
            'exists' => $user !== null,
            'has_verified_email' => $user ? $user->hasVerifiedEmail() : false,
        ]);
    }

    public function login(LoginRequest $request)
    {
        $email = strtolower(trim((string) $request->input('email')));
        $user = User::whereRaw('LOWER(email) = ?', [$email])->first();

        if (!$user || !Hash::check($request->password, $user->password)) {
            throw ValidationException::withMessages([
                'email' => ['The provided credentials are incorrect.'],
            ]);
        }

        if (! $user->hasVerifiedEmail()) {
            return response()->json([
                'success' => false,
                'message' => 'Please verify your email before signing in.',
                'error_code' => 'EMAIL_NOT_VERIFIED',
                'email' => $user->email,
            ], 403);
        }

        $this->clearLoginRateLimits($request, (string) $user->email);

        $remember = $request->boolean('remember');

        // Clean up orphaned organization reference if org was deleted
        if ($user->organization_id !== null) {
            $user->load('organization');
            if ($user->organization === null) {
                $user->organization_id = null;
                $user->save();
            }
        }

        // Enforce trial expiry: if user's trial has expired, mark org as expired
        if ($user->organization && $user->organization->subscription_status === 'trial' && $user->isTrialExpired()) {
            $user->organization->update([
                'subscription_status' => 'expired',
                'subscription_expires_at' => now()->toDateString(),
            ]);
            $user->organization->refresh();
        }

        if ($request->filled('timezone')) {
            $settings = is_array($user->settings) ? $user->settings : [];
            $settings['timezone'] = $request->input('timezone');
            $user->settings = $settings;
            $user->save();
        }

        // Check if user has an organization
        $user->load('organization');
        
        if (!$user->organization) {
            return $this->errorResponse(
                'You do not have an active workspace. Please sign up to start your free trial.',
                403,
                ['error_code' => 'NO_ORGANIZATION']
            );
        }

        $token = $this->apiTokenService->issue(
            $user,
            'auth-token',
            $this->getApiAuthTokenMinutes($remember)
        );
        $user->load(['organization', 'groups', 'employeeProfile']);

        $this->auditLogService->log(
            action: 'auth.login',
            actor: $user,
            target: $user,
            metadata: [
                'role' => $user->role,
            ],
            request: $request
        );

        return $this->successResponse([
            'user' => [
                ...$user->toArray(),
                'role_name' => $user->customRole?->name ?? ucfirst($user->role ?? 'employee'),
                'hierarchy_level' => $user->getHierarchyLevel(),
            ],
            'token' => $token,
            'organization' => $user->organization,
        ], 'Logged in successfully.')
            ->withCookie($this->makeApiAuthCookie($token, $remember));
    }

    public function requestVerificationEmail(ResendVerificationEmailRequest $request)
    {
        $user = User::query()
            ->whereRaw('LOWER(email) = ?', [strtolower((string) $request->validated('email'))])
            ->first();

        if (! $user) {
            return $this->successResponse([
                'sent' => true,
            ], 'If an account exists for that email, a verification email has been sent.');
        }

        if ($user->hasVerifiedEmail()) {
            return $this->successResponse([
                'already_verified' => true,
            ], 'This email is already verified.');
        }

        $this->sendVerificationEmailSafely($user);

        return $this->successResponse([
            'sent' => true,
        ], 'If an account exists for that email, a verification email has been sent.');
    }

    public function user(Request $request)
    {
        $user = $request->user();

        if (!$user) {
            return response()->json([
                'success' => false,
                'message' => 'Unauthenticated.',
                'error_code' => 'UNAUTHORIZED',
            ], 401);
        }

        $user->load('organization');
        $user->loadMissing(['groups', 'employeeProfile']);

        $data = $user->toArray();
        $data['permissions'] = $this->getUserPermissions($user);
        $data['role_name'] = $user->customRole?->name ?? ucfirst($user->role ?? 'employee');
        $data['hierarchy_level'] = $user->getHierarchyLevel();

        return $this->successResponse($data);
    }

    private function getUserPermissions(\App\Models\User $user): array
    {
        $allPerms = \App\Models\Permission::pluck('key')->all();
        return array_values(array_filter($allPerms, fn($key) => $user->hasPermission($key)));
    }

    public function logout(Request $request)
    {
        $user = $request->user();
        $tokenRecord = $request->attributes->get('access_token');

        if ($tokenRecord && isset($tokenRecord->id)) {
            DB::table('personal_access_tokens')->where('id', $tokenRecord->id)->delete();
        } else {
            $header = (string) $request->header('Authorization', '');
            if (preg_match('/Bearer\s+(.+)/i', $header, $matches)) {
                $plainToken = trim($matches[1]);
                if ($plainToken !== '') {
                    DB::table('personal_access_tokens')
                        ->where('token', hash('sha256', $plainToken))
                        ->delete();
                }
            }
        }

        if ($user) {
            $this->auditLogService->log(
                action: 'auth.logout',
                actor: $user,
                target: $user,
                metadata: [
                    'token_id' => $tokenRecord->id ?? null,
                ],
                request: $request
            );
        }

        return $this->successResponse([], 'Logged out successfully')
            ->withoutCookie(
                $this->getApiAuthCookieName(),
                $this->getApiAuthCookiePath(),
                $this->getApiAuthCookieDomain()
            );
    }

    public function cleanupPendingSignup(Request $request)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['success' => false], 401);
        }

        $organization = $user->organization;
        
        // Only cleanup if status is 'inactive' (paid intent but no payment completed)
        // Do not cleanup 'trial' or 'active' statuses
        if ($organization && $organization->subscription_status === 'inactive') {
            $orgId = $organization->id;
            
            // Delete user
            $user->delete();
            
            // Delete organization if no other users remain
            if (!User::where('organization_id', $orgId)->exists()) {
                $organization->delete();
            }
            
            // Revoke current token
            $tokenRecord = $request->attributes->get('access_token');
            if ($tokenRecord && isset($tokenRecord->id)) {
                DB::table('personal_access_tokens')->where('id', $tokenRecord->id)->delete();
            }
        }
        
        return response()->json(['success' => true]);
    }

    public function handoff(Request $request)
    {
        $user = $request->user();

        if (!$user) {
            return response()->json([
                'success' => false,
                'message' => 'Unauthenticated.',
                'error_code' => 'UNAUTHORIZED',
            ], 401);
        }

        $token = $this->apiTokenService->issue($user, 'web-handoff-token');
        $user->load(['organization', 'groups', 'employeeProfile']);

        return $this->successResponse([
            'user' => $user,
            'token' => $token,
            'organization' => $user->organization,
        ], 'Handoff token issued.')
            ->withCookie($this->makeApiAuthCookie($token));
    }

    public function resendVerificationEmail(Request $request)
    {
        $user = $request->user();

        if (! $user) {
            return response()->json([
                'success' => false,
                'message' => 'Unauthenticated.',
                'error_code' => 'UNAUTHORIZED',
            ], 401);
        }

        if ($user->hasVerifiedEmail()) {
            return $this->successResponse([
                'already_verified' => true,
            ], 'This email is already verified.');
        }

        $this->sendVerificationEmailSafely($user);

        return $this->successResponse([
            'resent' => true,
        ], 'Verification email sent successfully.');
    }

    private function generateUniqueOrganizationSlug(string $organizationName): string
    {
        $baseSlug = Str::slug($organizationName);
        $slug = $baseSlug !== '' ? $baseSlug : 'organization';
        $suffix = 1;

        while (Organization::where('slug', $slug)->exists()) {
            $slug = ($baseSlug !== '' ? $baseSlug : 'organization').'-'.$suffix;
            $suffix++;
        }

        return $slug;
    }

    private function sendVerificationEmailSafely(User $user): bool
    {
        try {
            $user->sendEmailVerificationNotification();

            return true;
        } catch (\Throwable $exception) {
            Log::warning('Verification email dispatch failed.', [
                'user_id' => $user->id,
                'email' => $user->email,
                'exception' => $exception::class,
                'message' => $exception->getMessage(),
            ]);

            return false;
        }
    }

    private function makeApiAuthCookie(string $token, bool $remember = true): Cookie
    {
        return cookie(
            $this->getApiAuthCookieName(),
            $token,
            $remember ? $this->getApiAuthCookieMinutes() : 0,
            $this->getApiAuthCookiePath(),
            $this->getApiAuthCookieDomain(),
            $this->shouldUseSecureApiAuthCookie(),
            true,
            false,
            $this->getApiAuthCookieSameSite()
        );
    }

    private function getApiAuthCookieName(): string
    {
        return (string) config('carevance.auth.api_auth_cookie.name', 'carevance_api_token');
    }

    private function getApiAuthCookieMinutes(): int
    {
        return max(1, (int) config('carevance.auth.api_auth_cookie.minutes', 10080));
    }

    private function getApiAuthTokenMinutes(bool $remember): int
    {
        if ($remember) {
            return (int) config('auth.api_tokens.ttl_minutes', 10080);
        }

        return max(1, (int) config('carevance.auth.api_auth_cookie.session_token_minutes', 720));
    }

    private function getApiAuthCookiePath(): string
    {
        return (string) config('carevance.auth.api_auth_cookie.path', '/');
    }

    private function getApiAuthCookieDomain(): ?string
    {
        $domain = config('carevance.auth.api_auth_cookie.domain');

        return is_string($domain) && $domain !== '' ? $domain : null;
    }

    private function shouldUseSecureApiAuthCookie(): bool
    {
        return (bool) config('carevance.auth.api_auth_cookie.secure', true);
    }

    private function getApiAuthCookieSameSite(): string
    {
        $sameSite = strtolower((string) config('carevance.auth.api_auth_cookie.same_site', 'lax'));

        return in_array($sameSite, ['lax', 'strict', 'none'], true) ? $sameSite : 'lax';
    }

    private function clearLoginRateLimits(Request $request, string $email): void
    {
        $normalizedEmail = Str::lower(trim($email));
        if ($normalizedEmail === '') {
            return;
        }

        $ip = (string) $request->ip();
        $userAgent = Str::lower((string) $request->userAgent());
        $isDesktopClient = str_contains($userAgent, 'electron') || str_contains($userAgent, 'carevance tracker');
        $clientType = $isDesktopClient ? 'desktop' : 'web';
        $clientFingerprint = sha1($userAgent !== '' ? $userAgent : 'unknown-client');

        RateLimiter::clear($normalizedEmail.'|'.$ip.'|'.$clientFingerprint);
        RateLimiter::clear($ip.'|'.$clientType);
    }
}
