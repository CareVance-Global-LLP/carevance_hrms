<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * The payroll module must be authorised, not merely authenticated.
 *
 * `plan.payroll` (CheckPayrollPlan) verifies the ORGANISATION's subscription and
 * contains no role logic. For a long time it was the only middleware on the
 * payroll route groups, so any employee with a valid token could drive a run
 * through lock → approve → release → disburse, download the NEFT bank file with
 * every colleague's account number, generate statutory filings, and rewrite
 * anyone's CTC. Authorisation was left to ~60 controller methods checking
 * inline; two of them did.
 *
 * This test fails if a payroll route is ever added outside the role gate
 * without being explicitly declared employee self-service below.
 */
class PayrollRouteAuthorizationTest extends TestCase
{
    /**
     * Routes an ordinary employee is allowed to reach.
     *
     * Every entry must act on the caller's own data (resolved from
     * $request->user(), never a route parameter) or be a stateless calculator.
     * Adding to this list is a deliberate act — do not add a route here to make
     * the test pass.
     */
    private const EMPLOYEE_SELF_SERVICE = [
        'api/payroll/my/payslips',
        'api/payroll/my/declaration',
        'api/payroll/my/declaration/items',
        'api/payroll/my/declaration/{declarationId}/submit',
        'api/payroll/my/loans',
        'api/payroll/reimbursements',
        'api/payroll/reimbursements/mine',
        'api/payroll/reimbursements/{id}',
        // Badge counts. Both branch on role inside the controller and resolve
        // the subject from $request->user(), so an employee sees only their own
        // figures — and the sidebar cannot render without them.
        'api/payroll/reimbursements/inbox-count',
        'api/payroll/reimbursements/summary',
        'api/payroll/tax-proofs',
        'api/payroll/tax-proofs/mine',
        'api/payroll/tax-proofs/my-12bb/{financialYear}',
        'api/payroll/leave-encashments',
        'api/payroll/fbp/claims',
        'api/payroll/revision-letters/{id}/accept',
        'api/payroll/revision-letters/{id}/reject',
        'api/payroll/tax-simulator/compare',
        'api/payroll/tax-simulator/what-if',
        'api/payroll/tax-simulator/monthly-take-home',
        // Moved out of the administrative group: these are reached from
        // MyPayroll, Loans and TaxDeclaration, so gating them to admin/manager
        // 403'd the only people who use them. requestLoan and
        // taxSavingsRecommendation resolve the subject from $request->user();
        // hraOptimization is a pure calculator over values the caller supplies.
        'api/payroll/loans/request',
        'api/payroll/tax-savings/recommendation',
        'api/payroll/hra-optimization',
        // These two take a {userId} rather than resolving it from the caller,
        // so PayrollController::denyForeignPayslip enforces that an employee
        // may only fetch their own. Covered by
        // PayrollSelfServiceAuthorizationTest.
        'api/payroll/payslip/{userId}/{monthYear}/download',
        'api/payroll/payslip/{userId}/{monthYear}/view',
    ];

    /** @return array<int, \Illuminate\Routing\Route> */
    private function payrollRoutes(): array
    {
        return array_values(array_filter(
            Route::getRoutes()->getRoutes(),
            fn ($route) => str_starts_with($route->uri(), 'api/payroll/'),
        ));
    }

    private function hasRoleGate(\Illuminate\Routing\Route $route): bool
    {
        foreach ($route->gatherMiddleware() as $middleware) {
            if (is_string($middleware) && str_starts_with($middleware, 'role:')) {
                return true;
            }
        }

        return false;
    }

    public function test_every_payroll_route_is_role_gated_or_declared_self_service(): void
    {
        $ungated = [];

        foreach ($this->payrollRoutes() as $route) {
            if ($this->hasRoleGate($route)) {
                continue;
            }
            if (in_array($route->uri(), self::EMPLOYEE_SELF_SERVICE, true)) {
                continue;
            }
            $ungated[] = implode('|', $route->methods()).' '.$route->uri();
        }

        $this->assertSame(
            [],
            $ungated,
            "These payroll routes are reachable by any authenticated employee:\n  ".
            implode("\n  ", $ungated).
            "\n\nEither add 'role:admin,manager' to their group, or — only if the route ".
            'acts solely on the caller\'s own data — add it to EMPLOYEE_SELF_SERVICE.',
        );
    }

    public function test_the_money_moving_routes_are_gated(): void
    {
        // The specific endpoints that make salary leave the company, plus the
        // file that carries every employee's bank details. Named individually
        // so a refactor that loses the gate fails loudly here.
        $mustBeGated = [
            'api/payroll/runs/{runId}/lock',
            'api/payroll/runs/{runId}/approve',
            'api/payroll/runs/{runId}/release',
            'api/payroll/runs/{runId}/disburse',
            'api/payroll/runs/{runId}/bank-file',
            'api/payroll/bank/create-batch',
            'api/payroll/employees/{userId}/ctc',
            // api/payroll/quick-fix was removed rather than gated. It had no
            // client caller and inserted a fabricated PAN and a ₹6,00,000 CTC
            // template for the calling user.
        ];

        $byUri = [];
        foreach ($this->payrollRoutes() as $route) {
            $byUri[$route->uri()] = $route;
        }

        foreach ($mustBeGated as $uri) {
            $this->assertArrayHasKey($uri, $byUri, "Route {$uri} no longer exists — update this test.");
            $this->assertTrue(
                $this->hasRoleGate($byUri[$uri]),
                "{$uri} has no role gate. Any employee could call it.",
            );
        }
    }

    public function test_self_service_routes_stay_reachable_by_employees(): void
    {
        // The other half of the guarantee: locking the module down must not
        // take payslips and reimbursements away from the people they belong to.
        $byUri = [];
        foreach ($this->payrollRoutes() as $route) {
            $byUri[$route->uri()][] = $route;
        }

        foreach (['api/payroll/my/payslips', 'api/payroll/reimbursements/mine', 'api/payroll/tax-proofs/mine'] as $uri) {
            $this->assertArrayHasKey($uri, $byUri, "Self-service route {$uri} is missing.");

            $reachable = false;
            foreach ($byUri[$uri] as $route) {
                if (! $this->hasRoleGate($route)) {
                    $reachable = true;
                }
            }

            $this->assertTrue($reachable, "{$uri} is now behind a role gate — employees cannot reach their own data.");
        }
    }
}
