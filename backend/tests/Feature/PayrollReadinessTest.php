<?php

namespace Tests\Feature;

use App\Models\EmployeeBankAccount;
use App\Models\EmployeeProfile;
use App\Models\EmployeeWorkInfo;
use App\Models\Organization;
use App\Models\User;
use App\Services\Lifecycle\PayrollReadinessService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Payroll readiness is the difference between "somebody ticked Upload PAN" and
 * "this person will actually be paid on the 1st". These tests pin the rules
 * that decide it, because each one maps to a real way a salary run fails.
 */
class PayrollReadinessTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    protected function setUp(): void
    {
        parent::setUp();
        $this->organization = Organization::factory()->create();
    }

    private function employee(array $profile = [], array $work = [], ?array $bank = null): User
    {
        $user = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);

        EmployeeProfile::create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            ...$profile,
        ]);

        EmployeeWorkInfo::create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'joining_date' => '2026-01-15',
            ...$work,
        ]);

        if ($bank !== null) {
            EmployeeBankAccount::create([
                'organization_id' => $this->organization->id,
                'user_id' => $user->id,
                'is_default' => true,
                ...$bank,
            ]);
        }

        return $user->fresh();
    }

    private function check(array $result, string $key): array
    {
        return collect($result['checks'])->firstWhere('key', $key);
    }

    public function test_a_malformed_pan_blocks_pay(): void
    {
        // Real shape seen in the wild: right idea, wrong format. A checkbox
        // would happily call this done.
        $user = $this->employee(['pan_number' => 'A7C3F04348']);

        $result = app(PayrollReadinessService::class)->evaluate($user);
        $pan = $this->check($result, 'pan');

        $this->assertFalse($pan['passed']);
        $this->assertSame(PayrollReadinessService::SEVERITY_BLOCKER, $pan['severity']);
        $this->assertFalse($result['ready']);
    }

    public function test_a_well_formed_pan_passes(): void
    {
        $user = $this->employee(['pan_number' => 'ABCDE1234F']);

        $this->assertTrue($this->check(app(PayrollReadinessService::class)->evaluate($user), 'pan')['passed']);
    }

    public function test_the_same_pan_on_two_people_is_flagged(): void
    {
        $this->employee(['pan_number' => 'ABCDE1234F']);
        $second = $this->employee(['pan_number' => 'ABCDE1234F']);

        $pan = $this->check(app(PayrollReadinessService::class)->evaluate($second), 'pan');

        $this->assertFalse($pan['passed'], 'A PAN shared by two employees means TDS is filed against the wrong person.');
        $this->assertStringContainsString('already recorded', $pan['detail']);
    }

    public function test_an_invalid_ifsc_blocks_pay(): void
    {
        $user = $this->employee(
            ['pan_number' => 'ABCDE1234F'],
            [],
            ['bank_name' => 'Axis Bank', 'account_number' => '4776953506', 'ifsc_swift' => '634417232'],
        );

        $bank = $this->check(app(PayrollReadinessService::class)->evaluate($user), 'bank');

        $this->assertFalse($bank['passed'], 'A numeric IFSC is rejected by the bank, so the transfer never lands.');
        $this->assertSame(PayrollReadinessService::SEVERITY_BLOCKER, $bank['severity']);
    }

    public function test_a_valid_ifsc_passes_and_masks_the_account_number(): void
    {
        $user = $this->employee(
            ['pan_number' => 'ABCDE1234F'],
            [],
            ['bank_name' => 'Axis Bank', 'account_number' => '47769535061815', 'ifsc_swift' => 'UTIB0001234'],
        );

        $bank = $this->check(app(PayrollReadinessService::class)->evaluate($user), 'bank');

        $this->assertTrue($bank['passed']);
        $this->assertStringContainsString('1815', $bank['detail']);
        $this->assertStringNotContainsString('47769535061815', $bank['detail'], 'The full account number must not be echoed back.');
    }

    public function test_a_missing_uan_warns_but_does_not_block_pay(): void
    {
        $user = $this->employee(
            ['pan_number' => 'ABCDE1234F'],
            [],
            ['bank_name' => 'Axis Bank', 'account_number' => '47769535061815', 'ifsc_swift' => 'UTIB0001234'],
        );

        $result = app(PayrollReadinessService::class)->evaluate($user);
        $uan = $this->check($result, 'uan');

        $this->assertFalse($uan['passed']);
        $this->assertSame(
            PayrollReadinessService::SEVERITY_WARNING,
            $uan['severity'],
            'Salary still moves without a UAN — only the PF ECR suffers, so this must not block pay.',
        );
    }

    public function test_a_missing_joining_date_blocks_pay(): void
    {
        $user = $this->employee(['pan_number' => 'ABCDE1234F'], ['joining_date' => null]);

        $joining = $this->check(app(PayrollReadinessService::class)->evaluate($user), 'joining_date');

        $this->assertFalse($joining['passed']);
        $this->assertSame(PayrollReadinessService::SEVERITY_BLOCKER, $joining['severity']);
    }

    public function test_score_reflects_how_many_checks_pass(): void
    {
        $bare = $this->employee();
        $result = app(PayrollReadinessService::class)->evaluate($bare);

        $this->assertGreaterThanOrEqual(0, $result['score']);
        $this->assertLessThanOrEqual(100, $result['score']);
        $this->assertGreaterThan(0, $result['blockers']);
        $this->assertFalse($result['ready']);
    }
}
