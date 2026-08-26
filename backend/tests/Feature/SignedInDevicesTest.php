<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use App\Services\Auth\DeviceLabelService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * "Where you are signed in" — the acting user's own live sessions.
 *
 * The whole feature rests on two claims that were not true of this table
 * before: that a row can be told apart from the next one, and that the list is
 * the CALLER'S and nobody else's. Everything here is one of those two.
 */
class SignedInDevicesTest extends TestCase
{
    use RefreshDatabase;

    private const CHROME_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
    private const FIREFOX_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0';
    private const TRACKER_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) CareVance Tracker/1.2.6 Chrome/126.0.6478.127 Electron/31.0.2 Safari/537.36';

    // ------------------------------------------------------------- capture

    public function test_login_records_the_ip_and_user_agent_it_came_from(): void
    {
        $user = $this->makeUser();

        $token = $this->signIn($user, ip: '203.0.113.7', userAgent: self::CHROME_WINDOWS);

        $row = DB::table('personal_access_tokens')
            ->where('token', hash('sha256', $token))
            ->first();

        $this->assertNotNull($row);
        $this->assertSame('203.0.113.7', $row->created_ip);
        $this->assertSame(self::CHROME_WINDOWS, $row->created_user_agent);
        // Seeded from the sign-in, so a session that has never made a second
        // request still says where it is rather than showing an empty cell.
        $this->assertSame('203.0.113.7', $row->last_ip);
    }

    /**
     * A token minted with no Request behind it records nulls and lists as
     * "Unknown device".
     *
     * This is the honest half of the contract. Every production path now
     * passes the Request, but the parameter is nullable so that a future
     * caller without one fails visibly — as an unnamed row — rather than by
     * inheriting whatever request happened to be in flight.
     *
     * Deliberately not driven through the HTTP client: Symfony's BrowserKit
     * substitutes its own "Symfony" user agent when a test omits the header,
     * so a test that signed in without one would prove nothing about a real
     * client that sends none.
     */
    public function test_a_token_issued_without_a_request_is_unknown_not_guessed(): void
    {
        $user = $this->makeUser();
        $current = $this->signIn($user, userAgent: self::CHROME_WINDOWS);

        $plain = app(\App\Services\Auth\ApiTokenService::class)->issue($user, 'auth-token');

        $row = DB::table('personal_access_tokens')->where('token', hash('sha256', $plain))->first();
        $this->assertNull($row->created_ip);
        $this->assertNull($row->created_user_agent);
        $this->assertNull($row->last_ip);

        $listed = $this->listSessions($current)->assertOk();
        $unnamed = $this->rowFor($listed, (int) $row->id);

        $this->assertSame(DeviceLabelService::UNKNOWN, $unnamed['device']);
        $this->assertNull($unnamed['ip']);
    }

    // ---------------------------------------------------------------- list

    public function test_the_list_shows_every_live_session_and_marks_the_current_one(): void
    {
        $user = $this->makeUser();

        $currentToken = $this->signIn($user, ip: '198.51.100.4', userAgent: self::CHROME_WINDOWS);
        $currentId = $this->tokenId($currentToken);

        $otherId = $this->insertToken($user, [
            'created_ip' => '203.0.113.90',
            'last_ip' => '203.0.113.90',
            'created_user_agent' => self::FIREFOX_MAC,
            'last_used_at' => now()->subMinutes(3),
        ]);

        $response = $this->listSessions($currentToken, ip: '198.51.100.4')->assertOk();

        $ids = array_map(fn ($row) => $row['id'], $response->json('data'));
        $this->assertEqualsCanonicalizing([$currentId, $otherId], $ids);

        $current = $this->rowFor($response, $currentId);
        $this->assertTrue($current['is_current']);
        $this->assertSame('Chrome on Windows', $current['device']);
        $this->assertSame('198.51.100.4', $current['ip']);
        $this->assertNotNull($current['created_at']);

        $other = $this->rowFor($response, $otherId);
        $this->assertFalse($other['is_current']);
        $this->assertSame('Firefox on macOS', $other['device']);
        $this->assertSame('203.0.113.90', $other['ip']);

        // Most recently used first: the current session was just touched by
        // this very request, the other one three minutes ago.
        $this->assertSame($currentId, $response->json('data.0.id'));
    }

    public function test_an_expired_token_is_not_listed(): void
    {
        $user = $this->makeUser();
        $token = $this->signIn($user);

        $expiredId = $this->insertToken($user, [
            'expires_at' => now()->subHour(),
            'last_used_at' => now()->subHours(2),
            'created_user_agent' => self::FIREFOX_MAC,
        ]);

        $response = $this->listSessions($token)->assertOk();

        $ids = array_map(fn ($row) => $row['id'], $response->json('data'));
        $this->assertNotContains($expiredId, $ids);
        // Still in the table — expiry is not deletion; the nightly prune does
        // that. It is simply not a session anybody has.
        $this->assertDatabaseHas('personal_access_tokens', ['id' => $expiredId]);
    }

    public function test_another_users_session_is_invisible(): void
    {
        $organization = $this->makeOrganization();
        $mine = $this->makeUser($organization, 'mine@example.com');
        $theirs = $this->makeUser($organization, 'theirs@example.com');

        $token = $this->signIn($mine);
        $theirSessionId = $this->insertToken($theirs, ['created_user_agent' => self::FIREFOX_MAC]);

        $response = $this->listSessions($token)->assertOk();

        $ids = array_map(fn ($row) => $row['id'], $response->json('data'));
        $this->assertNotContains($theirSessionId, $ids);
        $this->assertCount(1, $ids);
    }

    public function test_no_response_ever_carries_the_token_or_its_hash(): void
    {
        $user = $this->makeUser();
        $token = $this->signIn($user, userAgent: self::CHROME_WINDOWS);
        $hash = hash('sha256', $token);

        $otherId = $this->insertToken($user, ['created_user_agent' => self::FIREFOX_MAC]);

        $list = $this->listSessions($token)->assertOk();
        $body = $list->getContent();

        $this->assertStringNotContainsString($token, $body);
        $this->assertStringNotContainsString($hash, $body);
        $this->assertArrayNotHasKey('token', $list->json('data.0'));

        $revoke = $this->deleteSession($token, $otherId)->assertOk();
        $this->assertStringNotContainsString($token, $revoke->getContent());
        $this->assertStringNotContainsString($hash, $revoke->getContent());
    }

    // -------------------------------------------------------------- revoke

    public function test_revoking_someone_elses_id_is_refused_exactly_like_a_missing_id(): void
    {
        $organization = $this->makeOrganization();
        $mine = $this->makeUser($organization, 'mine@example.com');
        $theirs = $this->makeUser($organization, 'theirs@example.com');

        $token = $this->signIn($mine);
        $theirSessionId = $this->insertToken($theirs);

        $foreign = $this->deleteSession($token, $theirSessionId);
        $missing = $this->deleteSession($token, 999999);

        $foreign->assertNotFound();
        $missing->assertNotFound();

        // Byte-for-byte identical. Anything that differs — a message, a code,
        // even the status — tells an unauthenticated-in-practice caller which
        // token ids exist across the whole deployment.
        $this->assertSame($missing->getContent(), $foreign->getContent());

        // And the refusal is real, not cosmetic.
        $this->assertDatabaseHas('personal_access_tokens', ['id' => $theirSessionId]);
    }

    public function test_revoking_my_own_session_deletes_that_row_and_no_other(): void
    {
        $user = $this->makeUser();
        $token = $this->signIn($user, userAgent: self::CHROME_WINDOWS);
        $currentId = $this->tokenId($token);

        $doomedId = $this->insertToken($user, ['created_user_agent' => self::FIREFOX_MAC]);
        $survivorId = $this->insertToken($user, ['created_user_agent' => self::CHROME_WINDOWS]);

        $this->deleteSession($token, $doomedId)
            ->assertOk()
            ->assertJsonPath('was_current_session', false);

        $this->assertDatabaseMissing('personal_access_tokens', ['id' => $doomedId]);
        $this->assertDatabaseHas('personal_access_tokens', ['id' => $survivorId]);
        $this->assertDatabaseHas('personal_access_tokens', ['id' => $currentId]);

        // The session that did the revoking is still signed in — cutting one
        // device off must not cut off the rest, which is the entire feature.
        $this->listSessions($token)->assertOk();

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'auth.session_revoked',
            'actor_user_id' => $user->id,
        ]);
    }

    public function test_revoking_the_current_session_says_so_and_ends_it(): void
    {
        $user = $this->makeUser();
        $token = $this->signIn($user);
        $currentId = $this->tokenId($token);

        $this->deleteSession($token, $currentId)
            ->assertOk()
            ->assertJsonPath('was_current_session', true);

        $this->assertDatabaseMissing('personal_access_tokens', ['id' => $currentId]);
        $this->listSessions($token)->assertUnauthorized();
    }

    // -------------------------------------------------------- last_ip drift

    public function test_last_ip_follows_the_device_but_no_more_than_once_a_minute(): void
    {
        $user = $this->makeUser();
        $token = $this->signIn($user, ip: '198.51.100.4', userAgent: self::CHROME_WINDOWS);
        $tokenId = $this->tokenId($token);

        $this->assertSame('198.51.100.4', $this->tokenRow($tokenId)->last_ip);

        // First use from somewhere new. last_used_at is still null, so the
        // throttle treats the row as stale and the address moves.
        $this->listSessions($token, ip: '203.0.113.11')->assertOk();
        $this->assertSame('203.0.113.11', $this->tokenRow($tokenId)->last_ip);

        // Second use, seconds later, from a third address. The throttle
        // refuses the write — and that is the point: the address is allowed to
        // be a minute stale so that a busy account does not write a row on
        // every single request, which is the incident touchActivity's throttle
        // exists to prevent.
        $this->listSessions($token, ip: '203.0.113.222')->assertOk();
        $this->assertSame('203.0.113.11', $this->tokenRow($tokenId)->last_ip);

        // Past the throttle window it catches up on its own.
        $this->travel(2)->minutes();
        $this->listSessions($token, ip: '203.0.113.222')->assertOk();
        $this->assertSame('203.0.113.222', $this->tokenRow($tokenId)->last_ip);

        // created_ip never moves. It is what the sign-in WAS.
        $this->assertSame('198.51.100.4', $this->tokenRow($tokenId)->created_ip);
    }

    // ---------------------------------------------------- concurrent signal

    public function test_concurrent_use_is_true_for_two_devices_inside_the_window(): void
    {
        $user = $this->makeUser();
        $token = $this->signIn($user, ip: '198.51.100.4', userAgent: self::CHROME_WINDOWS);

        $this->insertToken($user, [
            'created_ip' => '203.0.113.90',
            'last_ip' => '203.0.113.90',
            'created_user_agent' => self::FIREFOX_MAC,
            'last_used_at' => now()->subMinutes(2),
        ]);

        $this->listSessions($token, ip: '198.51.100.4')
            ->assertOk()
            ->assertJsonPath('concurrent_use', true)
            ->assertJsonPath('active_device_count', 2);
    }

    public function test_concurrent_use_is_false_for_one_device(): void
    {
        $user = $this->makeUser();
        $token = $this->signIn($user, ip: '198.51.100.4', userAgent: self::CHROME_WINDOWS);

        $this->listSessions($token, ip: '198.51.100.4')
            ->assertOk()
            ->assertJsonPath('concurrent_use', false)
            ->assertJsonPath('active_device_count', 1);
    }

    public function test_a_second_device_that_went_quiet_before_the_window_does_not_count(): void
    {
        $user = $this->makeUser();
        $token = $this->signIn($user, ip: '198.51.100.4', userAgent: self::CHROME_WINDOWS);

        // Live enough to be listed, idle long enough not to be "right now".
        $this->insertToken($user, [
            'created_ip' => '203.0.113.90',
            'last_ip' => '203.0.113.90',
            'created_user_agent' => self::FIREFOX_MAC,
            'last_used_at' => now()->subHours(3),
        ]);

        $response = $this->listSessions($token, ip: '198.51.100.4')->assertOk();

        $this->assertCount(2, $response->json('data'));
        $this->assertFalse($response->json('concurrent_use'));
        $this->assertSame(1, $response->json('active_device_count'));
    }

    // ------------------------------------------------------------- refusals

    public function test_a_deactivated_user_cannot_list_sessions_at_all(): void
    {
        $user = $this->makeUser();
        $token = $this->signIn($user);

        $this->listSessions($token)->assertOk();

        $user->forceFill(['deactivated_at' => now()])->save();

        $this->listSessions($token)
            ->assertForbidden()
            ->assertJsonPath('error_code', 'ACCOUNT_DEACTIVATED');

        $this->deleteSession($token, $this->tokenId($token))
            ->assertForbidden()
            ->assertJsonPath('error_code', 'ACCOUNT_DEACTIVATED');
    }

    public function test_sessions_require_authentication(): void
    {
        $this->getJson('/api/auth/sessions')->assertUnauthorized();
        $this->deleteJson('/api/auth/sessions/1')->assertUnauthorized();
    }

    // -------------------------------------------------------- device labels

    /**
     * The one rule: nothing is invented. A string we cannot read yields
     * "Unknown device" rather than a half-parsed guess, because the label is
     * what somebody uses to decide which session to cut off.
     */
    public function test_device_labels_name_only_what_the_user_agent_says(): void
    {
        $labels = app(DeviceLabelService::class);

        $this->assertSame('Chrome on Windows', $labels->describe(self::CHROME_WINDOWS));
        $this->assertSame('Firefox on macOS', $labels->describe(self::FIREFOX_MAC));
        $this->assertSame('Safari on iPhone', $labels->describe(
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
        ));
        $this->assertSame('Chrome on Android', $labels->describe(
            'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
        ));

        // Edge and Opera carry "Chrome/" too, so ladder order decides these.
        $this->assertSame('Edge on Windows', $labels->describe(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0'
        ));

        // Our own shell embeds Chromium, so it must be tested before Chrome or
        // it reads as an ordinary browser on the user's PC.
        $this->assertSame(DeviceLabelService::DESKTOP, $labels->describe(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) CareVance Tracker/1.2.6 Chrome/126.0.0.0 Electron/31.0.0 Safari/537.36'
        ));

        foreach ([null, '', '   ', 'curl/8.4.0', 'PostmanRuntime/7.39.0'] as $unreadable) {
            $this->assertSame(
                DeviceLabelService::UNKNOWN,
                $labels->describe($unreadable),
                sprintf('Expected "Unknown device" for %s', var_export($unreadable, true)),
            );
        }
    }

    public function test_a_break_glass_session_is_named_rather_than_disguised(): void
    {
        $user = $this->makeUser();
        $token = $this->signIn($user, userAgent: self::CHROME_WINDOWS);

        // Minted for the customer's employee, used from the engineer's machine.
        // It shows up in the employee's own list, which is the point of
        // break-glass — so it is labelled for what it is, not for the browser
        // the engineer happens to run.
        $supportId = $this->insertToken($user, [
            'name' => 'break-glass:41',
            'abilities' => json_encode(['break_glass:41']),
            'created_user_agent' => self::FIREFOX_MAC,
        ]);

        $response = $this->listSessions($token)->assertOk();

        $this->assertSame(
            DeviceLabelService::SUPPORT,
            $this->rowFor($response, $supportId)['device'],
        );
    }

    // --------------------------------------------------------------- prune

    public function test_the_prune_removes_only_tokens_past_the_grace_period(): void
    {
        $user = $this->makeUser();

        $live = $this->insertToken($user, ['expires_at' => now()->addDay()]);
        $neverExpires = $this->insertToken($user, ['expires_at' => null]);
        $recentlyExpired = $this->insertToken($user, ['expires_at' => now()->subHours(2)]);
        $longExpired = $this->insertToken($user, ['expires_at' => now()->subDays(30)]);

        $this->artisan('tokens:purge-expired')->assertExitCode(0);

        $this->assertDatabaseHas('personal_access_tokens', ['id' => $live]);
        // NULL means "does not expire", not "expired long ago".
        $this->assertDatabaseHas('personal_access_tokens', ['id' => $neverExpires]);
        // Inside the grace window: still the row somebody asks about.
        $this->assertDatabaseHas('personal_access_tokens', ['id' => $recentlyExpired]);
        $this->assertDatabaseMissing('personal_access_tokens', ['id' => $longExpired]);
    }

    public function test_the_prune_dry_run_deletes_nothing(): void
    {
        $user = $this->makeUser();
        $longExpired = $this->insertToken($user, ['expires_at' => now()->subDays(30)]);

        $this->artisan('tokens:purge-expired --dry-run')->assertExitCode(0);

        $this->assertDatabaseHas('personal_access_tokens', ['id' => $longExpired]);
    }

    // --------------------------------------------------- behind a proxy

    /**
     * The address recorded is the CLIENT'S, not the reverse proxy's.
     *
     * Nothing trusted a forwarded header before, so behind any of this
     * repository's deployments — nginx in front of the backend container,
     * nginx in front of an internal vhost on 127.0.0.1, Caddy proxying
     * /api/* — every sign-in by every user on every device recorded the
     * proxy's own address. The list then showed one identical address on every
     * row while asking the reader to sign out anything they did not recognise,
     * which is worse than showing nothing: a session from another country
     * looked exactly like the laptop on the desk.
     *
     * This is the shape a real request has and the capture test above does
     * not: the peer is the proxy, and the client is named only in
     * X-Forwarded-For.
     */
    public function test_a_forwarded_request_records_the_client_address_not_the_proxys(): void
    {
        $user = $this->makeUser();

        $token = $this->signIn(
            $user,
            ip: '127.0.0.1',
            userAgent: self::CHROME_WINDOWS,
            forwardedFor: '203.0.113.45',
        );

        $row = DB::table('personal_access_tokens')
            ->where('token', hash('sha256', $token))
            ->first();

        $this->assertSame('203.0.113.45', $row->created_ip);
        $this->assertSame('203.0.113.45', $row->last_ip);

        // And it survives all the way out to the client, which is where the
        // person actually reads it.
        $listed = $this->listSessions($token, ip: '127.0.0.1', forwardedFor: '203.0.113.45')->assertOk();
        $this->assertSame('203.0.113.45', $this->rowFor($listed, (int) $row->id)['ip']);
    }

    /** The refreshed address follows the forwarded client too, not the hop. */
    public function test_last_ip_follows_the_forwarded_client_address(): void
    {
        $user = $this->makeUser();
        $token = $this->signIn($user, ip: '127.0.0.1', forwardedFor: '203.0.113.45');
        $tokenId = $this->tokenId($token);

        $this->listSessions($token, ip: '127.0.0.1', forwardedFor: '198.51.100.9')->assertOk();

        $this->assertSame('198.51.100.9', $this->tokenRow($tokenId)->last_ip);
        $this->assertSame('203.0.113.45', $this->tokenRow($tokenId)->created_ip);
    }

    /**
     * A forwarded header from a peer that is NOT a trusted proxy is ignored.
     *
     * This is the other half of the fix, and the reason the trust list is the
     * private ranges rather than '*'. If any caller could name its own address
     * by setting a header, the column would be decoration again — worse than
     * decoration, because somebody is asked to act on it.
     */
    public function test_a_forwarded_header_from_an_untrusted_peer_is_ignored(): void
    {
        $user = $this->makeUser();

        $token = $this->signIn(
            $user,
            ip: '198.51.100.7',
            userAgent: self::CHROME_WINDOWS,
            forwardedFor: '203.0.113.45',
        );

        $row = DB::table('personal_access_tokens')
            ->where('token', hash('sha256', $token))
            ->first();

        $this->assertSame('198.51.100.7', $row->created_ip);
        $this->assertSame('198.51.100.7', $row->last_ip);
    }

    // -------------------------------------------- the tracker is not a guest

    /**
     * Our own desktop shell beside a browser on the same machine is ONE device.
     *
     * The tracker and Chrome share an address and differ only in label, so
     * pairing address with label counted them as two — and running the tracker
     * all day is what the desktop product is for, so the banner was on
     * permanently for exactly the people most likely to see it. A warning that
     * never turns off is one nobody reads on the day it means something.
     */
    public function test_the_desktop_tracker_beside_a_browser_is_not_a_second_device(): void
    {
        $user = $this->makeUser();
        $token = $this->signIn($user, ip: '203.0.113.60', userAgent: self::CHROME_WINDOWS);

        $this->insertToken($user, [
            'created_ip' => '203.0.113.60',
            'last_ip' => '203.0.113.60',
            'created_user_agent' => self::TRACKER_WINDOWS,
            'last_used_at' => now()->subMinute(),
        ]);

        $response = $this->listSessions($token, ip: '203.0.113.60')->assertOk();

        // Both are listed — the person should still see the tracker and be
        // able to sign it out. It just is not a second party.
        $this->assertCount(2, $response->json('data'));
        $this->assertFalse($response->json('concurrent_use'));
        $this->assertSame(1, $response->json('active_device_count'));
    }

    /** Alone at an address, the tracker is still the one device it is. */
    public function test_the_desktop_tracker_alone_still_counts_as_a_device(): void
    {
        $user = $this->makeUser();
        $token = $this->signIn($user, ip: '198.51.100.4', userAgent: self::CHROME_WINDOWS);

        $this->insertToken($user, [
            'created_ip' => '203.0.113.60',
            'last_ip' => '203.0.113.60',
            'created_user_agent' => self::TRACKER_WINDOWS,
            'last_used_at' => now()->subMinute(),
        ]);

        $this->listSessions($token, ip: '198.51.100.4')
            ->assertOk()
            ->assertJsonPath('concurrent_use', true)
            ->assertJsonPath('active_device_count', 2);
    }

    // ------------------------------------------------- the accumulated pile

    /**
     * The list is capped, and says so by reporting the true total.
     *
     * A seven-day token TTL plus one token per sign-in means a real account
     * holds dozens of live rows — one in production holds 163. Rendering a row
     * per token does not answer "is anyone else on my account", it buries the
     * question.
     */
    public function test_the_list_is_capped_but_reports_the_true_total(): void
    {
        $user = $this->makeUser();
        $token = $this->signIn($user, ip: '198.51.100.4', userAgent: self::CHROME_WINDOWS);

        for ($i = 0; $i < 60; $i++) {
            $this->insertToken($user, ['last_used_at' => now()->subMinutes(30 + $i)]);
        }

        $response = $this->listSessions($token, ip: '198.51.100.4')->assertOk();

        $this->assertCount(50, $response->json('data'));
        $this->assertSame(50, $response->json('listed_count'));
        $this->assertSame(61, $response->json('total_count'));
    }

    /**
     * "Sign out everywhere else" clears the pile in one act.
     *
     * Without it the only way through 162 unrecognised sessions is 162
     * confirmations, which nobody does — so the list stays unreadable and the
     * feature answers nothing. It is also exactly what somebody wants at the
     * moment they think their password has leaked.
     */
    public function test_signing_out_everywhere_else_keeps_only_this_session(): void
    {
        $user = $this->makeUser();
        $stranger = $this->makeUser($this->makeOrganization(), 'someone.else@example.com');

        $token = $this->signIn($user, ip: '198.51.100.4', userAgent: self::CHROME_WINDOWS);
        $currentId = $this->tokenId($token);

        $others = [
            $this->insertToken($user),
            $this->insertToken($user, ['created_user_agent' => self::FIREFOX_MAC]),
            // Expired rows go too: they authenticate nothing, and leaving them
            // means the prune's grace period decides how long a signed-out
            // device keeps appearing in the list.
            $this->insertToken($user, ['expires_at' => now()->subDay()]),
        ];
        $strangersToken = $this->insertToken($stranger);

        $this->deleteOtherSessions($token)
            ->assertOk()
            ->assertJsonPath('revoked_count', 3);

        foreach ($others as $id) {
            $this->assertDatabaseMissing('personal_access_tokens', ['id' => $id]);
        }

        // The session that asked survives — signing somebody out of the
        // browser they clicked it in is not a smaller version of what they
        // asked for.
        $this->assertDatabaseHas('personal_access_tokens', ['id' => $currentId]);
        $this->listSessions($token)->assertOk()->assertJsonCount(1, 'data');

        // Nobody else's sessions are touched.
        $this->assertDatabaseHas('personal_access_tokens', ['id' => $strangersToken]);

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'auth.other_sessions_revoked',
            'actor_user_id' => $user->id,
        ]);
    }

    public function test_signing_out_everywhere_else_requires_authentication(): void
    {
        $this->deleteJson('/api/auth/sessions', [], ['Accept' => 'application/json'])
            ->assertUnauthorized();
    }

    // ------------------------------------------------------------- fixtures

    private function makeOrganization(): Organization
    {
        return Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance-'.uniqid(),
        ]);
    }

    private function makeUser(?Organization $organization = null, string $email = 'admin@example.com'): User
    {
        $organization ??= $this->makeOrganization();

        $user = User::create([
            'name' => 'Admin User',
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        $user->forceFill(['email_verified_at' => now()])->save();

        return $user;
    }

    /** Sign in for real, so the capture under test is the production path. */
    private function signIn(
        User $user,
        string $ip = '127.0.0.1',
        string $userAgent = self::CHROME_WINDOWS,
        ?string $forwardedFor = null,
    ): string {
        $headers = [
            'Accept' => 'application/json',
            'User-Agent' => $userAgent,
        ];

        if ($forwardedFor !== null) {
            $headers['X-Forwarded-For'] = $forwardedFor;
        }

        $response = $this->withServerVariables(['REMOTE_ADDR' => $ip])
            ->postJson('/api/auth/login', [
                'email' => $user->email,
                'password' => 'password123',
            ], $headers)
            ->assertOk();

        return (string) $response->json('token');
    }

    /**
     * A session this test did not sign in through — the cheapest way to stand
     * up a second device without a second browser.
     *
     * @param  array<string, mixed>  $overrides
     */
    private function insertToken(User $user, array $overrides = []): int
    {
        return (int) DB::table('personal_access_tokens')->insertGetId(array_merge([
            'tokenable_type' => User::class,
            'tokenable_id' => $user->id,
            'name' => 'auth-token',
            'token' => hash('sha256', bin2hex(random_bytes(40))),
            'abilities' => json_encode(['*']),
            'created_ip' => '203.0.113.90',
            'created_user_agent' => null,
            'last_ip' => '203.0.113.90',
            'last_used_at' => now()->subMinutes(2),
            'expires_at' => now()->addDays(7),
            'created_at' => now()->subDay(),
            'updated_at' => now(),
        ], $overrides));
    }

    private function listSessions(
        string $token,
        string $ip = '127.0.0.1',
        ?string $forwardedFor = null,
    ): \Illuminate\Testing\TestResponse {
        $headers = [
            'Authorization' => 'Bearer '.$token,
            'Accept' => 'application/json',
            'User-Agent' => self::CHROME_WINDOWS,
        ];

        if ($forwardedFor !== null) {
            $headers['X-Forwarded-For'] = $forwardedFor;
        }

        return $this->withServerVariables(['REMOTE_ADDR' => $ip])
            ->getJson('/api/auth/sessions', $headers);
    }

    private function deleteOtherSessions(string $token): \Illuminate\Testing\TestResponse
    {
        return $this->withServerVariables(['REMOTE_ADDR' => '127.0.0.1'])
            ->deleteJson('/api/auth/sessions', [], [
                'Authorization' => 'Bearer '.$token,
                'Accept' => 'application/json',
                'User-Agent' => self::CHROME_WINDOWS,
            ]);
    }

    private function deleteSession(string $token, int $id, string $ip = '127.0.0.1'): \Illuminate\Testing\TestResponse
    {
        return $this->withServerVariables(['REMOTE_ADDR' => $ip])
            ->deleteJson('/api/auth/sessions/'.$id, [], [
                'Authorization' => 'Bearer '.$token,
                'Accept' => 'application/json',
                'User-Agent' => self::CHROME_WINDOWS,
            ]);
    }

    private function tokenId(string $plainToken): int
    {
        return (int) DB::table('personal_access_tokens')
            ->where('token', hash('sha256', $plainToken))
            ->value('id');
    }

    private function tokenRow(int $id): object
    {
        return DB::table('personal_access_tokens')->where('id', $id)->first();
    }

    /**
     * @return array<string, mixed>
     */
    private function rowFor(\Illuminate\Testing\TestResponse $response, int $id): array
    {
        foreach ($response->json('data') as $row) {
            if ((int) $row['id'] === $id) {
                return $row;
            }
        }

        $this->fail(sprintf('Session %d was not in the list.', $id));
    }
}
