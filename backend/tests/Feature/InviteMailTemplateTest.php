<?php

namespace Tests\Feature;

use App\Mail\CareVanceInvitationMail;
use App\Models\Invitation;
use App\Models\Organization;
use App\Models\User;
use App\Support\RoleLabel;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The invitation email itself — the thing a new joiner actually receives.
 *
 * Nothing else in the suite renders this template. InvitationFlowTest and
 * InvitationLifecycleTest assert only that the mailable was *sent*, so a broken
 * button href, a lost token or a leaked Blade placeholder would ship silently.
 */
class InviteMailTemplateTest extends TestCase
{
    use RefreshDatabase;

    private const ACCEPT_URL = 'https://app.carevance.test/accept-invite/abc123token';

    private function organization(string $name = 'Acme Technologies Pvt Ltd'): Organization
    {
        return Organization::query()->create([
            'name' => $name,
            'slug' => 'acme-technologies',
        ]);
    }

    private function inviter(Organization $org): User
    {
        return User::query()->create([
            'name' => 'Priya Nair',
            'email' => 'priya.nair@acme.test',
            'password' => bcrypt('password123'),
            'role' => 'hr',
            'organization_id' => $org->id,
            'is_active' => true,
        ]);
    }

    private function invitation(?Organization $org = null, ?User $inviter = null, array $overrides = []): Invitation
    {
        $org ??= $this->organization();

        $invitation = Invitation::query()->create(array_merge([
            'organization_id' => $org->id,
            'email' => 'rahul.menon@example.test',
            'role' => 'hr',
            'token_hash' => hash('sha256', 'abc123token'),
            'invited_by' => $inviter?->id,
            'status' => 'pending',
            'metadata' => [
                'job_title' => 'Senior HR Executive',
                'joining_date' => '2026-09-01',
            ],
            'expires_at' => now()->addHours(72),
        ], $overrides));

        return $invitation->fresh(['organization', 'inviter']);
    }

    private function mail(?Invitation $invitation = null): CareVanceInvitationMail
    {
        return new CareVanceInvitationMail(
            invitation: $invitation ?? $this->invitation(),
            acceptUrl: self::ACCEPT_URL,
        );
    }

    public function test_the_template_carries_the_accept_link_twice_and_leaks_no_blade(): void
    {
        $html = $this->mail()->render();

        // Once on the button, once as the copy-and-paste fallback, which
        // carries it as both an href and visible text.
        $this->assertGreaterThanOrEqual(
            3,
            substr_count($html, self::ACCEPT_URL),
            'The accept URL must appear on the button and as pasteable text.'
        );
        $this->assertStringContainsString('href="'.self::ACCEPT_URL.'"', $html);

        // An unresolved Blade expression means a variable was renamed and the
        // recipient gets literal template syntax in their inbox.
        $this->assertStringNotContainsString('{{', $html);
        $this->assertStringNotContainsString('@if', $html);
    }

    public function test_the_employer_leads_the_subject_the_sender_name_and_the_body(): void
    {
        $org = $this->organization();
        $invitation = $this->invitation($org, $this->inviter($org));
        $mail = $this->mail($invitation);

        $envelope = $mail->envelope();

        $this->assertSame(
            'Priya Nair invited you to join Acme Technologies Pvt Ltd on CareVance',
            $envelope->subject
        );
        $this->assertSame('Acme Technologies Pvt Ltd via CareVance', $envelope->from->name);

        // The address itself must stay the DKIM-aligned sender, never the
        // client's own domain.
        $this->assertSame(config('mail.from.address'), $envelope->from->address);

        $html = $mail->render();
        $this->assertStringContainsString("You're joining Acme Technologies Pvt Ltd", $html);
        $this->assertStringContainsString('Priya Nair (HR) has invited you', $html);
    }

    public function test_replies_reach_the_person_who_sent_the_invitation(): void
    {
        $org = $this->organization();
        $envelope = $this->mail($this->invitation($org, $this->inviter($org)))->envelope();

        $this->assertCount(1, $envelope->replyTo);
        $this->assertSame('priya.nair@acme.test', $envelope->replyTo[0]->address);
    }

    public function test_it_renders_without_an_inviter(): void
    {
        // Link invites and CSV imports can have no inviter on the record.
        $invitation = $this->invitation(overrides: ['invited_by' => null]);
        $mail = $this->mail($invitation);

        $this->assertSame(
            "You're invited to join Acme Technologies Pvt Ltd on CareVance",
            $mail->envelope()->subject
        );
        $this->assertSame([], $mail->envelope()->replyTo);

        $html = $mail->render();
        $this->assertStringContainsString('You have been invited to set up your account.', $html);
        $this->assertStringNotContainsString('Invited by', $html);
    }

    public function test_the_banner_keeps_a_solid_background_beneath_the_gradient(): void
    {
        $html = $this->mail()->render();

        // Outlook renders with the Word engine and drops linear-gradient. With
        // no bgcolor underneath, the white headline lands on white and the
        // recipient sees an empty box — this is the regression guard for it.
        $this->assertStringContainsString('bgcolor="#16191C"', $html);
        $this->assertStringContainsString('background-color:#16191C;background-image:linear-gradient(', $html);

        // Outlook ignores max-width, so the card needs the MSO wrapper to stay
        // at 600px instead of stretching edge to edge.
        $this->assertStringContainsString('<!--[if mso]>', $html);
    }

    public function test_the_details_panel_shows_what_the_wizard_collected(): void
    {
        $org = $this->organization();
        $html = $this->mail($this->invitation($org, $this->inviter($org)))->render();

        $this->assertStringContainsString('Senior HR Executive', $html);
        $this->assertStringContainsString('1 September 2026', $html);
        $this->assertStringContainsString('Invited by', $html);

        // "Hr" and "Super_admin" used to reach recipients verbatim.
        $this->assertStringContainsString('HR', $html);
        $this->assertStringNotContainsString('>Hr<', $html);
    }

    public function test_it_sends_a_plain_text_part_carrying_the_accept_url(): void
    {
        // Mailable::render() only builds the HTML part, so the text view is
        // rendered through the same Content the mailer would use.
        $content = $this->mail()->content();
        $text = view($content->text, $content->with)->render();

        $this->assertStringContainsString(self::ACCEPT_URL, $text);
        $this->assertStringContainsString('WHAT HAPPENS NEXT', $text);
        $this->assertStringNotContainsString('<table', $text);
        $this->assertStringNotContainsString('{{', $text);
    }

    public function test_role_labels_are_readable(): void
    {
        $this->assertSame('Super Admin', RoleLabel::for('super_admin'));
        $this->assertSame('HR', RoleLabel::for('hr'));
        $this->assertSame('Payroll Manager', RoleLabel::for('payroll_manager'));
        $this->assertSame('Team member', RoleLabel::for(null));
    }
}
