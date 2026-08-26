<?php

namespace App\Services\Security;

use App\Mail\BreakGlassAccessMail;
use App\Models\BreakGlassSession;
use App\Models\Organization;
use App\Models\User;
use App\Services\Audit\AuditLogService;
use App\Services\Auth\ApiTokenService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/**
 * Governed vendor access to a customer tenant — "break glass".
 *
 * The endpoint this replaces minted an unlimited, non-expiring, unlogged
 * impersonation token for any user in any organisation. No reason, no customer
 * approval, no notification, no audit entry, and no way for a customer to see
 * it had happened. That is not a support tool; it is an unrecorded back door
 * through every tenant's payroll.
 *
 * Everything here exists to make the same capability answerable: who asked,
 * why, who allowed it, for how long, and — via the audit observer, which
 * stamps the session id on every write — what they did with it.
 */
class BreakGlassService
{
    public function __construct(
        private readonly ApiTokenService $tokens,
        private readonly AuditLogService $audit,
    ) {
    }

    /**
     * Whether this organisation requires an admin to approve access, or has
     * chosen to be notified and let support in immediately.
     *
     * Default is approval. A customer may lower it deliberately — a tenant
     * whose app is too broken to approve anything still needs to be helped —
     * but nobody is opted out of the control without choosing to be.
     */
    public function policyFor(Organization $organization): string
    {
        $policy = data_get($organization->settings, 'security.break_glass_policy');

        return in_array($policy, ['approval_required', 'notify_only'], true)
            ? $policy
            : 'approval_required';
    }

    public function request(
        User $vendor,
        User $target,
        string $reason,
        ?Request $httpRequest = null,
    ): BreakGlassSession {
        $organization = Organization::withoutGlobalScopes()->findOrFail($target->organization_id);
        $policy = $this->policyFor($organization);

        $session = new BreakGlassSession([
            'organization_id' => $organization->id,
            'target_user_id' => $target->id,
            'requested_by_user_id' => $vendor->id,
            'reason' => trim($reason),
            'status' => 'pending',
            'requested_at' => now(),
            'ip_address' => $httpRequest?->ip(),
            'user_agent' => $httpRequest?->userAgent(),
        ]);

        // The vendor is a super admin whose own organization_id is not the
        // customer's, so the trait's create-stamp would write the wrong tenant.
        // Set it explicitly and save without the scope.
        $session->organization_id = $organization->id;
        $session->saveQuietly();

        if ($policy === 'notify_only') {
            $this->grant($session, approver: null, minutes: BreakGlassSession::MAX_DURATION_MINUTES);
        }

        $this->audit->log(
            action: 'break_glass.requested',
            actor: $vendor,
            target: $session,
            metadata: [
                'organization_id' => $organization->id,
                'target_user_id' => $target->id,
                'reason' => $session->reason,
                'policy' => $policy,
            ],
            request: $httpRequest,
            organizationId: $organization->id,
        );

        $this->notifyOwner($session, $policy === 'notify_only' ? 'granted' : 'requested');

        return $session->refresh();
    }

    /**
     * Approve a pending request.
     *
     * $minutes is clamped to MAX_DURATION_MINUTES: an approver cannot grant
     * standing access by typing a large number, and the ceiling is the thing
     * a DPA actually names.
     */
    public function approve(BreakGlassSession $session, User $approver, int $minutes): BreakGlassSession
    {
        if ($session->status !== 'pending') {
            throw new \InvalidArgumentException('Only a pending request can be approved.');
        }

        $this->grant($session, $approver, $minutes);

        $this->audit->log(
            action: 'break_glass.approved',
            actor: $approver,
            target: $session,
            metadata: [
                'expires_at' => $session->expires_at?->toIso8601String(),
                'granted_minutes' => $session->remainingMinutes(),
            ],
            organizationId: $session->organization_id,
        );

        $this->notifyOwner($session, 'granted');

        return $session->refresh();
    }

    public function reject(BreakGlassSession $session, User $approver, ?string $reason = null): BreakGlassSession
    {
        if ($session->status !== 'pending') {
            throw new \InvalidArgumentException('Only a pending request can be declined.');
        }

        $session->forceFill([
            'status' => 'rejected',
            'approved_by_user_id' => $approver->id,
            'revoked_reason' => $reason,
        ])->saveQuietly();

        $this->audit->log(
            action: 'break_glass.rejected',
            actor: $approver,
            target: $session,
            metadata: ['reason' => $reason],
            organizationId: $session->organization_id,
        );

        return $session->refresh();
    }

