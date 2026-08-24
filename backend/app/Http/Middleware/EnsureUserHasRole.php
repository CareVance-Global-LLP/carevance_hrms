<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureUserHasRole
{
    private function normalizeRole(?string $role): string
    {
        return strtolower(trim((string) $role));
    }

    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        $user = $request->user();
        $normalizedAllowedRoles = collect($roles)
            ->map(fn (string $role) => $this->normalizeRole($role))
            ->filter()
            ->values();

        if (!$user || $normalizedAllowedRoles->isEmpty()) {
            return response()->json([
                'success' => false,
                'message' => 'Forbidden',
                'error_code' => 'FORBIDDEN',
            ], 403);
        }

        // Lower hierarchy level == more privilege (super_admin = 0).
        // Each case is "at least this privileged", so a route open to
        // employees is also open to their managers and admins. The previous
        // `'employee' => $userLevel >= 100` inverted that one case and locked
        // admins out of every employee-scoped route.
        $userLevel = $user->getHierarchyLevel();
        $hasAccess = $normalizedAllowedRoles->some(function (string $allowedRole) use ($userLevel) {
            return match ($allowedRole) {
                'super_admin' => $userLevel === 0,
                'admin' => $userLevel <= 10,
                /*
                 * The people who run payroll: admin, hr and payroll_manager,
                 * which User::getHierarchyLevel() places at 10, 20 and 20 —
                 * the same set as PayslipController::PAYROLL_ROLES.
                 *
                 * This token exists because neither neighbour fits. 'admin'
                 * (<= 10) locks HR out of their own module, an outage already
                 * written up in getHierarchyLevel(). 'manager' (< 100) admits
                 * every line manager, which put the whole company's pay one
                 * request away from anyone with a team.
                 */
                'payroll' => $userLevel <= 20,
                'manager' => $userLevel < 100,
                'employee' => true,
                default => false,
            };
        });

        if (!$hasAccess) {
            return response()->json([
                'success' => false,
                'message' => 'Forbidden',
                'error_code' => 'FORBIDDEN',
            ], 403);
        }

        return $next($request);
    }
}
