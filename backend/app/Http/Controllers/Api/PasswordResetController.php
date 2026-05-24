<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\InteractsWithApiResponses;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\Auth\ForgotPasswordRequest;
use App\Http\Requests\Api\Auth\ResetPasswordRequest;
use App\Http\Requests\Api\Auth\ValidateResetTokenRequest;
use App\Models\User;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;

class PasswordResetController extends Controller
{
    use InteractsWithApiResponses;

    public function store(ForgotPasswordRequest $request)
    {
        Password::broker()->sendResetLink($request->validated());

        return $this->successResponse([
            'sent' => true,
        ], 'If an account exists for that email, a reset link has been sent.');
    }

    public function validateToken(ValidateResetTokenRequest $request)
    {
        $validated = $request->validated();
        $user = User::query()->whereRaw('LOWER(email) = ?', [$validated['email']])->first();

        $isValid = $user ? Password::broker()->tokenExists($user, $validated['token']) : false;

        return $this->successResponse([
            'valid' => $isValid,
            'message' => $isValid ? 'Reset token is valid.' : 'This reset link is invalid or expired.',
        ]);
    }

    public function update(ResetPasswordRequest $request)
    {
        $status = Password::broker()->reset(
            $request->validated(),
            function (User $user, #[\SensitiveParameter] string $password) {
                // Use fill() instead of forceFill() to ensure the 'password' cast
                // (hashed) is applied via Eloquent mutators.
                $user->fill([
                    'password' => $password,
                    'remember_token' => Str::random(60),
                ])->save();
            }
        );

        if ($status === Password::PASSWORD_RESET) {
            return $this->successResponse([
                'reset' => true,
            ], 'Password reset successfully.');
        }

        return response()->json([
            'success' => false,
            'message' => 'This reset link is invalid or expired.',
            'error_code' => 'VALIDATION_ERROR',
            'errors' => [
                'token' => ['This reset link is invalid or expired.'],
            ],
        ], 422);
    }
}
