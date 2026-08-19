<?php

namespace App\Services\Security;

use App\Models\Organization;
use App\Models\User;
use App\Models\UserMfaSecret;
use App\Models\UserRecoveryCode;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use PragmaRX\Google2FA\Google2FA;

/**
 * Time-based one-time passwords.
 *
 * The product had no second factor of any kind — a search of the application,
 * config, routes and every migration for two_factor, totp, mfa, saml or scim
 * returned nothing. A single leaked password therefore exposed the salary,
 * PAN, Aadhaar and bank details of every employee in the tenant.
 *
 * Two decisions here are worth stating, because both are the difference
 * between a control and a liability:
 *
 *  - Enrolment is available to everyone from day one, but enforcement bites
 *    only for privileged roles and only after a grace window. Turning MFA on
 *    hard, on deploy day, is how a live tenant's only owner gets locked out of
 *    their own payroll on the 28th of the month.
 *
 *  - Recovery codes are mandatory, generated at confirmation, shown once. TOTP
 *    without them is a way to permanently lose an account to a broken phone.
 */
class MfaService
{
    /** How many recovery codes are issued at enrolment. */
    public const RECOVERY_CODE_COUNT = 10;

    /**
     * Clock drift tolerance, in 30-second steps either side.
     *
     * One step. Google Authenticator and Authy both allow this, and widening
     * it multiplies the number of codes valid at any instant.
     */
    private const WINDOW = 1;

    /** Default days a tenant has to enrol before enforcement begins. */
    public const DEFAULT_GRACE_DAYS = 14;

    public function __construct(private readonly Google2FA $google2fa)
    {
    }

    // -------------------------------------------------------------- enrolment

    /**
     * Start enrolment. Produces a secret and the otpauth:// URI an
     * authenticator app scans.
     *
     * Calling this again before confirmation deliberately replaces the secret:
     * a user who abandoned a half-finished setup and started over should not
     * be validated against the abandoned one.
     *
     * @return array{secret: string, otpauth_url: string}
     */
    public function beginEnrolment(User $user): array
    {
        $existing = UserMfaSecret::where('user_id', $user->id)->first();

        if ($existing?->isConfirmed()) {
            throw new \InvalidArgumentException(
                'Two-factor authentication is already switched on for this account.'
            );
        }

        $secret = $this->google2fa->generateSecretKey();

        UserMfaSecret::updateOrCreate(
            ['user_id' => $user->id],
            [
                'secret' => $secret,
                'confirmed_at' => null,
                'last_used_timestamp' => null,
            ],
        );

        return [
            'secret' => $secret,
            'otpauth_url' => $this->google2fa->getQRCodeUrl(
                config('app.name', 'CareVance'),
                $user->email,
                $secret,
            ),
        ];
    }

    /**
     * Finish enrolment by proving the authenticator works.
     *
     * @return array<int, string> the recovery codes, in the clear, once
     */
    public function confirmEnrolment(User $user, string $code): array
    {
        $record = UserMfaSecret::where('user_id', $user->id)->first();

        if (! $record) {
            throw new \InvalidArgumentException('Start two-factor setup before confirming it.');
        }

        if ($record->isConfirmed()) {
            throw new \InvalidArgumentException('Two-factor authentication is already switched on.');
        }

        if (! $this->checkTotp($record, $code)) {
            throw new \InvalidArgumentException('That code is not correct. Check the app and try again.');
        }

        $record->forceFill(['confirmed_at' => now()])->save();

        return $this->regenerateRecoveryCodes($user);
    }

    /**
     * Issue a fresh set of recovery codes, invalidating any previous set.
     *
     * @return array<int, string>
     */
    public function regenerateRecoveryCodes(User $user): array
    {
        UserRecoveryCode::where('user_id', $user->id)->delete();

        $codes = [];

        for ($i = 0; $i < self::RECOVERY_CODE_COUNT; $i++) {
            // Grouped for legibility — people copy these onto paper.
            $code = strtoupper(Str::random(5).'-'.Str::random(5));
            $codes[] = $code;

            UserRecoveryCode::create([
                'user_id' => $user->id,
                'code_hash' => Hash::make($code),
            ]);
        }

        return $codes;
    }

    public function disable(User $user): void
    {
        UserMfaSecret::where('user_id', $user->id)->delete();
        UserRecoveryCode::where('user_id', $user->id)->delete();
    }

    public function isEnrolled(User $user): bool
    {
        return UserMfaSecret::where('user_id', $user->id)
            ->whereNotNull('confirmed_at')
            ->exists();
    }

    public function unusedRecoveryCodeCount(User $user): int
    {
        return UserRecoveryCode::where('user_id', $user->id)->whereNull('used_at')->count();
    }

    // ---------------------------------------------------------- verification

