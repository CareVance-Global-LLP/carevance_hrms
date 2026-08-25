<?php

namespace Tests\Feature;

use App\Models\Activity;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The timeline shows text a person can read.
 *
 * SanitizeInput runs htmlspecialchars() over every request field, so a window
 * title containing a quote is STORED as `&quot;`. Nothing decoded it, and the
 * React app escapes again when it renders, so a Google search appeared in the
 * timeline as
 * `site:linkedin.com/in/ (&quot;Business Loan&quot; OR &quot;MSME Loan&quot;)`
 * — entities and all, to every admin reading the page.
 *
 * The escaping is for a context these names never reach: they are rendered as
 * text, never as markup. Decoding at the display boundary repairs the rows
 * already in the database as well as new ones.
 */
class TimelineTextIsReadableTest extends TestCase
{
    use RefreshDatabase;

    public function test_an_escaped_quote_is_shown_as_a_quote(): void
    {
        $headers = $this->adminWhoVisited('site:linkedin.com/in/ (&quot;Business Loan&quot; OR &quot;MSME Loan&quot;)');

        $name = $this->firstName('/api/activities?per_page=50', $headers);

        $this->assertStringNotContainsString('&quot;', $name, 'an HTML entity reached the timeline as visible text');
        $this->assertSame('site:linkedin.com/in/ ("Business Loan" OR "MSME Loan")', $name);
    }

    public function test_the_processed_timeline_decodes_too(): void
    {
        $headers = $this->adminWhoVisited('Inbox (3) &amp; drafts - Gmail');

        $name = $this->firstName('/api/activities?processed=1&per_page=50', $headers);

        $this->assertStringNotContainsString('&amp;', $name);
        $this->assertStringContainsString('Inbox (3) & drafts', $name);
    }

    public function test_an_ordinary_title_with_an_ampersand_is_untouched(): void
    {
        // Already-decoded text must survive unchanged - decoding has to be safe
        // to apply to rows that were never escaped in the first place.
        $headers = $this->adminWhoVisited('Research & Development - Notes');

        $this->assertSame(
            'Research & Development - Notes',
            $this->firstName('/api/activities?per_page=50', $headers),
        );
    }

    private function firstName(string $url, array $headers): string
    {
        $data = $this->getJson($url, $headers)->assertOk()->json('data');
        $this->assertNotEmpty($data, 'the timeline returned no rows to assert on');

        return (string) ($data[0]['name'] ?? '');
    }

    /** @return array<string, string> */
    private function adminWhoVisited(string $name): array
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-timeline-text']);

        $user = User::create([
            'name' => 'Admin',
            'email' => 'admin@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        // Stamps organization_id the same way BelongsToOrganization would
        // from a real authenticated request.
        Auth::setUser($user);

        Activity::create([
            'user_id' => $user->id,
            'type' => 'app',
            'name' => $name,
            'duration' => 120,
            'recorded_at' => '2026-08-19 10:00:00',
        ]);

        return $this->apiHeadersFor($user);
    }
}
