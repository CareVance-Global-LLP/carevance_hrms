<?php

namespace App\Mail;

use App\Models\Organization;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class SubscriptionRenewalReminderMail extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly Organization $organization,
        public readonly int $daysRemaining,
        public readonly string $renewalDate,
        public readonly int $seats,
        public readonly bool $autoRenew,
    ) {
    }

    public function envelope(): Envelope
    {
        $subject = $this->daysRemaining <= 1
            ? "Your CareVance plan renews tomorrow"
            : "Your CareVance plan renews in {$this->daysRemaining} days";

        return new Envelope(subject: $subject);
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.billing.renewal-reminder',
            with: [
                'organization' => $this->organization,
                'daysRemaining' => $this->daysRemaining,
                'renewalDate' => $this->renewalDate,
                'seats' => $this->seats,
                'autoRenew' => $this->autoRenew,
                'billingUrl' => rtrim((string) config('carevance.frontend_url'), '/').'/settings/billing',
            ],
        );
    }
}
