<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Every raw table name the payroll code hands to the query builder must exist.
 *
 * Payroll reaches for DB::table() and ->join() in a lot of places, and a
 * mistyped table name in one of those is invisible to every other gate we
 * have: PHP does not resolve it, PHPStan does not know the schema, and the
 * feature tests only cover the endpoints someone remembered to write a test
 * for. It surfaces as a 500 in production, or — worse — as a silently zeroed
 * count when the call site swallows the error.
 *
 * Three of these shipped at once:
 *
 *   - employee_work_info      (actual: employee_work_infos)   8 sites
 *   - pay_group_employees     (actual: pay_group_assignments) 1 site
 *   - fnf_settlements         (actual: full_and_final_settlements) 1 site
 *
 * Two of them were inside a helper that caught "undefined table" and returned
 * 0, so the pre-run checklist reported "no new joiners or exits" on every run
 * for as long as the typo existed. The other six broke the payroll review
 * screen with a 500 that the frontend rendered as "nothing to review".
 *
 * This test reads the source rather than exercising the endpoints because the
 * failure is in code paths that only run for particular orgs, months and pay
 * groups — a per-endpoint test would need every combination to catch it.
 */
class PayrollRawSchemaReferencesTest extends TestCase
{
    // The schema has to actually be built before we can ask what is in it.
    use RefreshDatabase;

    /**
     * Files whose raw table references are checked.
     *
     * @return list<string>
     */
    private function payrollSourceFiles(): array
    {
        $roots = [
            app_path('Http/Controllers/Api'),
            app_path('Services'),
        ];

        $files = [];
        foreach ($roots as $root) {
            if (! is_dir($root)) {
                continue;
            }
            $it = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root));
            foreach ($it as $file) {
                if ($file->isFile()
                    && $file->getExtension() === 'php'
                    && str_contains(strtolower($file->getFilename()), 'payroll')) {
                    $files[] = $file->getPathname();
                }
            }
        }

        return $files;
    }

    /**
     * Table names passed to DB::table(), ->join() and friends.
     *
     * Handles the `table as alias` form, and skips interpolated names because
     * those cannot be resolved statically.
     *
     * @return array<string, list<string>> table name => files referencing it
     */
    private function referencedTables(): array
    {
        $pattern = '/(?:DB::table|->(?:join|leftJoin|rightJoin|joinSub|from))\(\s*\'([a-z0-9_]+)(?:\s+as\s+[a-z0-9_]+)?\'/i';

        $tables = [];
        foreach ($this->payrollSourceFiles() as $file) {
            $source = file_get_contents($file);
            if ($source === false) {
                continue;
            }
            preg_match_all($pattern, $source, $matches);
            foreach ($matches[1] as $table) {
                $tables[$table][] = basename($file);
            }
        }

        return $tables;
    }

    public function test_the_scan_finds_something_to_check(): void
    {
        // Guards the regex itself. If a refactor changes how payroll queries
        // are written, this test must fail loudly rather than pass by
        // scanning nothing.
        $tables = $this->referencedTables();

        $this->assertNotEmpty(
            $this->payrollSourceFiles(),
            'No payroll source files were found to scan.'
        );
        $this->assertGreaterThan(
            5,
            count($tables),
            'Expected the scan to find raw table references in payroll code; it found '
            . count($tables) . '. The extraction pattern is probably stale.'
        );
    }

    public function test_every_raw_table_name_in_payroll_code_exists(): void
    {
        $missing = [];

        foreach ($this->referencedTables() as $table => $files) {
            if (! Schema::hasTable($table)) {
                $missing[] = sprintf(
                    '  %s  (referenced in %s)',
                    $table,
                    implode(', ', array_unique($files))
                );
            }
        }

        $this->assertSame(
            [],
            $missing,
            "Payroll code references tables that do not exist:\n" . implode("\n", $missing)
                . "\n\nA mistyped table name is a 500 in production, or a silently wrong count "
                . 'if the call site swallows the error. Fix the name — do not add it here.'
        );
    }
}
