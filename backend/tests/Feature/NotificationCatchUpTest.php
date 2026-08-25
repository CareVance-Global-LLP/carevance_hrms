<?php

namespace Tests\Feature;

use App\Models\AppNotification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The recovery path: what a client asks for after its socket dropped.
 *
 * A socket is the fast path and never the only path — it dies on Wi-Fi
 * handoff, on sleep, on proxy idle timeouts and on every deploy. When it comes
 * back the client asks for the exact gap rather than polling blindly, so these
 * are the guarantees that make that safe.
 */
class NotificationCatchUpTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $user;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create([
            'name' => 'Catch Up Org',
            'slug' => 'catch-up-org',
        ]);

        $this->user = User::create([
            'name' => 'Catcher',
            'email' => 'catcher@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);
    }

    private function seedNotifications(int $count, bool $isRead = false): array
    {
        $ids = [];

        for ($i = 1; $i <= $count; $i++) {
            $ids[] = (int) AppNotification::create([
                'organization_id' => $this->organization->id,
                'user_id' => $this->user->id,
                'type' => 'announcement',
                'title' => 'Notice '.$i,
                'message' => 'Body '.$i,
                'is_read' => $isRead,
            ])->id;
        }

        return $ids;
    }

    public function test_catch_up_returns_only_rows_above_the_watermark_in_ascending_order(): void
    {
        $ids = $this->seedNotifications(5);
        $watermark = $ids[1]; // client already has the first two

        $response = $this->getJson(
            '/api/notifications?since_id='.$watermark,
            $this->apiHeadersFor($this->user)
        )->assertOk();

        $returned = array_map(fn ($row) => (int) $row['id'], $response->json('data'));

        $this->assertSame(array_slice($ids, 2), $returned, 'Only rows above the watermark, oldest first.');
    }

    /**
     * Ordering is by id ascending, not created_at descending like the ordinary
     * list. The client advances a watermark from the last row it received, and
     * created_at is not unique — two notifications written in the same second
     * would make the watermark ambiguous and risk re-delivering or skipping.
     */
    public function test_catch_up_is_ordered_by_id_ascending_not_newest_first(): void
    {
        $ids = $this->seedNotifications(4);

        $returned = array_map(
            fn ($row) => (int) $row['id'],
            $this->getJson('/api/notifications?since_id=0', $this->apiHeadersFor($this->user))
                ->assertOk()
                ->json('data')
        );

        $this->assertSame($ids, $returned);
    }

    /**
     * A client returning from a long disconnect can have a gap larger than the
     * page cap. Silently truncating it would lose those notifications
     * PERMANENTLY, which is a worse outcome than the delay this feature exists
     * to remove.
     */
    public function test_a_gap_larger_than_the_limit_reports_more_remaining(): void
    {
        $this->seedNotifications(5);

        $response = $this->getJson(
            '/api/notifications?since_id=0&limit=2',
            $this->apiHeadersFor($this->user)
        )->assertOk();

        $this->assertCount(2, $response->json('data'));
        $this->assertTrue($response->json('has_more'));
    }

    public function test_a_gap_within_the_limit_reports_nothing_remaining(): void
    {
        $this->seedNotifications(2);

        $response = $this->getJson(
            '/api/notifications?since_id=0&limit=10',
            $this->apiHeadersFor($this->user)
        )->assertOk();

        $this->assertCount(2, $response->json('data'));
        $this->assertFalse($response->json('has_more'));
    }

    public function test_draining_a_large_gap_reaches_every_row_exactly_once(): void
    {
        $ids = $this->seedNotifications(7);

        $seen = [];
        $watermark = 0;

        do {
            $response = $this->getJson(
                '/api/notifications?since_id='.$watermark.'&limit=3',
                $this->apiHeadersFor($this->user)
            )->assertOk();

            foreach ($response->json('data') as $row) {
                $seen[] = (int) $row['id'];
            }

            $watermark = (int) $response->json('latest_id');
        } while ($response->json('has_more'));

        $this->assertSame($ids, $seen, 'Every row once, in order, with no gaps or repeats.');
    }

    /**
     * The badge is TOTAL unread, never "unread since the watermark". Counting
     * off the filtered query would collapse a user's 40 unread to the size of
     * whatever arrived while they were disconnected.
     */
    public function test_the_unread_count_is_the_total_not_the_size_of_the_gap(): void
    {
        $ids = $this->seedNotifications(6);

        $response = $this->getJson(
            '/api/notifications?since_id='.$ids[4],
            $this->apiHeadersFor($this->user)
        )->assertOk();

        $this->assertCount(1, $response->json('data'), 'One row above the watermark.');
        $this->assertSame(6, $response->json('unread_count'), 'But all six are still unread.');
    }

    public function test_an_empty_gap_echoes_the_watermark_back_rather_than_rewinding_to_zero(): void
    {
        $ids = $this->seedNotifications(3);
        $watermark = end($ids);

        $response = $this->getJson(
            '/api/notifications?since_id='.$watermark,
            $this->apiHeadersFor($this->user)
        )->assertOk();

        $this->assertSame([], $response->json('data'));
        $this->assertSame($watermark, $response->json('latest_id'));
        $this->assertFalse($response->json('has_more'));
    }

    public function test_the_ordinary_list_is_unchanged_and_stays_newest_first(): void
    {
        $ids = $this->seedNotifications(3);

        $response = $this->getJson('/api/notifications', $this->apiHeadersFor($this->user))->assertOk();

        $returned = array_map(fn ($row) => (int) $row['id'], $response->json('data'));

        $this->assertSame(array_reverse($ids), $returned, 'No since_id means newest first, as before.');
        $this->assertArrayNotHasKey('has_more', $response->json());
    }

    public function test_catch_up_never_crosses_a_user_boundary(): void
    {
        $this->seedNotifications(2);

        $colleague = User::create([
            'name' => 'Colleague',
            'email' => 'colleague.catchup@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);

        AppNotification::create([
            'organization_id' => $this->organization->id,
            'user_id' => $colleague->id,
            'type' => 'announcement',
            'title' => 'Not yours',
            'message' => 'Private',
            'is_read' => false,
        ]);

        $titles = array_map(
            fn ($row) => $row['title'],
            $this->getJson('/api/notifications?since_id=0', $this->apiHeadersFor($this->user))
                ->assertOk()
                ->json('data')
        );

        $this->assertNotContains('Not yours', $titles);
        $this->assertCount(2, $titles);
    }

    public function test_a_negative_watermark_is_rejected(): void
    {
        $this->getJson('/api/notifications?since_id=-1', $this->apiHeadersFor($this->user))
            ->assertStatus(422);
    }
}
