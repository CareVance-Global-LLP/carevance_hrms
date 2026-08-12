<?php

namespace App\Mail;

use App\Models\BugReport;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class BugReportSubmittedMail extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly BugReport $bugReport,
    ) {
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: 'New CareVance bug report submitted',
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.support.bug-report-submitted',
            text: 'emails.support.bug-report-submitted_text',
            with: [
                'bugReport' => $this->bugReport,
            ],
        );
    }
}
