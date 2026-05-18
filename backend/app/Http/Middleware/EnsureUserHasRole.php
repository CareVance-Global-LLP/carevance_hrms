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

        if (
            !$user
            || $normalizedAllowedRoles->isEmpty()
            || !$normalizedAllowedRoles->contains($this->normalizeRole($user->role))
        ) {
            return response()->json([
                'success' => false,
                'message' => 'Forbidden',
                'error_code' => 'FORBIDDEN',
            ], 403);
        }

        return $next($request);
    }
}
