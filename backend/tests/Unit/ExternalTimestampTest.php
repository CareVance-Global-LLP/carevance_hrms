<?php

namespace Tests\Unit;

use App\Support\ExternalTimestamp;
use Carbon\Carbon as BaseCarbon;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Support\Carbon as IlluminateCarbon;
use Tests\TestCase;

/**
 * The timeline bug of 19 Aug 2026 was not a bad instant — it was a correct
 * instant whose timezone was thrown away on the way out of the API.
 *
 * `ExternalTimestamp` guarded its fast path with `$value instanceof Carbon`
 * where `Carbon` resolved to `Illuminate\Support\Carbon`. That is a *subclass*
 * of `Carbon\Carbon`, so the test only matched one way: any plain
 * `Carbon\Carbon` — which is what `Carbon::createFromTimestamp()` returns
 * throughout `UsageProcessingService` — missed the fast path and fell through
 * to `Carbon::parse((string) $value)`. Casting a Carbon to string yields
 * 'Y-m-d H:i:s' with **no offset**, so a UTC wall clock was re-read as an
 * app-timezone wall clock and the instant silently moved backwards by the
 * app's UTC offset.
 *
 * These tests pin the invariant that actually matters: whatever shape of
 * date-time object arrives, the instant on the way out is the instant that
 * went in. They deliberately use a timezone that is *not* the app's shipped
 * default, so they fail if anyone reintroduces an assumed zone.
 */
class ExternalTimestampTest extends TestCase
{
    private const TEST_TZ = 'Asia/Tokyo'; // +09:00, deliberately not the shipped default

    protected function setUp(): void
    {
        parent::setUp();
        config(['app.timezone' => self::TEST_TZ]);
    }

    public function test_it_preserves_the_instant_of_a_plain_carbon_in_another_zone(): void
    {
        // 09:00 Tokyo is 00:00 UTC. `createFromTimestamp` in Carbon 3 returns
        // a plain Carbon\Carbon pinned to UTC, which is exactly what the
        // timeline pipeline hands over.
        $utc = BaseCarbon::createFromTimestamp(
            IlluminateCarbon::parse('2026-03-16 09:00:00', self::TEST_TZ)->getTimestamp()
        );

        $this->assertSame(0, $utc->getOffset(), 'precondition: Carbon 3 builds these at zero offset');
        $this->assertNotInstanceOf(
            IlluminateCarbon::class,
            $utc,
            'precondition: this is a plain Carbon\Carbon, which is what missed the old instanceof guard'
        );

        $result = ExternalTimestamp::parseToAppTimezone($utc);

        $this->assertNotNull($result);
        $this->assertSame('2026-03-16T09:00:00+09:00', $result->toIso8601String());
    }

    public function test_it_preserves_the_instant_of_a_native_datetime(): void
    {
        $native = new DateTimeImmutable('2026-03-16 00:00:00', new DateTimeZone('UTC'));

        $result = ExternalTimestamp::parseToAppTimezone($native);

        $this->assertNotNull($result);
        $this->assertSame('2026-03-16T09:00:00+09:00', $result->toIso8601String());
    }

    public function test_it_still_converts_an_illuminate_carbon(): void
    {
        $value = IlluminateCarbon::parse('2026-03-16 00:00:00', 'UTC');

        $result = ExternalTimestamp::parseToAppTimezone($value);

        $this->assertNotNull($result);
        $this->assertSame('2026-03-16T09:00:00+09:00', $result->toIso8601String());
    }

    public function test_it_does_not_mutate_the_value_it_was_given(): void
    {
        $utc = BaseCarbon::createFromTimestamp(0);

        ExternalTimestamp::parseToAppTimezone($utc);

        $this->assertSame(0, $utc->getOffset());
    }

    public function test_an_offset_bearing_string_keeps_its_instant(): void
    {
        $result = ExternalTimestamp::parseToAppTimezone('2026-03-16T00:00:00+00:00');

        $this->assertNotNull($result);
        $this->assertSame('2026-03-16T09:00:00+09:00', $result->toIso8601String());
    }

    public function test_from_timestamp_builds_in_the_app_timezone(): void
    {
        $epoch = IlluminateCarbon::parse('2026-03-16 09:00:00', self::TEST_TZ)->getTimestamp();

        $result = ExternalTimestamp::fromTimestamp($epoch);

        $this->assertSame(self::TEST_TZ, $result->getTimezone()->getName());
        $this->assertSame('2026-03-16T09:00:00+09:00', $result->toIso8601String());
        $this->assertSame($epoch, $result->getTimestamp());
    }

    /**
     * The day-bucketing half of the same defect: a UTC-pinned Carbon answers
     * `toDateString()` for the wrong calendar day for anything falling between
     * midnight and the app's UTC offset.
     */
    public function test_from_timestamp_buckets_early_morning_into_the_local_day(): void
    {
        // 01:00 Tokyo on the 16th is 16:00 UTC on the 15th.
        $epoch = IlluminateCarbon::parse('2026-03-16 01:00:00', self::TEST_TZ)->getTimestamp();

        $this->assertSame('2026-03-16', ExternalTimestamp::fromTimestamp($epoch)->toDateString());
    }
}
