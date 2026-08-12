<?php

namespace App\Mail;

use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class IdleTimerStoppedMail extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly User $user,
        public readonly int $idleSeconds,
        public readonly string $idleDurationLabel,
        public readonly string $displayTimezone,
        public readonly CarbonInterface $stoppedAt,
    ) {
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: 'Your CareVance timer was stopped for inactivity',
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.timers.idle-auto-stop',
            text: 'emails.timers.idle-auto-stop_text',
            with: [
                'userName' => $this->user->name,
                'organizationName' => $this->user->organization?->name ?? 'CareVance',
                'idleDurationLabel' => $this->idleDurationLabel,
                'displayTimezone' => $this->displayTimezone,
                'stoppedAt' => $this->stoppedAt,
            ],
        );
    }
}
