<?php

namespace App\Mail;

use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class VerifyEmailMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly User $user,
        public readonly string $verificationUrl,
    ) {
    }

    public function envelope(): Envelope
    {
        \Illuminate\Support\Facades\Log::info('DEBUG: VerifyEmailMail envelope() called', [
            'to' => $this->user->email,
            'subject' => 'Verify your CareVance email',
        ]);
        
        return new Envelope(
            subject: 'Verify your CareVance email',
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.auth.verify-email',
            with: [
                'name' => $this->user->name,
                'email' => $this->user->email,
                'verificationUrl' => $this->verificationUrl,
                'supportEmail' => config('carevance.support_email'),
            ],
        );
    }
}
