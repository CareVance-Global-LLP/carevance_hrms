<?php

namespace App\Mail;

use App\Models\BreakGlassSession;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Tells the customer that support has asked for, or been given, access to
 * their tenant.
 *
 * This mail is the difference between a governed session and a quiet one. If
 * it stops being sent, the control is gone even though the database still
 * looks correct — which is why BreakGlassService logs an error rather than
 * swallowing a send failure.
 */
class BreakGlassAccessMail extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    /**
     * @param  string  $stage  'requested' or 'granted'
     */
    public function __construct(
        public readonly BreakGlassSession $session,
        public readonly string $stage,
    ) {
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: $this->stage === 'granted'
                ? 'CareVance support has been given temporary access to your account'
                : 'CareVance support is requesting access to your account',
        );
    }

    public function content(): Content
    {
        $session = $this->session;

        return new Content(
            view: 'emails.security.break-glass',
            text: 'emails.security.break-glass_text',
            with: [
                'stage' => $this->stage,
                'organizationName' => $session->organization?->name ?? 'your organisation',
                'engineerName' => $session->requestedBy?->name ?? 'A CareVance engineer',
                'targetName' => $session->targetUser?->name ?? 'an employee account',
                'reason' => $session->reason,
                'expiresAt' => $session->expires_at,
                'requestedAt' => $session->requested_at,
                'maxMinutes' => BreakGlassSession::MAX_DURATION_MINUTES,
            ],
        );
    }
}
