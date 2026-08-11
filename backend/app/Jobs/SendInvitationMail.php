<?php

namespace App\Jobs;

use App\Mail\CareVanceInvitationMail;
use App\Models\Invitation;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/**
 * Deliver one invitation email.
 *
 * Sending used to happen inline, once per recipient, inside the loop that
 * creates the invitations: fifty addresses meant fifty sequential SMTP
 * round-trips inside a single HTTP request, and a CSV batch sent up to 250 the
 * same way. The request timed out long before the batch finished, leaving the
 * admin with no result for invitations that had in fact been created.
 *
 * One job per recipient, so a single bad address cannot take the batch with it.
 *
 * The invitation is passed by id rather than as a serialized model: the token
 * has to travel with the job (only its hash is stored), and re-reading the row
 * at send time means a message revoked between dispatch and delivery is not
 * still sent.
 */
class SendInvitationMail implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    /**
     * Three attempts, unlike the payroll jobs.
     *
     * Retrying is safe here because sending is idempotent from the recipient's
     * point of view — the token is already persisted, so a second attempt
     * delivers the same working link rather than creating anything new. A
     * transient SMTP failure is the common case and is worth retrying.
     */
    public int $tries = 3;

    public int $backoff = 30;

    public function __construct(
        private readonly int $invitationId,
        private readonly string $token,
    ) {
    }

    public function handle(): void
    {
        /*
         * No Auth::setUser here, deliberately.
         *
         * `Invitation` does not use BelongsToOrganization, so no global scope
         * has to be satisfied — and this job must be able to read the row it
         * was given regardless of who is authenticated. The organization is
         * eager-loaded for the mail template rather than resolved from context.
         */
        $invitation = Invitation::query()
            ->with(['organization', 'inviter'])
            ->find($this->invitationId);

        if (!$invitation) {
            return;
        }

        if ($invitation->status !== 'pending') {
            Log::info('Invitation email skipped: no longer pending.', [
                'invitation_id' => $invitation->id,
                'status' => $invitation->status,
            ]);

            return;
        }

        // sendNow, not send: CareVanceInvitationMail is itself a ShouldQueue
        // mailable, so send() would push it onto the queue a second time from
        // inside the job that already is the async boundary.
        Mail::to($invitation->email)->sendNow(
            new CareVanceInvitationMail(
                invitation: $invitation,
                acceptUrl: app(\App\Services\Invitations\InvitationUrlService::class)->acceptUrl($this->token),
            )
        );

        $invitation->forceFill(['email_sent_at' => now()])->save();
    }

    public function failed(\Throwable $exception): void
    {
        Log::warning('Invitation email dispatch failed after retries.', [
            'invitation_id' => $this->invitationId,
            'exception' => $exception::class,
            'message' => $exception->getMessage(),
        ]);
    }
}
