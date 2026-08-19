<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\PayrollMonthlyRun;
use App\Traits\Auditable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsPayrollFixture;
use Tests\TestCase;

/**
 * The audit trail must cover everything that touches money or identity.
 *
 * Before the Auditable trait existed, auditing was a call site a developer had
 * to remember: AuditLogService was invoked from 8 of 80 controllers, and
 * payroll runs, bank disbursement, statutory filings, role changes, exits and
 * performance reviews were all outside it. This test is the thing that stops
 * that happening again — adding a model to the list below and forgetting the
 * trait fails the build.
 */
class AuditCoverageTest extends TestCase
{
    use RefreshDatabase, BuildsPayrollFixture;

    /**
     * Models whose mutations an external auditor is entitled to see.
     *
     * Add to this list when a new model records money movement, statutory
     * identity, employment status or an authorisation decision.
     *
     * @return array<int, class-string>
     */
    public static function auditedModels(): array
    {
        return [
            // Money
            \App\Models\PayrollMonthlyRun::class,
            \App\Models\PayrollItem::class,
            \App\Models\PayrollOverride::class,
            \App\Models\BankTransferBatch::class,
            \App\Models\BankTransferItem::class,
            \App\Models\PaymentTransaction::class,
            \App\Models\PaymentReversal::class,
            \App\Models\FullAndFinalSettlement::class,
            \App\Models\ArrearPayment::class,
            \App\Models\EmployeeLoan::class,
            \App\Models\Reimbursement::class,
            \App\Models\LeaveEncashment::class,
            \App\Models\SalaryRevisionLetter::class,
            \App\Models\EmployeePayrollTemplate::class,

            // Statutory identity and filings
            \App\Models\PayrollFiling::class,
            \App\Models\EmployeeBankAccount::class,
            \App\Models\EmployeeGovernmentId::class,

            // Employment status
            \App\Models\EmployeeExit::class,
            \App\Models\Resignation::class,

            // Authorisation decisions
            \App\Models\Role::class,

            // Performance, because it feeds compensation decisions
            \App\Models\PerformanceReview::class,

            // Custody of company property
            \App\Models\Asset::class,
            \App\Models\AssetAssignment::class,
        ];
    }

    public function test_every_money_or_identity_model_is_auditable(): void
    {
        $missing = [];

        foreach (self::auditedModels() as $class) {
            if (! class_exists($class)) {
                $missing[] = "{$class} (class not found)";

                continue;
            }

            if (! in_array(Auditable::class, class_uses_recursive($class), true)) {
                $missing[] = $class;
            }
        }

        $this->assertSame(
            [],
            $missing,
            "These models mutate money or identity but write no audit trail:\n  "
                .implode("\n  ", $missing)
                ."\nAdd `use App\\Traits\\Auditable;` to each."
        );
    }

    /**
     * The audit log must never audit itself — that is an unbounded write loop
     * on the first entry.
     */
    public function test_the_audit_log_is_not_itself_auditable(): void
    {
        $this->assertNotContains(
            Auditable::class,
            class_uses_recursive(AuditLog::class),
            'Auditing the audit log recurses forever.'
        );
    }

    public function test_creating_an_audited_model_writes_a_trail_entry(): void
    {
        $this->buildPayrollFixture();
        $this->actingAs($this->admin);

        AuditLog::query()->delete();

        $run = PayrollMonthlyRun::create([
            'organization_id' => $this->organization->id,
            'month_year' => now()->format('Y-m'),
            'status' => 'draft',
        ]);

        $entry = AuditLog::where('action', 'payroll_monthly_run.created')
            ->where('target_id', $run->id)
            ->first();

        $this->assertNotNull($entry, 'Creating a payroll run must be recorded.');
        $this->assertSame($this->admin->id, $entry->actor_user_id);
        $this->assertSame($this->organization->id, $entry->organization_id);
        $this->assertSame('PayrollMonthlyRun', $entry->target_type);
    }

    public function test_updating_an_audited_model_records_before_and_after(): void
    {
        $this->buildPayrollFixture();
        $this->actingAs($this->admin);

        $run = PayrollMonthlyRun::create([
            'organization_id' => $this->organization->id,
            'month_year' => now()->format('Y-m'),
            'status' => 'draft',
        ]);

        AuditLog::query()->delete();

        $run->update(['status' => 'locked']);

        $entry = AuditLog::where('action', 'payroll_monthly_run.updated')->first();

        $this->assertNotNull($entry, 'Locking a run must be recorded.');
        $this->assertSame('locked', $entry->metadata['changed']['status'] ?? null);
        $this->assertSame('draft', $entry->metadata['previous']['status'] ?? null);
    }

    /**
     * A save that changes nothing auditable is noise. Recording it buries the
     * entries that matter.
     */
    public function test_an_update_that_changes_nothing_auditable_writes_no_entry(): void
    {
        $this->buildPayrollFixture();
        $this->actingAs($this->admin);

        $run = PayrollMonthlyRun::create([
            'organization_id' => $this->organization->id,
            'month_year' => now()->format('Y-m'),
            'status' => 'draft',
        ]);

        AuditLog::query()->delete();

        $run->touch();

        $this->assertSame(
            0,
            AuditLog::where('action', 'payroll_monthly_run.updated')->count(),
            'A timestamp touch is not an auditable change.'
        );
    }

    public function test_saveQuietly_is_the_documented_escape_hatch_and_still_bypasses_the_trail(): void
    {
        $this->buildPayrollFixture();
        $this->actingAs($this->admin);

        $run = PayrollMonthlyRun::create([
            'organization_id' => $this->organization->id,
            'month_year' => now()->format('Y-m'),
            'status' => 'draft',
        ]);

        AuditLog::query()->delete();

        $run->status = 'locked';
        $run->saveQuietly();

        // Asserted rather than lamented: several backfill and reclassification
        // commands rely on saveQuietly to avoid flooding the trail, and that is
        // legitimate. The point of pinning it is that it stays a deliberate,
        // greppable choice rather than an accident.
        $this->assertSame(0, AuditLog::where('action', 'payroll_monthly_run.updated')->count());
    }
}
