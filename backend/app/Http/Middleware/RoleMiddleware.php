<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RoleMiddleware
{
    /**
     * Handle an incoming request.
     */
    public function handle(Request $request, Closure $next, string $roles): Response
    {
        $user = $request->user();
        
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated'], 401);
        }

        $rolesArray = array_map('trim', explode(',', $roles));
        $userLevel = $user->getHierarchyLevel();

        $hasAccess = collect($rolesArray)->contains(function (string $allowedRole) use ($userLevel) {
            return match (strtolower($allowedRole)) {
                'admin' => $userLevel <= 10,
                'manager' => $userLevel < 100,
                'employee' => $userLevel >= 100,
                default => false,
            };
        });

        if (!$hasAccess) {
            return response()->json([
                'message' => 'Access denied. Required roles: ' . $roles
            ], 403);
        }

        return $next($request);
    }
}