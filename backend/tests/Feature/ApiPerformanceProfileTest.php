<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * A profiling harness, not an assertion suite.
 *
 * Deliberately NOT RefreshDatabase and deliberately pointed at the real
 * Postgres development database: an in-memory SQLite with three seeded rows
 * tells you nothing about which endpoint will fall over at a thousand. Only
 * GETs are issued, so nothing is written.
 *
 * Wall time is the symptom; QUERY COUNT is the diagnosis. An endpoint issuing
 * one query per row is fine on a dev box and fatal on a real tenant, and it
 * looks identical to a fast endpoint until it does not.
 *
 * Run: php artisan test --filter=ApiPerformanceProfileTest
 */
class ApiPerformanceProfileTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        /*
         * phpunit.xml pins DB_CONNECTION=sqlite and DB_DATABASE=:memory:, and
         * the second of those leaks into every connection — so switching the
         * default to pgsql alone asks Postgres for a database called
         * ":memory:". The real name has to be restored with it.
         */
        // Hand-parsed: .env is not valid INI (unquoted '=' inside values
        // makes parse_ini_file fail outright).
        if (! is_readable(base_path('.env'))) {
            $this->markTestSkipped('No .env — the profiler needs the real development database.');
        }

        $env = [];
        foreach (file(base_path('.env'), FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
            if (str_starts_with(trim($line), '#') || ! str_contains($line, '=')) {
                continue;
            }
            [$key, $value] = explode('=', $line, 2);
            $env[trim($key)] = trim($value, " 	\"'");
        }
        config([
            'database.default' => 'pgsql',
            'database.connections.pgsql.database' => $env['DB_DATABASE'] ?? 'timetrackpro',
            'database.connections.pgsql.username' => $env['DB_USERNAME'] ?? 'postgres',
            'database.connections.pgsql.password' => $env['DB_PASSWORD'] ?? '',
            'database.connections.pgsql.host' => $env['DB_HOST'] ?? '127.0.0.1',
            'database.connections.pgsql.port' => $env['DB_PORT'] ?? '5432',
        ]);
        DB::purge('pgsql');

        /*
         * Skip rather than fail where that database is not there. This is a
         * measurement tool that only says anything useful against real data;
         * on CI, where the suite runs on in-memory SQLite, a red build here
         * would report a missing dev box as a broken application.
         */
        try {
            DB::connection('pgsql')->getPdo();
        } catch (\Throwable $e) {
            $this->markTestSkipped('Development Postgres is not reachable: '.$e->getMessage());
        }
    }

    public function test_profile_read_endpoints(): void
    {
        $admin = User::where('role', 'admin')->orderBy('id')->first();
        $this->assertNotNull($admin, 'No admin in the development database to profile as.');

        $headers = $this->apiHeadersFor($admin);
        $month = now()->format('Y-m');
        $from = now()->startOfMonth()->toDateString();
        $to = now()->toDateString();

        $employeeId = User::where('organization_id', $admin->organization_id)
            ->where('role', 'employee')->value('id');

        $endpoints = [
            'dashboard' => '/api/dashboard',
            'users (list)' => '/api/users',
            'notifications' => '/api/notifications?limit=20',
            'activities (processed)' => '/api/activities?processed=1&per_page=50',
            'reports/overall' => "/api/reports/overall?start_date={$from}&end_date={$to}",
            'reports/productivity' => "/api/reports/productivity?start_date={$from}&end_date={$to}",
            'reports/employee-insights' => "/api/reports/employee-insights?start_date={$from}&end_date={$to}",
            'screenshots' => "/api/screenshots?start_date={$from}&end_date={$to}&per_page=48",
            'attendance/calendar' => "/api/attendance/calendar?month={$month}",
            'employee workspace' => $employeeId ? "/api/employees/{$employeeId}/workspace" : null,
            'payroll/dashboard' => '/api/payroll/dashboard',
            'payroll/employee-cards' => '/api/payroll/employee-cards',
            'payroll override grid' => '/api/payroll/operations/overrides/grid?per_page=25',
            'payroll override export' => '/api/payroll/operations/overrides/export',
            'tasks' => '/api/tasks',
            'chat/conversations' => '/api/chat/conversations',
            'leave-requests' => '/api/leave-requests',
        ];

        $results = [];

        /*
         * ONE listener for the whole run, writing into a buffer this closure
         * owns. Registering it inside the loop instead — with `use (&$queries)`
         * over a variable declared in the loop body — binds every listener to
         * the same outer variable, so the Nth endpoint is recorded by all N
         * listeners and its query count comes out N times too high. Laravel has
         * no way to remove a query listener, so it has to be hoisted.
         */
        $buffer = [];
        $capture = false;
        DB::listen(function ($query) use (&$buffer, &$capture) {
            if ($capture) {
                $buffer[] = ['sql' => $query->sql, 'ms' => $query->time];
            }
        });

        foreach ($endpoints as $label => $url) {
            if ($url === null) {
                continue;
            }

            $buffer = [];
            $capture = true;

            $started = microtime(true);
            $response = $this->getJson($url, $headers);
            $elapsedMs = (microtime(true) - $started) * 1000;

            $capture = false;
            $queries = $buffer;

            // Repeated statements are the N+1 signature: the same SQL shape
            // executed many times with different bindings.
            $shapes = [];
            foreach ($queries as $q) {
                $shapes[$q['sql']] = ($shapes[$q['sql']] ?? 0) + 1;
            }
            arsort($shapes);
            $worstShape = array_key_first($shapes) ?? '';
            $worstCount = $shapes[$worstShape] ?? 0;

            usort($queries, fn ($a, $b) => $b['ms'] <=> $a['ms']);

            $results[] = [
                'label' => $label,
                'status' => $response->status(),
                'ms' => round($elapsedMs, 1),
                'queries' => count($queries),
                'sql_ms' => round(array_sum(array_column($queries, 'ms')), 1),
                'slowest_ms' => round($queries[0]['ms'] ?? 0, 1),
                'slowest_sql' => substr((string) ($queries[0]['sql'] ?? ''), 0, 110),
                'repeat_count' => $worstCount,
                'repeat_sql' => substr($worstShape, 0, 110),
                'top_shapes' => array_slice($shapes, 0, 4, true),
            ];
        }

        usort($results, fn ($a, $b) => $b['ms'] <=> $a['ms']);

        $line = str_repeat('-', 108);
        fwrite(STDERR, "\n{$line}\n");
        fwrite(STDERR, sprintf("%-28s %6s %8s %9s %9s %11s\n", 'ENDPOINT', 'HTTP', 'WALL ms', 'QUERIES', 'SQL ms', 'MAX REPEAT'));
        fwrite(STDERR, "{$line}\n");
        foreach ($results as $r) {
            fwrite(STDERR, sprintf(
                "%-28s %6d %8.1f %9d %9.1f %11d\n",
                substr($r['label'], 0, 28), $r['status'], $r['ms'], $r['queries'], $r['sql_ms'], $r['repeat_count']
            ));
        }
        fwrite(STDERR, "{$line}\n\nDETAIL (worst first)\n");
        foreach (array_slice($results, 0, 12) as $r) {
            fwrite(STDERR, sprintf(
                "\n%s  [%d queries, %.1f ms wall]\n  slowest %.1fms: %s\n  repeated %dx: %s\n",
                $r['label'], $r['queries'], $r['ms'], $r['slowest_ms'], $r['slowest_sql'], $r['repeat_count'], $r['repeat_sql']
            ));
            foreach ($r['top_shapes'] as $sql => $n) {
                if ($n > 3) {
                    fwrite(STDERR, sprintf("    %4dx %s
", $n, substr($sql, 0, 100)));
                }
            }
        }

        $this->assertTrue(true);
    }
}