    /**
     * Accept either a TOTP code or an unused recovery code.
     *
     * Recovery codes are checked only after TOTP fails, so a six-digit string
     * never accidentally burns one.
     */
    public function verify(User $user, string $code): bool
    {
        $code = trim($code);

        if ($code === '') {
            return false;
        }

        $record = UserMfaSecret::where('user_id', $user->id)
            ->whereNotNull('confirmed_at')
            ->first();

        if ($record && $this->checkTotp($record, $code)) {
            return true;
        }

        return $this->consumeRecoveryCode($user, $code);
    }

    /**
     * Verify a TOTP code and refuse a replay of one already accepted.
     *
     * The `?? 0` is load-bearing, not defensive. google2fa's findValidOTP
     * returns bare `true` when the old timestamp it is given is null, and only
     * returns the matched timestamp when it is given one — so passing null on
     * the first verification means nothing is ever recorded, and the replay
     * guard silently never arms. Zero is a valid floor: makeStartingTimestamp
     * takes max(now - window, oldTimestamp + 1), so it cannot widen the
     * accepted range.
     *
     * Without this, a code read over someone's shoulder stays usable for the
     * rest of its 30-second window.
     */
    private function checkTotp(UserMfaSecret $record, string $code): bool
    {
        $timestamp = $this->google2fa->verifyKeyNewer(
            (string) $record->secret,
            $code,
            $record->last_used_timestamp ?? 0,
            self::WINDOW,
        );

        if ($timestamp === false) {
            return false;
        }

        $record->forceFill([
            'last_used_timestamp' => (int) $timestamp,
            'last_used_at' => now(),
        ])->save();

        return true;
    }

    /**
     * Spend a recovery code. Marked used rather than deleted, so the trail can
     * show one was spent and when.
     */
    private function consumeRecoveryCode(User $user, string $code): bool
    {
        $candidates = UserRecoveryCode::where('user_id', $user->id)
            ->whereNull('used_at')
            ->get();

        foreach ($candidates as $candidate) {
            if (Hash::check($code, $candidate->code_hash)) {
                $candidate->forceFill(['used_at' => now()])->save();

                return true;
            }
        }

        return false;
    }

    // --------------------------------------------------------------- policy

    /**
     * off | grace | enforced. Anything unrecognised reads as 'grace', which is
     * the setting that prompts without locking anyone out.
     */
    public function policyFor(?Organization $organization): string
    {
        if (! $organization) {
            return 'off';
        }

        $policy = data_get($organization->settings, 'security.mfa_policy');

        return in_array($policy, ['off', 'grace', 'enforced'], true) ? $policy : 'grace';
    }

    public function graceEndsAt(?Organization $organization): ?CarbonInterface
    {
        if (! $organization) {
            return null;
        }

        $raw = data_get($organization->settings, 'security.mfa_grace_ends_at');

        if ($raw) {
            try {
                return \Carbon\Carbon::parse($raw);
            } catch (\Throwable) {
                // Fall through to the default below rather than throwing: a
                // malformed date must not make the whole app unreachable.
            }
        }

        // No window recorded yet — count from when the organisation was
        // created, so an existing tenant is not treated as newly enrolled.
        return $organization->created_at?->copy()->addDays(self::DEFAULT_GRACE_DAYS);
    }

    /**
     * Roles for which MFA is enforced.
     *
     * Hierarchy level 20 or better: super_admin (0), admin (10), and hr /
     * payroll_manager (20). Those are exactly the roles that can reach salary,
     * bank details and statutory identity. Line managers and employees are
     * prompted but never blocked.
     */
    public function isPrivileged(User $user): bool
    {
        return $user->getHierarchyLevel() <= 20;
    }

    /**
     * Whether this user must have MFA before they may keep using the app.
     *
     * The order of these checks is deliberate and load-bearing for
     * performance, not just style. This runs in middleware on every
     * authenticated API request, and `isEnrolled()` is the only step that
     * costs a query — so it goes last, after every check that can be answered
     * from data already in memory:
     *
     *   isPrivileged()  reads the role off the already-loaded user
     *   policyFor()     reads settings off the organisation the auth
     *                   middleware has already loaded
     *   graceEndsAt()   arithmetic on that same organisation
     *
     * Written the other way round it added a database round trip to every
     * request in the application, including the majority made by ordinary
     * employees who can never be blocked by this at all. ReportPerformanceTest
     * caught exactly that.
     */
    public function mustEnrolNow(User $user): bool
    {
        if (! $this->isPrivileged($user)) {
            return false;
        }

        $organization = $user->organization;
        $policy = $this->policyFor($organization);

        if ($policy === 'off') {
            return false;
        }

        if ($policy !== 'enforced') {
            $graceEnds = $this->graceEndsAt($organization);

            if ($graceEnds === null || $graceEnds->isFuture()) {
                return false;
            }
        }

        // Only now, having established that this user would actually be
        // blocked, is it worth asking the database whether they are enrolled.
        return ! $this->isEnrolled($user);
    }
}
