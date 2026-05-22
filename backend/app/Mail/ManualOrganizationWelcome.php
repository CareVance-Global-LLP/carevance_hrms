<?php

namespace App\Mail;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

class ManualOrganizationWelcome extends Mailable
{
    public function __construct(
        public readonly User $user,
        public readonly Organization $organization,
        public readonly string $tempPassword,
        public readonly string $loginUrl,
    ) {
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: 'Welcome to CareVance - Your Account is Ready',
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.manual-organization-welcome',
            with: [
                'userName' => $this->user->name,
                'organizationName' => $this->organization->name,
                'userEmail' => $this->user->email,
                'tempPassword' => $this->tempPassword,
                'loginUrl' => $this->loginUrl,
                'planName' => $this->organization->plan_code,
                'seats' => $this->organization->max_seats,
            ],
        );
    }
}
