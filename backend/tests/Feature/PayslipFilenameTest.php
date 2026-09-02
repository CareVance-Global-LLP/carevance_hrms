<?php

namespace Tests\Feature;

use App\Models\EmployeePayrollTemplate;
use App\Models\Organization;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A downloaded payslip has to be identifiable in a Downloads folder.
 *
 * The filename was `payslip_361_2026-08.pdf` — an internal user id and a
 * numeric month. Somebody saving three months of payslips got three files they
 * had to open to tell apart, and the id means nothing outside the database.
 */
class PayslipFilenameTest extends TestCase
{
    use RefreshDatabase;

    private function itemFor(string $name, string $monthYear): array
    {
        $org = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $org->id, 'role' => 'admin']);
        $employee = User::factory()->create([
            'organization_id' => $org->id,
            'role' => 'employee',
            'name' => $name,
        ]);

        EmployeePayrollTemplate::getOrCreateForUser($employee->id, $org->id);
        \DB::table('employee_payroll_templates')
            ->where('user_id', $employee->id)
            ->update(['annual_ctc' => 600000, 'is_active' => true]);

        $run = PayrollMonthlyRun::create([
            'organization_id' => $org->id,
            'month_year' => $monthYear,
            'status' => 'draft',
        ]);

        PayrollItem::create([
            'organization_id' => $org->id,
            'payroll_run_id' => $run->id,
            'user_id' => $employee->id,
            'month_year' => $monthYear,
            'basic' => 20000,
            'gross_salary' => 47238,
            'total_deductions' => 2000,
            'net_pay' => 45238,
        ]);

        return [$admin, $employee];
    }

    public function test_the_download_is_named_for_the_person_and_the_month(): void
    {
        [$admin, $employee] = $this->itemFor('Akash Vijaykumar', '2026-08');

        $response = $this->actingAs($admin)
            ->get("/api/payroll/payslip/{$employee->id}/2026-08/download");

        $response->assertOk();
        $this->assertStringContainsString(
            'filename="payslip_Akash_Vijaykumar_August_2026.pdf"',
            $response->headers->get('content-disposition'),
            'the month must be a name a person reads, not 2026-08'
        );
    }

    public function test_the_inline_view_uses_the_same_name(): void
    {
        [$admin, $employee] = $this->itemFor('Akash Vijaykumar', '2026-08');

        $response = $this->actingAs($admin)
            ->get("/api/payroll/payslip/{$employee->id}/2026-08/view");

        $response->assertOk();
        $disposition = $response->headers->get('content-disposition');

        $this->assertStringContainsString('inline;', $disposition, 'the viewer still renders in-tab');
        $this->assertStringContainsString('payslip_Akash_Vijaykumar_August_2026.pdf', $disposition);
    }

    public function test_a_name_with_punctuation_cannot_break_the_download(): void
    {
        // A slash or a colon in a filename fails outright on Windows.
        [$admin, $employee] = $this->itemFor("D'Souza / Maria: Jr.", '2026-08');

        $disposition = $this->actingAs($admin)
            ->get("/api/payroll/payslip/{$employee->id}/2026-08/download")
            ->headers->get('content-disposition');

        $this->assertMatchesRegularExpression(
            '/filename="payslip_[A-Za-z0-9_]+_August_2026\.pdf"/',
            $disposition,
            'only characters a filesystem accepts survive'
        );
        $this->assertStringNotContainsString('/', explode('filename=', $disposition)[1]);
    }
}
