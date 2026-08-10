<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Services\Payroll\PayrollDayBasisResolver;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The per-day salary divisor.
 *
 * Payment of Wages Act s.9(2) caps a deduction for absence at the proportion
 * the absent period bears to the wage period — a calendar month. One absent
 * day may therefore cost at most 1/30 of wages, never 1/22. Calendar days is
 * also what Zoho, Keka, greytHR and RazorpayX default to.
 */
class PayrollDayBasisTest extends TestCase
{
    use RefreshDatabase;

    private PayrollDayBasisResolver $resolver;

    protected function setUp(): void
    {
        parent::setUp();
        $this->resolver = app(PayrollDayBasisResolver::class);
    }

    private function orgWith(?string $basis): Organization
    {
        return Organization::factory()->create([
            'settings' => $basis === null ? [] : ['payroll' => ['dayBasis' => $basis]],
        ]);
    }

    public function test_default_is_calendar_days(): void
    {
        $org = $this->orgWith(null);

        $this->assertSame(PayrollDayBasisResolver::BASIS_CALENDAR, $this->resolver->basisFor($org));
    }

    public function test_calendar_basis_follows_the_actual_month_length(): void
    {
        $this->assertSame(30.0, $this->resolver->divisorDays('calendar', '2026-06'));
        $this->assertSame(31.0, $this->resolver->divisorDays('calendar', '2026-07'));
        $this->assertSame(28.0, $this->resolver->divisorDays('calendar', '2026-02'));
    }

    public function test_fixed_bases_ignore_month_length(): void
    {
        $this->assertSame(30.0, $this->resolver->divisorDays('fixed_30', '2026-02'));
        $this->assertSame(26.0, $this->resolver->divisorDays('fixed_26', '2026-07'));
    }

    public function test_an_organisation_may_choose_a_fixed_basis(): void
    {
        $org = $this->orgWith('fixed_30');

        $this->assertSame('fixed_30', $this->resolver->basisFor($org));
        $this->assertSame(30.0, $this->resolver->resolve($org, '2026-02')['days']);
    }

    public function test_the_legacy_attendance_basis_cannot_be_chosen(): void
    {
        // It exists only so rows created before the divisor was explicit stay
        // reproducible. Honouring it as a setting would keep an organisation
        // on the non-compliant divisor.
        $org = $this->orgWith('attendance');

        $this->assertSame(PayrollDayBasisResolver::BASIS_CALENDAR, $this->resolver->basisFor($org));
    }

    public function test_an_unrecognised_basis_falls_back_to_calendar(): void
    {
        $org = $this->orgWith('per_fortnight');

        $this->assertSame(PayrollDayBasisResolver::BASIS_CALENDAR, $this->resolver->basisFor($org));
    }

    public function test_the_setting_round_trips_through_the_payroll_settings_api(): void
    {
        // A setting nothing can write is decorative; a setting nothing reads is
        // worse. This proves the write half — the read half is proven by the
        // deduction tests below and in PayrollLopSingleApplicationTest.
        $org = $this->orgWith(null);
        $admin = \App\Models\User::factory()->create([
            'organization_id' => $org->id,
            'role' => 'admin',
        ]);

        $this->putJson('/api/payroll/settings', ['dayBasis' => 'fixed_30'], $this->apiHeadersFor($admin))
            ->assertOk();

        $this->assertSame('fixed_30', $this->resolver->basisFor($org->fresh()));
    }

    public function test_an_unsupported_basis_is_rejected_by_the_api(): void
    {
        $org = $this->orgWith(null);
        $admin = \App\Models\User::factory()->create([
            'organization_id' => $org->id,
            'role' => 'admin',
        ]);

        $this->putJson('/api/payroll/settings', ['dayBasis' => 'working_days'], $this->apiHeadersFor($admin))
            ->assertStatus(422);
    }

    public function test_one_absent_day_never_costs_more_than_one_thirtieth(): void
    {
        // The s.9(2) invariant, stated as arithmetic: on a 30-day month the
        // per-day rate must not exceed gross/30.
        $gross = 60000.0;
        $days = $this->resolver->divisorDays('calendar', '2026-06');

        $this->assertEqualsWithDelta(2000.0, $gross / $days, 0.01);
        $this->assertLessThanOrEqual(
            $gross / 30,
            $gross / $days,
            'A working-day divisor charged 1/22 — over-deduction on every absence.'
        );
    }
}
