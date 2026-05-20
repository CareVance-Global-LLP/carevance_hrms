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

        $rolesArray = explode(',', $roles);
        $rolesArray = array_map('trim', $rolesArray);

        if (!in_array($user->role, $rolesArray)) {
            return response()->json([
                'message' => 'Access denied. Required roles: ' . $roles
            ], 403);
        }

        return $next($request);
    }
}