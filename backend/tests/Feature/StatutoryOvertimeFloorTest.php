<?php

namespace Tests\Feature;

use App\Models\EmployeeShift;
use App\Models\LegalEntity;
use App\Models\Organization;
use App\Models\OvertimePolicy;
use App\Models\OvertimePolicyScope;
use App\Models\Shift;
use App\Models\User;
use App\Services\Attendance\OvertimeAssessment;
use App\Services\Attendance\OvertimeEngine;
use App\Services\Attendance\StatutoryLimits;
use App\Services\Attendance\StatutoryWorkingTime;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The statutory floor under a configured overtime rate.
 *
 * Section 59 of the Factories Act entitles a worker to twice the ordinary rate.
 * A product that lets an employer configure 1.5x and then quietly pays it is
 * not neutral — it is the instrument of the underpayment.
 *
 * But raising a live payroll's overtime rate because somebody deployed a
 * release is equally not this engine's decision, so the floor is computed
 * always and APPLIED only where the establishment has switched enforcement on.
 * Both halves of that are tested here, because getting either one wrong is a
 * money bug nobody sees until an inspection.
 */
class StatutoryOvertimeFloorTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $employee;
    private LegalEntity $entity;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-ot-floor']);

        $this->entity = LegalEntity::query()->create([
            'organization_id' => $this->organization->id,
            'name' => 'CareVance Manufacturing',
            'state' => 'Karnataka',
            'is_primary' => true,
            'is_active' => true,
        ]);

        $this->employee = User::create([
            'name' => 'Ramesh',
            'email' => 'ramesh@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
            'legal_entity_id' => $this->entity->id,
        ]);
    }

    /** A policy paying $multiplier on a working day, with an 8h shift rostered. */
    private function policyPaying(string $multiplier): void
    {
        $shift = Shift::query()->create([
            'organization_id' => $this->organization->id,
            'name' => 'General',
            'code' => 'GEN-OT-FLOOR',
            'start_time' => '09:00',
            'end_time' => '17:00',
            'duration_minutes' => 8 * 60,
            'break_duration_minutes' => 0,
            'is_active' => true,
        ]);

        EmployeeShift::query()->create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'shift_id' => $shift->id,
            'effective_from' => now()->subYear()->toDateString(),
            'is_active' => true,
        ]);

        $policy = OvertimePolicy::query()->create([
            'organization_id' => $this->organization->id,
            'name' => 'Standard',
            'hours_basis' => OvertimePolicy::BASIS_GROSS,
            'is_default' => true,
            'is_active' => true,
        ]);

        OvertimePolicyScope::query()->create([
            'organization_id' => $this->organization->id,
            'overtime_policy_id' => $policy->id,
            'scope' => OvertimePolicyScope::SCOPE_WORKING_DAY,
            'treatment' => OvertimePolicyScope::TREATMENT_PAY,
            'multiplier' => $multiplier,
            'applies_after_minutes' => 0,
        ]);
    }

    private function assess(): OvertimeAssessment
    {
        // A Wednesday, so it is a plain working day rather than a weekly off.
        $date = now()->startOfWeek()->addDays(2);

        return app(OvertimeEngine::class)->evaluate(
            user: $this->employee->fresh(),
            date: $date,
            grossMinutes: 10 * 60,
            effectiveMinutes: 10 * 60,
            approved: true,
        );
    }

    public function test_an_unregulated_establishment_asserts_no_floor_at_all(): void
    {
        $this->policyPaying('1.50');

        $assessment = $this->assess();

        // "Nobody has told us what this place is" must not become "a factory".
        // Inventing a floor here would flag every software company in the
        // customer base as underpaying.
        $this->assertNull($assessment->statutoryMultiplierFloor);
        $this->assertFalse($assessment->isBelowStatutoryFloor());
        $this->assertSame('1.50', $assessment->multiplier);
    }

    public function test_a_factory_reports_the_shortfall_without_changing_pay(): void
    {
        $this->entity->update(['establishment_type' => StatutoryLimits::FACTORY]);
        $this->policyPaying('1.50');

        $assessment = $this->assess();

        // Reported...
        $this->assertSame('2.00', $assessment->statutoryMultiplierFloor);
        $this->assertTrue($assessment->isBelowStatutoryFloor());
        $this->assertSame('0.50', $assessment->statutoryShortfall());

        // ...and NOT applied. Enforcement is off, so pay is exactly what was
        // configured. A release must not silently change what people are paid.
        $this->assertSame('1.50', $assessment->multiplier);
        $this->assertSame(OvertimeAssessment::MULTIPLIER_FROM_POLICY_SCOPE, $assessment->multiplierSource);
    }

    public function test_switching_enforcement_on_lifts_the_rate_to_the_floor(): void
    {
        $this->entity->update([
            'establishment_type' => StatutoryLimits::FACTORY,
            'enforce_overtime_floor' => true,
        ]);
        $this->policyPaying('1.50');

        $assessment = $this->assess();

        $this->assertSame('2.00', $assessment->multiplier);
        $this->assertSame(OvertimeAssessment::MULTIPLIER_FROM_STATUTORY_FLOOR, $assessment->multiplierSource);

        // The configured rate survives alongside it, because "we paid 2x
        // because the law says so, and your policy says 1.5x" is the sentence
        // a compliance report has to be able to say.
        $this->assertSame('1.50', $assessment->configuredMultiplier);
        $this->assertTrue($assessment->isBelowStatutoryFloor());
    }

    public function test_a_rate_above_the_floor_is_never_pulled_down_to_it(): void
    {
        $this->entity->update([
            'establishment_type' => StatutoryLimits::FACTORY,
            'enforce_overtime_floor' => true,
        ]);
        $this->policyPaying('2.50');

        $assessment = $this->assess();

        // It is a floor, not a rate. A generous holiday policy must survive it.
        $this->assertSame('2.50', $assessment->multiplier);
        $this->assertFalse($assessment->isBelowStatutoryFloor());
        $this->assertNull($assessment->statutoryShortfall());
    }

    public function test_the_floor_reaches_the_money(): void
    {
        $this->entity->update([
            'establishment_type' => StatutoryLimits::FACTORY,
            'enforce_overtime_floor' => true,
        ]);
        $this->policyPaying('1.50');

        // Two hours of overtime at 100/hour: 300 at the configured rate, 400 at
        // the statutory one. The floor is worthless if it stops at the report.
        $this->assertSame('400.00', $this->assess()->amountForHourlyRate('100'));
    }

    public function test_an_exemption_may_relax_the_rest_interval_but_never_tighten_it(): void
    {
        $this->entity->update([
            'establishment_type' => StatutoryLimits::FACTORY,
            'rest_interval_exemption_minutes' => 360,
        ]);

        // Resolved freshly each time: the entity resolver memoises per user for
        // the life of a request, which is right in production and would make
        // this test assert against a cached answer.
        $limits = fn () => app()->make(StatutoryWorkingTime::class)->forUser($this->employee->fresh());

        // Section 55 permits the Chief Inspector to allow six hours in place of
        // five, in writing.
        $this->assertSame(360, $limits()->maxContinuousWorkMinutes);

        // A shorter value is a data-entry mistake, not a stricter policy to
        // obey: honouring it would manufacture breaches the law does not
        // require, and a report that cries wolf gets switched off.
        $this->entity->update(['rest_interval_exemption_minutes' => 120]);
        $this->assertSame(300, $limits()->maxContinuousWorkMinutes);
    }

    public function test_shops_and_establishments_asserts_only_what_is_common_across_states(): void
    {
        $this->entity->update(['establishment_type' => StatutoryLimits::SHOPS_ESTABLISHMENT]);

        $limits = app(StatutoryWorkingTime::class)->forUser($this->employee->fresh());

        // Twice the ordinary rate and a 48-hour week hold across the major
        // states; the daily ceiling and spread-over genuinely differ, so they
        // are left unasserted rather than guessed. A wrong limit reports a
        // breach that is not one.
        $this->assertSame('2.00', $limits->overtimeMultiplierFloor);
        $this->assertSame(48 * 60, $limits->maxWeeklyMinutes);
        $this->assertNull($limits->maxDailyMinutes);
        $this->assertNull($limits->maxSpreadOverMinutes);
    }
}