    /**
     * Mint the token that lets the vendor act as the target user.
     *
     * The token's lifetime is the session's remaining lifetime, never the
     * default seven days, and its ability names the session so the middleware
     * can resolve it and the audit observer can stamp it.
     */
    public function issueToken(BreakGlassSession $session, User $vendor, ?Request $request = null): string
    {
        if ((int) $session->requested_by_user_id !== (int) $vendor->id) {
            throw new \InvalidArgumentException('Only the engineer who requested this session may use it.');
        }

        if (! $session->isUsable()) {
            throw new \InvalidArgumentException((string) $session->unusableReason());
        }

        $target = User::withoutGlobalScopes()->findOrFail($session->target_user_id);

        /*
         * The captured device is the ENGINEER'S, not the employee's — this
         * token is minted for the customer's user but will only ever be used
         * from the vendor's machine. That is the honest record, and it is what
         * makes the row explicable when the employee sees it in their own
         * session list. The list labels it "CareVance support access" from the
         * token's abilities rather than from the user agent, so the row says
         * what it is instead of naming a browser the employee does not own.
         */
        $token = $this->tokens->issue(
            user: $target,
            name: "break-glass:{$session->id}",
            ttlMinutes: max(1, $session->remainingMinutes()),
            abilities: ["break_glass:{$session->id}"],
            request: $request,
        );

        $session->forceFill(['token_issued_at' => now()])->saveQuietly();

        $this->audit->log(
            action: 'break_glass.token_issued',
            actor: $vendor,
            target: $session,
            metadata: [
                'target_user_id' => $target->id,
                'expires_at' => $session->expires_at?->toIso8601String(),
            ],
            organizationId: $session->organization_id,
        );

        return $token;
    }

    /**
     * End a session immediately and destroy any token issued against it.
     *
     * Revocation that leaves a working token behind is theatre, so the token
     * rows go too — matched on the name the issuer wrote.
     */
    public function revoke(BreakGlassSession $session, ?User $actor, ?string $reason = null): BreakGlassSession
    {
        $session->forceFill([
            'status' => 'revoked',
            'revoked_by_user_id' => $actor?->id,
            'revoked_at' => now(),
            'revoked_reason' => $reason,
        ])->saveQuietly();

        DB::table('personal_access_tokens')
            ->where('name', "break-glass:{$session->id}")
            ->delete();

        $this->audit->log(
            action: 'break_glass.revoked',
            actor: $actor,
            target: $session,
            metadata: ['reason' => $reason],
            organizationId: $session->organization_id,
        );

        return $session->refresh();
    }

    /**
     * Set the approval fields. Shared by approve() and the notify_only path so
     * the two cannot drift on how long a grant lasts.
     */
    private function grant(BreakGlassSession $session, ?User $approver, int $minutes): void
    {
        $minutes = max(1, min($minutes, BreakGlassSession::MAX_DURATION_MINUTES));

        $session->forceFill([
            'status' => 'approved',
            'approved_by_user_id' => $approver?->id,
            'approved_at' => now(),
            'expires_at' => now()->addMinutes($minutes),
        ])->saveQuietly();
    }

    /**
     * Tell the customer. Failure to send must not block or unwind the access
     * decision — but it is logged loudly, because a silent notification
     * failure turns a governed session back into an invisible one.
     */
    private function notifyOwner(BreakGlassSession $session, string $stage): void
    {
        try {
            $organization = Organization::withoutGlobalScopes()->find($session->organization_id);
            $owner = $organization?->owner;

            if (! $owner?->email) {
                Log::warning('Break-glass notification has no recipient', [
                    'session_id' => $session->id,
                    'organization_id' => $session->organization_id,
                ]);

                return;
            }

            Mail::to($owner->email)->send(new BreakGlassAccessMail($session->fresh(), $stage));
        } catch (\Throwable $e) {
            Log::error('Break-glass notification failed to send', [
                'session_id' => $session->id,
                'stage' => $stage,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
