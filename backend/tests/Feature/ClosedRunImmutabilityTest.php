<?php

namespace Tests\Feature;

use App\Exceptions\ClosedPayrollRunException;
use App\Models\Organization;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use App\Services\Payroll\ClosedRunWriteContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * A closed payroll run's money is immutable.
 *
 * Immutability used to be ~25 hand-written status checks across six
 * controllers, two jobs and a service. They disagreed: two tested a status
 * ('paid') that nothing has ever written, so quickSaveCtc and approveArrear
 * both succeeded against a disbursed run, and a seventh write path
 * (PayrollFilingController::calculateVariablePay) had no check at all.
 *
 * This suite has two halves, because the guard has two halves:
 *
 *   - Behaviour: PayrollItemObserver refuses money writes on a closed run,
 *     while leaving the payment bookkeeping disbursement depends on alone.
 *   - Reach: nothing routes around the observer. A query-builder mass
 *     update or delete fires no model events, so it is the one shape that
 *     can silently defeat the guard -- and the only way to keep it out is to
 *     assert it is absent.
 */
class ClosedRunImmutabilityTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $employee;
    private PayrollMonthlyRun $run;
    private PayrollItem $item;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();
        $this->employee = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);

        $this->run = PayrollMonthlyRun::create([
            'organization_id' => $this->organization->id,
            'month_year' => '2026-06',
            'status' => 'draft',
            'created_by' => $this->employee->id,
        ]);

        // Built while the run is still a draft, which is the only time it can be.
        $this->item = PayrollItem::create([
            'payroll_run_id' => $this->run->id,
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'month_year' => '2026-06',
            'basic' => 50000,
            'gross_salary' => 100000,
            'total_deductions' => 12000,
            'net_pay' => 88000,
        ]);
    }

    private function closeRunAs(string $status): void
    {
        $this->run->update(['status' => $status]);
    }

    public static function closedStatusProvider(): array
    {
        $cases = [];
        foreach (PayrollMonthlyRun::CLOSED_STATUSES as $status) {
            $cases[$status] = [$status];
        }

        return $cases;
    }

    // ------------------------------------------------------------- Behaviour

    #[Test]
    #[DataProvider('closedStatusProvider')]
    public function money_cannot_be_rewritten_once_the_run_is_closed(string $status): void
    {
        $this->closeRunAs($status);

        $this->expectException(ClosedPayrollRunException::class);

        $this->item->update(['net_pay' => 1]);
    }

    #[Test]
    #[DataProvider('closedStatusProvider')]
    public function the_stored_figure_survives_a_refused_write(string $status): void
    {
        $this->closeRunAs($status);

        try {
            $this->item->update(['net_pay' => 1]);
        } catch (ClosedPayrollRunException) {
            // expected
        }

        $this->assertSame(
            '88000.00',
            (string) $this->item->fresh()->net_pay,
            'A refused write must not reach the database.'
        );
    }

    /**
     * The reason the guard is scoped to money columns rather than to every
     * attribute: PayrollDisbursementService records payment_status, paid_at
     * and payment_reference on approved and released runs by design. Noting
     * that money left the bank is not changing what was owed, and a blanket
     * guard would break disbursement outright.
     */
    #[Test]
    public function payment_bookkeeping_still_works_on_a_closed_run(): void
    {
        $this->closeRunAs('released');

        $this->item->update([
            'payment_status' => 'paid',
            'payment_reference' => 'UTR12345',
            'paid_at' => now(),
        ]);

        $this->assertSame('paid', $this->item->fresh()->payment_status);
    }

    #[Test]
    public function money_writes_are_untouched_while_the_run_is_open(): void
    {
        $this->item->update(['net_pay' => 91000]);

        $this->assertSame('91000.00', (string) $this->item->fresh()->net_pay);
    }

    #[Test]
    public function an_employee_cannot_be_added_to_a_closed_run(): void
    {
        $this->closeRunAs('approved');

        $joiner = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);

        $this->expectException(ClosedPayrollRunException::class);

        PayrollItem::create([
            'payroll_run_id' => $this->run->id,
            'organization_id' => $this->organization->id,
            'user_id' => $joiner->id,
            'month_year' => '2026-06',
            'net_pay' => 40000,
        ]);
    }

    #[Test]
    public function a_payroll_item_cannot_be_deleted_from_a_closed_run(): void
    {
        $this->closeRunAs('disbursed');

        $this->expectException(ClosedPayrollRunException::class);

        $this->item->delete();
    }

    #[Test]
    public function a_governed_correction_may_write_and_the_permission_unwinds(): void
    {
        $this->closeRunAs('approved');

        app(ClosedRunWriteContext::class)->permit(
            'Approved override: court-ordered recovery',
            fn () => $this->item->update(['net_pay' => 80000])
        );

        $this->assertSame('80000.00', (string) $this->item->fresh()->net_pay);

        // The permission is scoped to the closure, not to the request.
        $this->expectException(ClosedPayrollRunException::class);
        $this->item->update(['net_pay' => 79000]);
    }

    #[Test]
    public function the_permission_unwinds_even_when_the_work_throws(): void
    {
        $this->closeRunAs('locked');

        try {
            app(ClosedRunWriteContext::class)->permit(
                'Approved override',
                fn () => throw new \RuntimeException('boom')
            );
        } catch (\RuntimeException) {
            // expected
        }

        $this->assertFalse(app(ClosedRunWriteContext::class)->isPermitted());
    }

    // ----------------------------------------------------------------- Reach

    /**
     * The one shape that defeats the observer.
     *
     * $run->items()->delete() and PayrollItem::where(...)->update([...]) are
     * query-builder operations: they fire no model events, so the observer
     * never runs. PayrollAutoProcessService used to wipe a whole run that way.
     * Because no guard can catch this at runtime, it is asserted absent.
     */
    #[Test]
    public function no_code_path_mass_writes_payroll_items_through_the_query_builder(): void
    {
        $offenders = [];

        // Truncating the table wholesale is what this command is for, and it
        // is an operator action rather than a payroll write path.
        $allowed = ['ClearMonthlyPayrollData.php'];

        $patterns = [
            // Scoped to variables that hold a payroll run. An unqualified
            // items()->delete() also matches $invoice->items() and
            // $declaration->items(), which are different tables entirely.
            '/\$(?:run|payrollRun|monthlyRun|payrollMonthlyRun)\s*->\s*items\(\)\s*->\s*(update|delete)\s*\(/',
            '/PayrollItem::where\((?:[^;]|\n)*?->\s*(update|delete)\s*\(/',
            '/DB::table\(\s*[\'"]payroll_items[\'"]\s*\)(?:[^;]|\n)*?->\s*(update|delete)\s*\(/',
        ];

        foreach ($this->phpFilesIn(app_path()) as $file) {
            if (in_array(basename($file), $allowed, true)) {
                continue;
            }

            // Comments are stripped first, so a docblock explaining why the
            // mass delete was removed does not itself read as a mass delete.
            $source = $this->sourceWithoutComments($file);

            foreach ($patterns as $pattern) {
                if (! preg_match_all($pattern, $source, $matches)) {
                    continue;
                }

                // Distinguish a terminal mass write from an iteration. Reading
                // rows and then calling save()/delete() on each model is the
                // fix, not the offence -- but the whole chain lives in one
                // statement, so the pattern sees the trailing ->delete(-
                // either way.
                $isIteration = static fn (string $statement): bool => str_contains($statement, 'cursor()')
                    || str_contains($statement, '->each(')
                    || str_contains($statement, '->get()');

                foreach ($matches[0] as $statement) {
                    if ($isIteration($statement)) {
                        continue;
                    }

                    $offenders[] = str_replace(base_path().DIRECTORY_SEPARATOR, '', $file);
                    break 2;
                }
            }
        }

        $this->assertSame(
            [],
            $offenders,
            "These files write to payroll_items through the query builder, which fires no model events "
            ."and therefore bypasses PayrollItemObserver entirely. Iterate and use \$item->save()/delete() "
            ."instead, or add a documented exception here:\n  ".implode("\n  ", $offenders)
        );
    }

    /**
     * MONEY_COLUMNS is the single definition the observer and every future
     * guard read from, so a column named there must actually exist.
     */
    #[Test]
    public function every_declared_money_column_exists_on_the_table(): void
    {
        $columns = \Illuminate\Support\Facades\Schema::getColumnListing('payroll_items');

        $missing = array_values(array_diff(PayrollItem::MONEY_COLUMNS, $columns));

        $this->assertSame([], $missing, 'MONEY_COLUMNS names columns that do not exist: '.implode(', ', $missing));
    }

    private function sourceWithoutComments(string $file): string
    {
        $source = '';

        foreach (token_get_all(file_get_contents($file)) as $token) {
            if (is_array($token)) {
                if ($token[0] === T_COMMENT || $token[0] === T_DOC_COMMENT) {
                    continue;
                }

                $source .= $token[1];

                continue;
            }

            $source .= $token;
        }

        return $source;
    }

    /** @return list<string> */
    private function phpFilesIn(string $directory): array
    {
        $files = [];
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($directory));

        foreach ($iterator as $file) {
            if ($file->isFile() && $file->getExtension() === 'php') {
                $files[] = $file->getPathname();
            }
        }

        return $files;
    }
}
