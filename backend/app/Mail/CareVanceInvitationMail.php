<?php

namespace App\Mail;

use App\Models\Invitation;
use App\Support\RoleLabel;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Address;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Carbon;

class CareVanceInvitationMail extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly Invitation $invitation,
        public readonly string $acceptUrl,
    ) {
    }

    /**
     * The joiner knows their employer and has usually never heard of CareVance,
     * so the organisation leads the sender name and the subject.
     *
     * The sender *address* deliberately stays whatever `MAIL_FROM_ADDRESS` is:
     * that is the domain SPF and DKIM align against. Sending as the client's
     * own domain would fail DMARC at the receiving end and route invitations to
     * spam — the exact opposite of what leading with their name is for. Only
     * the display name varies per tenant.
     */
    public function envelope(): Envelope
    {
        $organizationName = $this->organizationName();
        $inviterName = $this->inviterName();

        return new Envelope(
            from: new Address(
                (string) config('mail.from.address'),
                $organizationName.' via CareVance',
            ),
            replyTo: $this->inviterReplyTo(),
            subject: $inviterName
                ? $inviterName.' invited you to join '.$organizationName.' on CareVance'
                : 'You\'re invited to join '.$organizationName.' on CareVance',
        );
    }

    public function content(): Content
    {
        $expiresAt = $this->invitation->expires_at;
        $joiningDate = $this->joiningDate();

        return new Content(
            view: 'emails.invitations.carevance',
            text: 'emails.invitations.carevance_text',
            with: [
                'organizationName' => $this->organizationName(),
                'email' => $this->invitation->email,
                // ucfirst() used to put "Hr" and "Super_admin" in front of the
                // recipient; RoleLabel is the shared map.
                'roleLabel' => RoleLabel::for($this->invitation->role),
                'jobTitle' => $this->metadataString('job_title'),
                'joiningDate' => $joiningDate?->translatedFormat('j F Y'),
                'inviterName' => $this->inviterName(),
                'inviterRoleLabel' => $this->invitation->inviter?->role
                    ? RoleLabel::for($this->invitation->inviter->role, '')
                    : null,
                'acceptUrl' => $this->acceptUrl,
                'expiresAtLabel' => $this->expiresAtLabel($expiresAt),
                'expiresInHours' => (int) config('carevance.invitation_expiration_hours', 72),
                'supportEmail' => config('carevance.support_email'),
            ],
        );
    }

    private function organizationName(): string
    {
        return $this->invitation->organization?->name ?: 'CareVance workspace';
    }

    private function inviterName(): ?string
    {
        $name = trim((string) ($this->invitation->inviter?->name ?? ''));

        return $name !== '' ? $name : null;
    }

    /**
     * Replies go to the person who sent the invitation, not to the shared
     * sending mailbox — a confused joiner writes back to their own HR team.
     */
    private function inviterReplyTo(): array
    {
        $inviter = $this->invitation->inviter;
        $email = trim((string) ($inviter?->email ?? ''));

        if ($email === '') {
            return [];
        }

        return [new Address($email, $this->inviterName() ?? $email)];
    }

    private function metadataString(string $key): ?string
    {
        $value = trim((string) ($this->invitation->metadata[$key] ?? ''));

        return $value !== '' ? $value : null;
    }

    private function joiningDate(): ?Carbon
    {
        $raw = $this->invitation->metadata['joining_date'] ?? null;

        if (blank($raw)) {
            return null;
        }

        try {
            return Carbon::parse($raw);
        } catch (\Throwable) {
            // A malformed date in metadata is not worth failing an invitation
            // over; the row is simply omitted from the panel.
            return null;
        }
    }

    /**
     * Both framings, because each answers a different question: "how long have
     * I got" and "is that before or after my weekend".
     */
    private function expiresAtLabel(?Carbon $expiresAt): string
    {
        if (! $expiresAt) {
            return 'No expiry';
        }

        $local = $expiresAt->copy()->timezone(config('app.timezone'));
        $hours = (int) round(now()->diffInMinutes($expiresAt, false) / 60);

        // The timezone abbreviation is not decoration: the recipient is often
        // in a different one from the workspace, and "6:30 PM" alone is a
        // deadline they cannot act on.
        if ($hours < 1) {
            return $local->format('j M Y, g:i A T');
        }

        return 'in '.$hours.' '.\Illuminate\Support\Str::plural('hour', $hours)
            .' — '.$local->format('j M Y, g:i A T');
    }
}
