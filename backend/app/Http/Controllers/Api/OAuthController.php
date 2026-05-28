<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Organization;
use App\Models\User;
use App\Services\Auth\ApiTokenService;
use Firebase\JWT\JWT;
use Firebase\JWT\JWK;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class OAuthController extends Controller
{
    public function __construct(
        private readonly ApiTokenService $apiTokenService,
    ) {
    }

    /**
     * Verify Google ID token and authenticate user
     */
    public function verifyGoogleToken(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'credential' => 'required|string',
            'timezone' => ['nullable', 'string', 'max:255', 'regex:/^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+)+$/'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'message' => 'Invalid request parameters',
                'errors' => $validator->errors(),
            ], 422);
        }

        $idToken = $request->input('credential');

        try {
            // Get Google's public keys
            $httpOptions = [];
            
            // For local development on Windows, disable SSL verification
            // This is only for development and should NOT be used in production
            if (app()->environment('local') && strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
                $httpOptions['verify'] = false;
            }
            
            $googleKeys = Http::withOptions($httpOptions)->get('https://www.googleapis.com/oauth2/v3/certs')->json();
            $keys = JWK::parseKeySet($googleKeys);

            // Decode and verify the token
            $decoded = JWT::decode($idToken, $keys);

            // Verify the token is from our app
            if ($decoded->aud !== config('services.google.client_id')) {
                return response()->json([
                    'success' => false,
                    'message' => 'Invalid token audience',
                ], 401);
            }

            // Verify issuer
            if ($decoded->iss !== 'https://accounts.google.com' && $decoded->iss !== 'accounts.google.com') {
                return response()->json([
                    'success' => false,
                    'message' => 'Invalid token issuer',
                ], 401);
            }

            // Check if token is expired
            if ($decoded->exp < time()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Token has expired',
                ], 401);
            }

            // Extract user info from token
            $googleId = $decoded->sub;
            $email = $decoded->email;
            $name = $decoded->name ?? $decoded->given_name . ' ' . ($decoded->family_name ?? '');

            // Find or create user
            $user = User::where('email', $email)->first();

            if ($user) {
                // Existing user - link google_id and load org
                $user = $this->handleExistingUser($user, $googleId);

                // Save timezone if provided
                if ($request->filled('timezone')) {
                    $settings = is_array($user->settings) ? $user->settings : [];
                    $settings['timezone'] = $request->input('timezone');
                    $user->settings = $settings;
                    $user->save();
                }
                $hasWorkspace = $user->organization_id !== null && $user->organization !== null;

                // Clean up orphaned organization reference if org was deleted
                if ($user->organization_id !== null && $user->organization === null) {
                    $user->organization_id = null;
                    $user->save();
                    $hasWorkspace = false;
                }

                // Enforce trial expiry: if user's trial has expired, mark org as expired
                if ($user->organization && $user->organization->subscription_status === 'trial' && $user->isTrialExpired()) {
                    $user->organization->update([
                        'subscription_status' => 'expired',
                        'subscription_expires_at' => now()->toDateString(),
                    ]);
                    $user->organization->refresh();
                }
            } else {
                // New user - create pending user
                $user = $this->createPendingUser([
                    'id' => $googleId,
                    'name' => $name,
                    'email' => $email,
                    'timezone' => $request->input('timezone'),
                ]);
                $hasWorkspace = false;
            }

            $token = $this->apiTokenService->issue($user, 'google-auth-token');

            $user->load(['organization']);

            return response()->json([
                'success' => true,
                'token' => $token,
                'user' => [
                    'id' => $user->id,
                    'name' => $user->name,
                    'email' => $user->email,
                    'role' => $user->role,
                    'organization_id' => $user->organization_id,
                    'email_verified' => (bool) $user->email_verified_at,
                ],
                'organization' => $user->organization,
                'has_workspace' => $hasWorkspace,
                'google_data' => ! $hasWorkspace ? [
                    'name' => $name,
                    'email' => $email,
                ] : null,
            ]);

        } catch (\Firebase\JWT\ExpiredException $e) {
            return response()->json([
                'success' => false,
                'message' => 'Token has expired',
            ], 401);
        } catch (\Firebase\JWT\SignatureInvalidException $e) {
            return response()->json([
                'success' => false,
                'message' => 'Invalid token signature',
            ], 401);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Google authentication failed: ' . $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Handle existing user - link google_id and return user with existing org
     */
    private function handleExistingUser(User $user, string $googleId): User
    {
        if (! $user->google_id) {
            $user->google_id = $googleId;
            $user->save();
        }

        return $user->fresh(['organization']);
    }

    /**
     * Create pending user for new signup
     */
    private function createPendingUser(array $googleUser): User
    {
        $settings = null;
        if (!empty($googleUser['timezone'])) {
            $settings = ['timezone' => $googleUser['timezone']];
        }

        return User::create([
            'name' => $googleUser['name'],
            'email' => $googleUser['email'],
            'google_id' => $googleUser['id'],
            'role' => 'admin',
            'email_verified_at' => now(), // Email already verified by Google
            'password' => Hash::make(Str::random(32)), // Random password
            'organization_id' => null, // Will be set after completion
            'settings' => $settings,
        ]);
    }

    /**
     * Complete registration for new Google users
     */
    public function completeRegistration(Request $request): JsonResponse
    {
        $user = $request->user();

        if (! $user) {
            \Log::error('Google completeRegistration: No authenticated user', [
                'authorization_header' => $request->header('Authorization'),
                'ip' => $request->ip(),
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Unauthenticated.',
                'error_code' => 'UNAUTHORIZED',
            ], 401);
        }
        
        \Log::info('Google completeRegistration: User authenticated', ['user_id' => $user->id]);

        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:255',
            'company_name' => 'required|string|max:255',
            'company_description' => 'nullable|string|max:1000',
            'plan_code' => 'nullable|string|max:50',
            'billing_cycle' => 'nullable|string|in:monthly,yearly',
            'seats' => 'nullable|integer|min:1',
            'signup_mode' => 'nullable|string|in:trial,paid',
            'description' => 'nullable|string|max:1000',
            'website' => 'nullable|string|max:255',
            'industry' => 'nullable|string|max:100',
            'size' => 'nullable|string|max:50',
            'phone' => 'nullable|string|max:50',
            'org_email' => 'nullable|email|max:255',
            'address_line' => 'nullable|string|max:255',
            'city' => 'nullable|string|max:100',
            'state' => 'nullable|string|max:100',
            'postal_code' => 'nullable|string|max:20',
            'country' => 'nullable|string|max:100',
            'timezone' => ['nullable', 'string', 'max:255', 'regex:/^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+)+$/'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $validator->errors(),
            ], 422);
        }

        try {
            return DB::transaction(function () use ($user, $request) {
                // Update user name
                $user->name = $request->input('name');
                $user->save();

                $signupMode = (string) ($request->input('signup_mode') ?? 'trial');

                // Prevent trial abuse: one free trial per user forever
                if ($signupMode === 'trial' && $user->hasConsumedTrial()) {
                    throw ValidationException::withMessages([
                        'signup_mode' => ['You have already used your free trial. Please choose a paid plan.'],
                    ]);
                }

                $planCode = $signupMode === 'trial' ? 'basic' : ((string) ($request->input('plan_code') ?? config('carevance.default_plan', 'basic')));
                $billingCycle = (string) ($request->input('billing_cycle') ?? config('carevance.default_billing_cycle', 'monthly'));
                $seats = $signupMode === 'trial' ? 5 : max(10, (int) ($request->input('seats') ?? 10));
                $trialDays = max(1, (int) config('carevance.trial_days', 14));

                $orgTimezone = $request->input('timezone');
                if ($orgTimezone) {
                    $userSettings = is_array($user->settings) ? $user->settings : [];
                    $userSettings['timezone'] = $orgTimezone;
                    $user->settings = $userSettings;
                    $user->save();
                }

                $organizationData = [
                    'name' => $request->input('company_name'),
                    'slug' => $this->generateUniqueOrganizationSlug($request->input('company_name')),
                    'description' => $request->input('company_description') ?? $request->input('description'),
                    'website' => $request->input('website'),
                    'industry' => $request->input('industry'),
                    'size' => $request->input('size'),
                    'phone' => $request->input('phone'),
                    'email' => $request->input('org_email'),
                    'address_line' => $request->input('address_line'),
                    'city' => $request->input('city'),
                    'state' => $request->input('state'),
                    'postal_code' => $request->input('postal_code'),
                    'country' => $request->input('country'),
                    'owner_user_id' => $user->id,
                    'plan_code' => $planCode,
                    'billing_cycle' => $billingCycle,
                    'subscription_status' => $signupMode === 'paid' ? 'inactive' : 'trial',
                    'subscription_intent' => $signupMode === 'paid' ? 'paid' : 'trial',
                    'trial_starts_at' => $signupMode === 'trial' ? now() : null,
                    'trial_ends_at' => $signupMode === 'trial' ? now()->addDays($trialDays) : null,
                    'subscription_expires_at' => $signupMode === 'trial' ? now()->addDays($trialDays)->toDateString() : null,
                    'max_seats' => $seats,
                    'settings' => $orgTimezone ? ['timezone' => $orgTimezone] : null,
                    'pending_plan_code' => null,
                    'pending_billing_cycle' => null,
                    'pending_seats' => null,
                    'pending_upgrade_amount' => null,
                ];

                $organization = null;
                if ($user->organization_id) {
                    $existingOrganization = Organization::find($user->organization_id);
                    if ($existingOrganization && $existingOrganization->subscription_status === 'inactive') {
                        $existingOrganization->fill($organizationData);
                        $existingOrganization->save();
                        $organization = $existingOrganization;
                    }
                }

                if (! $organization) {
                    $organization = Organization::create($organizationData);
                }

                // Update user with organization
                $user->organization_id = $organization->id;
                $user->save();

                // Track trial usage per user (prevents deleting org + re-signup for another trial)
                if ($signupMode === 'trial') {
                    $user->markTrialUsed();
                }

                // Get fresh token
                $token = $this->apiTokenService->issue($user, 'google-auth-completed');

                $user->load('organization');

                return response()->json([
                    'success' => true,
                    'token' => $token,
                    'user' => [
                        'id' => $user->id,
                        'name' => $user->name,
                        'email' => $user->email,
                        'role' => $user->role,
                        'organization_id' => $organization->id,
                        'email_verified' => true,
                    ],
                    'organization' => [
                        'id' => $organization->id,
                        'name' => $organization->name,
                        'slug' => $organization->slug,
                        'plan_code' => $organization->plan_code,
                        'billing_cycle' => $organization->billing_cycle,
                        'subscription_status' => $organization->subscription_status,
                        'subscription_intent' => $organization->subscription_intent,
                        'trial_starts_at' => $organization->trial_starts_at?->toDateTimeString(),
                        'trial_ends_at' => $organization->trial_ends_at?->toDateTimeString(),
                        'subscription_expires_at' => $organization->subscription_expires_at,
                        'max_seats' => $organization->max_seats,
                        'owner_user_id' => $organization->owner_user_id,
                    ],
                ]);
            });
        } catch (\Exception $e) {
            \Log::error('Google completeRegistration failed', [
                'user_id' => $user->id,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to complete registration: ' . $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Generate unique slug for organization
     */
    private function generateUniqueOrganizationSlug(string $name): string
    {
        $baseSlug = Str::slug($name);
        $slug = $baseSlug !== '' ? $baseSlug : 'organization';
        $suffix = 1;

        while (Organization::where('slug', $slug)->exists()) {
            $slug = ($baseSlug !== '' ? $baseSlug : 'organization').'-'.$suffix;
            $suffix++;
        }

        return $slug;
    }
}
