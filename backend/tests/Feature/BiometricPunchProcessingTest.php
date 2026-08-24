<?php

namespace Tests\Feature;

use App\Models\AttendanceRecord;
use App\Models\BiometricDevice;
use App\Models\BiometricPunch;
use App\Models\Organization;
use App\Models\User;
use App\Services\Attendance\BiometricPunchProcessor;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Device readings becoming attendance.
 *
 * The two things that quietly corrupt a day: pairing readings in the wrong
 * order, and filing a buffered punch under the wrong date. Both are silent —
 * attendance simply comes out wrong, and nobody can tell from the record that
 * the hardware was fine.
 */
class BiometricPunchProcessingTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $employee;
    private BiometricDevice $device;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-bio-process']);

        $this->employee = User::create([
            'name' => 'Kajal',
            'email' => 'kajal@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);

        $this->device = BiometricDevice::query()->create([
            'organization_id' => $this->organization->id,
            'serial_number' => 'ESSL999',
            'name' => 'Reception',
            'is_active' => true,
        ]);
    }

    private function punch(string $at, ?User $user = null): BiometricPunch
    {
        return BiometricPunch::query()->create([
            'organization_id' => $this->organization->id,
            'biometric_device_id' => $this->device->id,
            'device_user_id' => '42',
            'user_id' => ($user ?? $this->employee)->id,
            'punched_at' => Carbon::parse($at, config('app.timezone')),
            // Deliberately the SAME status on every reading: this is what real
            // devices send, because everybody presses the same key.
            'device_status' => '0',
        ]);
    }

    private function process(): array
    {
        return app(BiometricPunchProcessor::class)->processPending();
    }

    private function record(): ?AttendanceRecord
    {
        return AttendanceRecord::withoutOrganizationScope()
            ->where('user_id', $this->employee->id)
            ->first();
    }

    public function test_a_morning_and_evening_reading_become_a_days_attendance(): void
    {
        $this->punch('2026-08-20 09:15:00');
        $this->punch('2026-08-20 18:02:00');

        $this->process();

        $record = $this->record();

        $this->assertNotNull($record, 'no attendance was created from the punches');
        $this->assertSame('2026-08-20', Carbon::parse($record->attendance_date)->toDateString());
        $this->assertNotNull($record->check_in_at);
        $this->assertNotNull($record->check_out_at);
    }

    public function test_the_punch_time_is_used_rather_than_the_time_it_was_processed(): void
    {
        /*
         * The whole reason this goes through the offline-sync path. A device
         * buffers readings while the network is down and replays them later;
         * stamping now() would file a 9am arrival at whatever time the batch
         * happened to arrive, and mark everybody late.
         */
        $this->punch('2026-08-20 09:15:00');

        $this->process();

        $checkIn = Carbon::parse($this->record()->check_in_at)->setTimezone(config('app.timezone'));

        $this->assertSame('09:15:00', $checkIn->format('H:i:s'));
        $this->assertSame('2026-08-20', $checkIn->toDateString());
    }

    public function test_direction_comes_from_the_sequence_not_the_device_status(): void
    {
        /*
         * Every reading above carries the same device_status. Trusting it would
         * make each punch an IN, so nobody ever leaves and every day stays
         * open. The sequence is the only honest signal.
         */
        $this->punch('2026-08-20 09:15:00');
        $this->punch('2026-08-20 18:02:00');

        $this->process();

        $results = BiometricPunch::withoutOrganizationScope()->orderBy('punched_at')->pluck('process_result')->all();

        $this->assertSame(['checked_in', 'checked_out'], $results);
    }

    public function test_punches_are_not_processed_twice(): void
    {
        // The command runs every five minutes; a punch already folded into
        // attendance must not open a second one.
        $this->punch('2026-08-20 09:15:00');
        $this->punch('2026-08-20 18:02:00');

        $first = $this->process();
        $second = $this->process();

        $this->assertSame(2, $first['processed']);
        $this->assertSame(0, $second['processed'], 'a second run reprocessed punches');
    }

    public function test_an_unclaimed_device_id_is_left_for_later_not_discarded(): void
    {
        /*
         * A new joiner enrolled on the device before an admin claimed their id.
         * Discarding these would silently lose somebody's day because a mapping
         * was late; they become attendance on the next run once claimed.
         */
        BiometricPunch::query()->create([
            'organization_id' => $this->organization->id,
            'biometric_device_id' => $this->device->id,
            'device_user_id' => '77',
            'user_id' => null,
            'punched_at' => Carbon::parse('2026-08-20 09:15:00', config('app.timezone')),
        ]);

        $result = $this->process();

        $this->assertSame(1, $result['unmapped']);
        $this->assertNull(
            BiometricPunch::withoutOrganizationScope()->where('device_user_id', '77')->first()->processed_at,
            'an unmapped punch was consumed and can never be recovered',
        );
    }

    public function test_a_claimed_id_turns_yesterdays_backlog_into_attendance(): void
    {
        // The other half of the above: once an admin claims the id, the punches
        // that were waiting are processed.
        $punch = BiometricPunch::query()->create([
            'organization_id' => $this->organization->id,
            'biometric_device_id' => $this->device->id,
            'device_user_id' => '77',
            'user_id' => null,
            'punched_at' => Carbon::parse('2026-08-20 09:15:00', config('app.timezone')),
        ]);

        $this->process();
        $this->assertNull($punch->fresh()->processed_at);

        $punch->forceFill(['user_id' => $this->employee->id])->save();
        $this->process();

        $this->assertNotNull($punch->fresh()->processed_at);
        $this->assertNotNull($this->record());
    }

    public function test_punches_do_not_pair_across_a_day_boundary(): void
    {
        /*
         * Somebody who forgets to punch out. Pairing yesterday's lone reading
         * with this morning's would close yesterday at 9am today and record an
         * overnight shift nobody worked.
         */
        $this->punch('2026-08-20 09:15:00');
        $this->punch('2026-08-21 09:10:00');

        $this->process();

        $dates = AttendanceRecord::withoutOrganizationScope()
            ->where('user_id', $this->employee->id)
            ->pluck('attendance_date')
            ->map(fn ($date) => Carbon::parse($date)->toDateString())
            ->sort()
            ->values()
            ->all();

        $this->assertSame(['2026-08-20', '2026-08-21'], $dates, 'punches paired across midnight');
    }

    public function test_unmapped_ids_are_reported_so_somebody_can_fix_them(): void
    {
        // "47 punches unmapped" is not actionable. "Device id 77 has 3 punches
        // and nobody has claimed it" is.
        foreach (['2026-08-20 09:00:00', '2026-08-20 13:00:00', '2026-08-20 18:00:00'] as $at) {
            BiometricPunch::query()->create([
                'organization_id' => $this->organization->id,
                'biometric_device_id' => $this->device->id,
                'device_user_id' => '77',
                'user_id' => null,
                'punched_at' => Carbon::parse($at, config('app.timezone')),
            ]);
        }

        $summary = app(BiometricPunchProcessor::class)->unmappedSummary($this->organization->id);

        $this->assertCount(1, $summary);
        $this->assertSame('77', $summary->first()->device_user_id);
        $this->assertSame(3, (int) $summary->first()->punch_count);
    }
}
