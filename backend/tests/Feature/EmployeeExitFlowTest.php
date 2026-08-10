<?php

namespace Tests\Feature;

use App\Models\Asset;
use App\Models\AssetAssignment;
use App\Models\ChecklistItem;
use App\Models\EmployeeExit;
use App\Models\EmployeeWorkInfo;
use App\Models\Organization;
use App\Models\Resignation;
use App\Models\User;
use App\Services\Lifecycle\ExitService;
use App\Services\Lifecycle\NoticePeriodService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Approving a resignation used to write three columns and stop. These cover the
 * process that now runs behind it — and the one rule that matters most: nobody
 * gets settled while they still hold company equipment.
 */
class EmployeeExitFlowTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;
    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'Org', 'slug' => 'org-exits']);
        $this->admin = $this->member('admin', 'exit-admin@example.com');
        $this->employee = $this->member('employee', 'exit-employee@example.com');
    }

    private function member(string $role, string $email): User
    {
        return User::create([
            'name' => ucfirst($role),
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $this->organization->id,
        ]);
    }

    private function assignAsset(User $to, string $name = 'MacBook Pro'): AssetAssignment
    {
        $asset = Asset::create([
            'organization_id' => $this->organization->id,
            'asset_tag' => 'AST-'.uniqid(),
            'name' => $name,
            'category' => 'laptop',
            'status' => 'assigned',
        ]);

        return AssetAssignment::create([
            'organization_id' => $this->organization->id,
            'asset_id' => $asset->id,
            'user_id' => $to->id,
            'assigned_date' => now()->subMonths(6)->toDateString(),
        ]);
    }

    private function exits(): ExitService
    {
        return app(ExitService::class);
    }

    /** Tokens are plain rows here, not a Sanctum relation. */
    private function tokenCountFor(User $user): int
    {
        return DB::table('personal_access_tokens')
            ->where('tokenable_type', User::class)
            ->where('tokenable_id', $user->id)
            ->count();
    }

    public function test_approving_a_resignation_opens_an_exit_with_a_clearance_checklist(): void
    {
        $resignation = Resignation::create([
            'user_id' => $this->employee->id,
            'organization_id' => $this->organization->id,
            'last_working_date' => now()->addDays(30)->toDateString(),
            'status' => 'pending',
        ]);

        $this->postJson(
            "/api/resignations/{$resignation->id}/approve",
            [],
            $this->apiHeadersFor($this->admin)
        )->assertOk();

        $exit = EmployeeExit::where('resignation_id', $resignation->id)->first();

        $this->assertNotNull($exit, 'Approval must open an exit');
        $this->assertSame(EmployeeExit::STAGE_NOTICE, $exit->stage);
        $this->assertGreaterThan(0, $exit->checklistItems()->count(), 'Clearance must be generated');
    }

    public function test_an_unreturned_asset_becomes_a_blocking_clearance_item(): void
    {
        $assignment = $this->assignAsset($this->employee);

        $exit = $this->exits()->open(
            user: $this->employee,
            lastWorkingDate: now()->addDays(30),
            initiator: $this->admin,
        );

        $item = ChecklistItem::forSubject($exit)
            ->where('asset_assignment_id', $assignment->id)
            ->first();

        $this->assertNotNull($item, 'Equipment still held must appear on the checklist');
        $this->assertTrue($item->is_blocking);
        $this->assertStringContainsString('MacBook Pro', $item->title);
    }

    public function test_settlement_is_refused_while_a_blocking_item_is_outstanding(): void
    {
        $this->assignAsset($this->employee);

        $exit = $this->exits()->open(
            user: $this->employee,
            lastWorkingDate: now()->addDays(30),
            initiator: $this->admin,
        );

        $this->assertFalse($exit->canEnterSettlement());

        $this->postJson(
            "/api/exits/{$exit->id}/advance",
            ['stage' => 'settlement'],
            $this->apiHeadersFor($this->admin)
        )
            ->assertStatus(422)
            ->assertJsonPath('message', fn ($message) => str_contains($message, 'Clearance is not complete'));

        $this->assertSame(EmployeeExit::STAGE_NOTICE, $exit->fresh()->stage);
    }

    public function test_completing_an_asset_item_books_the_asset_back_in(): void
    {
        $assignment = $this->assignAsset($this->employee);

        $exit = $this->exits()->open(
            user: $this->employee,
            lastWorkingDate: now()->addDays(30),
            initiator: $this->admin,
        );

        $item = ChecklistItem::forSubject($exit)
            ->where('asset_assignment_id', $assignment->id)
            ->firstOrFail();

        $this->postJson(
            "/api/exits/{$exit->id}/items/{$item->id}/complete",
            [],
            $this->apiHeadersFor($this->admin)
        )->assertOk();

        // The checklist and the asset register must not be able to disagree.
        $this->assertNotNull($assignment->fresh()->returned_date);
        $this->assertSame('available', $assignment->fresh()->asset->status);
    }

    public function test_settlement_opens_once_every_blocking_item_is_settled(): void
    {
        $exit = $this->exits()->open(
            user: $this->employee,
            lastWorkingDate: now()->addDays(30),
            initiator: $this->admin,
        );

        ChecklistItem::forSubject($exit)->where('is_blocking', true)->update([
            'status' => ChecklistItem::STATUS_DONE,
            'completed_at' => now(),
        ]);

        $this->postJson(
            "/api/exits/{$exit->id}/advance",
            ['stage' => 'settlement'],
            $this->apiHeadersFor($this->admin)
        )->assertOk();

        $fresh = $exit->fresh();
        $this->assertSame(EmployeeExit::STAGE_SETTLEMENT, $fresh->stage);
        $this->assertNotNull($fresh->clearance_completed_at);
    }

    public function test_revoking_access_deactivates_the_account_and_kills_its_tokens(): void
    {
        $exit = $this->exits()->open(
            user: $this->employee,
            lastWorkingDate: now()->subDay(),
            initiator: $this->admin,
        );

        $this->issueApiToken($this->employee, 'desktop');
        $this->assertSame(1, $this->tokenCountFor($this->employee));

        $this->exits()->revokeAccess($exit);

        $this->assertNotNull($this->employee->fresh()->deactivated_at);
        $this->assertFalse($this->employee->fresh()->is_active);
        $this->assertSame(0, $this->tokenCountFor($this->employee), 'A live session must not outlive the account');
        $this->assertNotNull($exit->fresh()->access_revoked_at);
    }

    public function test_a_deactivated_account_is_refused_even_with_a_valid_bearer(): void
    {
        // Deleting tokens is not enough on its own: anything that mints a fresh
        // one later would hand access straight back.
        $headers = $this->apiHeadersFor($this->employee);

        $this->getJson('/api/resignations/my', $headers)->assertOk();

        $this->employee->forceFill(['deactivated_at' => now()])->save();

        $this->getJson('/api/resignations/my', $headers)
            ->assertStatus(403)
            ->assertJsonPath('error_code', 'ACCOUNT_DEACTIVATED');
    }

    public function test_the_scheduled_sweep_only_revokes_exits_past_their_last_working_day(): void
    {
        $future = $this->exits()->open(
            user: $this->employee,
            lastWorkingDate: now()->addDays(10),
            initiator: $this->admin,
        );

        $leaver = $this->member('employee', 'already-gone@example.com');
        $past = $this->exits()->open(
            user: $leaver,
            lastWorkingDate: now()->subDays(2),
            initiator: $this->admin,
        );

        $this->artisan('lifecycle:process')->assertExitCode(0);

        $this->assertNull($future->fresh()->access_revoked_at, 'Somebody still serving notice keeps access');
        $this->assertNotNull($past->fresh()->access_revoked_at);
    }

    public function test_opening_an_exit_twice_does_not_create_a_second_one(): void
    {
        $first = $this->exits()->open(
            user: $this->employee,
            lastWorkingDate: now()->addDays(30),
            initiator: $this->admin,
        );

        $second = $this->exits()->open(
            user: $this->employee,
            lastWorkingDate: now()->addDays(45),
            initiator: $this->admin,
        );

        $this->assertSame($first->id, $second->id);
        $this->assertSame(1, EmployeeExit::where('user_id', $this->employee->id)->count());
    }

    public function test_hr_can_open_a_termination_which_no_resignation_could_express(): void
    {
        $this->postJson('/api/exits', [
            'user_id' => $this->employee->id,
            'last_working_date' => now()->addDays(7)->toDateString(),
            'exit_type' => 'termination',
            'reason' => 'Role eliminated',
        ], $this->apiHeadersFor($this->admin))->assertCreated();

        $exit = EmployeeExit::where('user_id', $this->employee->id)->firstOrFail();
        $this->assertSame('termination', $exit->exit_type);
        $this->assertNull($exit->resignation_id);
    }

    public function test_notice_shortfall_is_computed_against_the_policy(): void
    {
        $notice = app(NoticePeriodService::class);

        // 30-day default, serving only 10 → 20 short.
        $evaluation = $notice->evaluate(
            $this->employee,
            now()->addDays(9),
            now()
        );

        $this->assertSame(30, $evaluation['required']);
        $this->assertSame(10, $evaluation['served']);
        $this->assertSame(20, $evaluation['shortfall']);
    }

    public function test_a_personal_notice_period_overrides_the_organisation_default(): void
    {
        EmployeeWorkInfo::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'meta' => ['notice_period_days' => 60],
        ]);

        $this->assertSame(
            60,
            app(NoticePeriodService::class)->daysFor($this->employee->fresh())
        );
    }

    public function test_an_employee_cannot_read_the_exit_pipeline(): void
    {
        $this->getJson('/api/exits', $this->apiHeadersFor($this->employee))->assertStatus(403);
    }
}
