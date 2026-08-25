<?php

namespace Tests\Feature;

use App\Models\Activity;
use App\Models\EmployeeWorkInfo;
use App\Models\Organization;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * A timeline row already carries its employee's UTC offset, because
 * ActivityController renders every timestamp in that person's resolved zone.
 * An offset is not a zone though, and the client cannot label "+08:00" as
 * Manila — so a viewer in Mumbai sees a colleague's 09:00 start drawn at
 * 05:30 with nothing on screen saying why.
 *
 * The row therefore has to name the zone as well as offset by it. Verified on
 * a real two-office org 19 Aug 2026: the engine was already correct and only
 * the label was missing.
 */
class TimelineRowTimezoneTest extends TestCase
{
    use RefreshDatabase;

    public function test_each_timeline_row_names_the_employee_timezone(): void
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance']);

        $mumbai = $this->makeUser($organization, 'mumbai@carevance.test', 'admin');
        $manila = $this->makeUser($organization, 'manila@carevance.test', 'employee');

        // Only Manila overrides; Mumbai inherits the app default.
        EmployeeWorkInfo::create([
            'organization_id' => $organization->id,
            'user_id' => $manila->id,
            'expected_timezone' => 'Asia/Manila',
        ]);

        // Both people worked 09:00-10:00 in their OWN wall clock.
        $this->recordHourFor($mumbai, '2026-08-19 10:00:00', 'Asia/Kolkata');
        $this->recordHourFor($manila, '2026-08-19 10:00:00', 'Asia/Manila');

        $rows = collect($this->getJson(
            '/api/activities?start_date=2026-08-19&end_date=2026-08-19&processed=true',
            $this->apiHeadersFor($mumbai)
        )->assertOk()->json('data') ?? []);

        $mumbaiRow = $rows->firstWhere('user_id', $mumbai->id);
        $manilaRow = $rows->firstWhere('user_id', $manila->id);

        $this->assertNotNull($mumbaiRow, 'expected a row for the Mumbai employee');
        $this->assertNotNull($manilaRow, 'expected a row for the Manila employee');

        // The zone must be named, not merely implied by the offset.
        $this->assertSame('Asia/Kolkata', $mumbaiRow['timezone'] ?? null);
        $this->assertSame('Asia/Manila', $manilaRow['timezone'] ?? null);

        // And the timestamps still carry each person's own offset.
        $this->assertStringContainsString('+05:30', (string) $mumbaiRow['recorded_at']);
        $this->assertStringContainsString('+08:00', (string) $manilaRow['recorded_at']);
    }

    private function recordHourFor(User $user, string $endsAtLocal, string $timezone): void
    {
        $endsAt = Carbon::parse($endsAtLocal, $timezone)->setTimezone(config('app.timezone'));

        Activity::create([
            'user_id' => $user->id,
            'type' => 'app',
            'name' => 'Timeline row for '.$user->email,
            'app_name' => 'Editor',
            'duration' => 3600,
            'recorded_at' => $endsAt,
        ]);
    }

    private function makeUser(Organization $organization, string $email, string $role): User
    {
        $user = User::create([
            'name' => ucfirst(strtok($email, '@')),
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $organization->id,
        ]);

        // Stamps organization_id on fixtures the test creates directly after
        // this call, the same way BelongsToOrganization would from a real
        // authenticated request.
        Auth::setUser($user);

        return $user;
    }
}
