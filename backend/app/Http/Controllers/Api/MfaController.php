<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Audit\AuditLogService;
use App\Services\Security\MfaService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/**
 * Enrolling in, and managing, two-factor authentication.
 *
 * The act of proving a code at sign-in lives in AuthController, because it
 * needs the same token and cookie machinery as an ordinary login. Everything
 * here is done by an already-authenticated user about their own account.
 */
class MfaController extends Controller
{
    public function __construct(
        private readonly MfaService $mfa,
        private readonly AuditLogService $audit,
    ) {
    }

    /**
     * What this account's second factor looks like right now, and whether the
     * user is obliged to set one up.
     */
    public function status(Request $request): JsonResponse
    {
        $user = $request->user();
        $organization = $user->organization;

        return response()->json([
            'success' => true,
            'data' => [
                'enrolled' => $this->mfa->isEnrolled($user),
                'required' => $this->mfa->mustEnrolNow($user),
                'privileged' => $this->mfa->isPrivileged($user),
                'policy' => $this->mfa->policyFor($organization),
                'grace_ends_at' => $this->mfa->graceEndsAt($organization)?->toIso8601String(),
                'unused_recovery_codes' => $this->mfa->unusedRecoveryCodeCount($user),
            ],
        ]);
    }

    /**
     * Produce a secret and the otpauth:// URI to scan.
     *
     * Nothing is enforced until confirm() succeeds — an abandoned setup must
     * never be able to lock anyone out.
     */
    public function begin(Request $request): JsonResponse
    {
        try {
            $payload = $this->mfa->beginEnrolment($request->user());
        } catch (\InvalidArgumentException $e) {
            return $this->refuse($e->getMessage());
        }

        return response()->json([
            'success' => true,
            'message' => 'Scan this in your authenticator app, then enter the code it shows.',
            'data' => $payload,
        ]);
    }

    public function confirm(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'code' => ['required', 'string', 'max:32'],
        ]);

        try {
            $recoveryCodes = $this->mfa->confirmEnrolment($request->user(), $validated['code']);
        } catch (\InvalidArgumentException $e) {
            return $this->refuse($e->getMessage());
        }

        $this->audit->log(
            action: 'auth.mfa_enrolled',
            actor: $request->user(),
            target: $request->user(),
            request: $request,
        );

        return response()->json([
            'success' => true,
            'message' => 'Two-factor authentication is on. Save these recovery codes somewhere safe — they are shown once.',
            'data' => [
                'recovery_codes' => $recoveryCodes,
            ],
        ]);
    }

    /**
     * Issue a fresh set of recovery codes.
     *
     * Requires the password again: someone who walks up to an unlocked laptop
     * should not be able to mint themselves a permanent way back in.
     */
    public function regenerateRecoveryCodes(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'password' => ['required', 'string'],
        ]);

        if (! Hash::check($validated['password'], $request->user()->password)) {
            return $this->refuse('That password is not correct.');
        }

        if (! $this->mfa->isEnrolled($request->user())) {
            return $this->refuse('Two-factor authentication is not switched on for this account.');
        }

        $codes = $this->mfa->regenerateRecoveryCodes($request->user());

        $this->audit->log(
            action: 'auth.mfa_recovery_codes_regenerated',
            actor: $request->user(),
            target: $request->user(),
            request: $request,
        );

        return response()->json([
            'success' => true,
            'message' => 'New recovery codes issued. The previous set no longer works.',
            'data' => ['recovery_codes' => $codes],
        ]);
    }

    /**
     * Switch the second factor off.
     *
     * Both the password and a current code are required. Requiring only one
     * would mean a stolen session, or a stolen password, is enough to remove
     * the control that exists to survive exactly that.
     *
     * Refused outright while the organisation's policy obliges this user to
     * have it — otherwise "turn it off" is a one-request bypass of the whole
     * enforcement.
     */
    public function disable(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'password' => ['required', 'string'],
            'code' => ['required', 'string', 'max:32'],
        ]);

        $user = $request->user();

        if (! Hash::check($validated['password'], $user->password)) {
            return $this->refuse('That password is not correct.');
        }

        if (! $this->mfa->verify($user, $validated['code'])) {
            return $this->refuse('That code is not correct.');
        }

        // mustEnrolNow() answers "would this user be forced to set it up
        // again?" — asked before removing it, that is exactly the question of
        // whether removing it is allowed.
        if ($this->mfa->isPrivileged($user) && $this->mfa->policyFor($user->organization) === 'enforced') {
            return $this->refuse(
                'Your organisation requires two-factor authentication for this role. '
                    .'An administrator must change the policy first.',
                409,
            );
        }

        $this->mfa->disable($user);

        // Every other session of this user's dies with it: leaving them alive
        // means the account is still reachable under the weaker credential the
        // user just decided to stop trusting.
        DB::table('personal_access_tokens')
            ->where('tokenable_type', \App\Models\User::class)
            ->where('tokenable_id', $user->id)
            ->delete();

        $this->audit->log(
            action: 'auth.mfa_disabled',
            actor: $user,
            target: $user,
            request: $request,
        );

        return response()->json([
            'success' => true,
            'message' => 'Two-factor authentication is off. You have been signed out everywhere.',
        ]);
    }

    private function refuse(string $message, int $status = 422): JsonResponse
    {
        return response()->json([
            'success' => false,
            'message' => $message,
            'error_code' => $status === 409 ? 'MFA_REQUIRED_BY_POLICY' : 'MFA_REFUSED',
        ], $status);
    }
}
