<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\InviteUserMail;
use App\Models\Invite;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

class InviteController extends Controller
{
    public function sendInvite(Request $request)
    {
        $validated = $request->validate([
            'email' => 'required|email',
            'role' => 'nullable|string',
        ]);

        $email = mb_strtolower(trim((string) $validated['email']));

        if (User::query()->whereRaw('LOWER(email) = ?', [$email])->exists()) {
            return response()->json([
                'success' => false,
                'message' => 'This email already exists.',
            ], 422);
        }

        $token = Str::random(64);
        $expiresAt = now()->addDays(7);

        $invite = Invite::create([
            'email' => $email,
            'role' => $validated['role'] ?? null,
            'token' => $token,
            'expires_at' => $expiresAt,
            'created_by' => $request->user()?->id,
        ]);

        $inviteLink = $this->buildInviteLink($token);
        $companyName = config('app.name', 'CareVance HRMS');

        try {
            Mail::to($email)->send(new InviteUserMail($inviteLink, $companyName));
        } catch (\Throwable $exception) {
            Log::warning('Invite email failed to send.', [
                'invite_id' => $invite->id,
                'email' => $email,
                'exception' => $exception::class,
                'message' => $exception->getMessage(),
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to send invitation email.',
            ], 500);
        }

        return response()->json([
            'success' => true,
            'message' => 'Invitation sent successfully.',
            'invite' => [
                'id' => $invite->id,
                'email' => $invite->email,
                'role' => $invite->role,
                'expires_at' => $invite->expires_at?->toIso8601String(),
            ],
        ]);
    }

    public function validateInvite(Request $request)
    {
        $validated = $request->validate([
            'token' => 'required|string',
        ]);

        $invite = Invite::query()->where('token', $validated['token'])->first();

        if (!$invite) {
            return response()->json([
                'valid' => false,
                'message' => 'Invite not found.',
            ]);
        }

        if ($invite->accepted_at) {
            return response()->json([
                'valid' => false,
                'message' => 'Invite already accepted.',
            ]);
        }

        if ($invite->expires_at && $invite->expires_at->isPast()) {
            return response()->json([
                'valid' => false,
                'message' => 'Invite expired.',
            ]);
        }

        return response()->json([
            'valid' => true,
            'email' => $invite->email,
            'role' => $invite->role,
            'expires_at' => $invite->expires_at?->toIso8601String(),
        ]);
    }

    public function acceptInvite(Request $request)
    {
        $validated = $request->validate([
            'token' => 'required|string',
            'name' => 'required|string|max:255',
            'password' => 'required|string|min:8|confirmed',
        ]);

        $invite = Invite::query()
            ->with('creator.organization')
            ->where('token', $validated['token'])
            ->first();

        if (!$invite) {
            return response()->json([
                'success' => false,
                'message' => 'Invite not found.',
            ], 404);
        }

        if ($invite->accepted_at) {
            return response()->json([
                'success' => false,
                'message' => 'Invite already accepted.',
            ], 409);
        }

        if ($invite->expires_at && $invite->expires_at->isPast()) {
            return response()->json([
                'success' => false,
                'message' => 'Invite expired.',
            ], 410);
        }

        $creator = $invite->creator;
        if (!$creator || !$creator->organization_id || !$creator->organization) {
            return response()->json([
                'success' => false,
                'message' => 'Invite is missing organization context.',
            ], 422);
        }

        $email = mb_strtolower(trim((string) $invite->email));

        if (User::query()->whereRaw('LOWER(email) = ?', [$email])->exists()) {
            return response()->json([
                'success' => false,
                'message' => 'This email already exists.',
            ], 422);
        }

        $user = User::create([
            'name' => trim((string) $validated['name']),
            'email' => $email,
            'password' => Hash::make((string) $validated['password']),
            'role' => $invite->role ?: 'employee',
            'organization_id' => $creator->organization_id,
            'invited_by' => $creator->id,
        ]);

        $invite->forceFill([
            'accepted_at' => now(),
        ])->save();

        try {
            $user->sendEmailVerificationNotification();
        } catch (\Throwable $exception) {
            Log::warning('Verification email dispatch failed for legacy invite acceptance.', [
                'user_id' => $user->id,
                'email' => $user->email,
                'exception' => $exception::class,
                'message' => $exception->getMessage(),
            ]);
        }

        $user->load('organization');

        return response()->json([
            'success' => true,
            'message' => 'Invitation accepted successfully. Please verify your email before signing in.',
            'user' => $user,
            'organization' => $user->organization,
            'requires_verification' => true,
            'email' => $user->email,
        ], 201);
    }

    private function buildInviteLink(string $token): string
    {
        $frontendUrl = rtrim((string) config('carevance.frontend_url', config('app.url')), '/');

        return $frontendUrl.'/signup?'.http_build_query(['token' => $token]);
    }
}
