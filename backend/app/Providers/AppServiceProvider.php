<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        RateLimiter::for('auth.login', function (Request $request) {
            $email = Str::lower((string) $request->input('email', 'guest'));
            $userAgent = Str::lower((string) $request->userAgent());
            $isDesktopClient = str_contains($userAgent, 'electron') || str_contains($userAgent, 'carevance tracker');
            $clientType = $isDesktopClient ? 'desktop' : 'web';
            $emailLimit = $isDesktopClient
                ? (int) env('RATE_LIMIT_LOGIN_DESKTOP_PER_MINUTE', 12)
                : (int) env('RATE_LIMIT_LOGIN_PER_MINUTE', 5);
            $ipLimit = $isDesktopClient
                ? (int) env('RATE_LIMIT_LOGIN_DESKTOP_IP_PER_MINUTE', 40)
                : (int) env('RATE_LIMIT_LOGIN_IP_PER_MINUTE', 20);
            $clientFingerprint = sha1($userAgent !== '' ? $userAgent : 'unknown-client');

            return [
                Limit::perMinute($emailLimit)->by($email.'|'.$request->ip().'|'.$clientFingerprint),
                Limit::perMinute($ipLimit)->by($request->ip().'|'.$clientType),
            ];
        });

        RateLimiter::for('auth.register', fn (Request $request) => [
            Limit::perMinute((int) env('RATE_LIMIT_REGISTER_PER_MINUTE', 3))->by($request->ip()),
        ]);

        RateLimiter::for('auth.password.request', function (Request $request) {
            $email = Str::lower((string) $request->input('email', 'guest'));

            return [
                Limit::perMinute((int) env('RATE_LIMIT_PASSWORD_RESET_REQUEST_PER_MINUTE', 5))->by($email.'|'.$request->ip()),
                Limit::perMinute((int) env('RATE_LIMIT_PASSWORD_RESET_REQUEST_IP_PER_MINUTE', 20))->by($request->ip()),
            ];
        });

        RateLimiter::for('auth.password.reset', function (Request $request) {
            $email = Str::lower((string) $request->input('email', 'guest'));

            return [
                Limit::perMinute((int) env('RATE_LIMIT_PASSWORD_RESET_PER_MINUTE', 10))->by($email.'|'.$request->ip()),
                Limit::perMinute((int) env('RATE_LIMIT_PASSWORD_RESET_IP_PER_MINUTE', 25))->by($request->ip()),
            ];
        });

        RateLimiter::for('auth.verification.resend', fn (Request $request) => [
            Limit::perMinute((int) env('RATE_LIMIT_VERIFICATION_RESEND_PER_MINUTE', 3))
                ->by(
                    ($request->user()?->email
                        ? Str::lower((string) $request->user()?->email)
                        : 'guest')
                    .'|'.$request->ip()
                ),
        ]);

        RateLimiter::for('auth.verification.resend.public', function (Request $request) {
            $email = Str::lower((string) $request->input('email', 'guest'));

            return [
                Limit::perMinute((int) env('RATE_LIMIT_VERIFICATION_RESEND_PER_MINUTE', 3))
                    ->by($email.'|'.$request->ip()),
                Limit::perMinute((int) env('RATE_LIMIT_VERIFICATION_RESEND_IP_PER_MINUTE', 10))
                    ->by($request->ip()),
            ];
        });

        RateLimiter::for('invitations.create', fn (Request $request) => [
            Limit::perMinute((int) env('RATE_LIMIT_INVITATIONS_CREATE_PER_MINUTE', 20))
                ->by((string) optional($request->user())->getAuthIdentifier()),
        ]);

        RateLimiter::for('invitations.accept', fn (Request $request) => [
            Limit::perMinute((int) env('RATE_LIMIT_INVITATIONS_ACCEPT_PER_MINUTE', 10))
                ->by($request->ip().'|'.(string) $request->route('token')),
        ]);

        RateLimiter::for('invitations.validate', fn (Request $request) => [
            Limit::perMinute((int) env('RATE_LIMIT_INVITATIONS_VALIDATE_PER_MINUTE', 30))
                ->by($request->ip()),
        ]);

        RateLimiter::for('auth.handoff', fn (Request $request) => [
            Limit::perMinute((int) env('RATE_LIMIT_HANDOFF_PER_MINUTE', 10))->by((string) optional($request->user())->getAuthIdentifier()),
        ]);

        RateLimiter::for('settings.password', fn (Request $request) => [
            Limit::perMinute((int) env('RATE_LIMIT_PASSWORD_PER_MINUTE', 5))->by((string) optional($request->user())->getAuthIdentifier()),
        ]);

        RateLimiter::for('screenshots.upload', fn (Request $request) => [
            Limit::perMinute((int) env('RATE_LIMIT_SCREENSHOTS_PER_MINUTE', 30))->by((string) optional($request->user())->getAuthIdentifier()),
        ]);

        RateLimiter::for('chat.messages', fn (Request $request) => [
            Limit::perMinute((int) env('RATE_LIMIT_CHAT_MESSAGES_PER_MINUTE', 60))->by((string) optional($request->user())->getAuthIdentifier()),
        ]);

        RateLimiter::for('notifications.publish', fn (Request $request) => [
            Limit::perMinute((int) env('RATE_LIMIT_NOTIFICATION_PUBLISH_PER_MINUTE', 10))->by((string) optional($request->user())->getAuthIdentifier()),
        ]);

        RateLimiter::for('desktop.download', fn (Request $request) => [
            Limit::perMinute((int) env('RATE_LIMIT_DESKTOP_DOWNLOAD_PER_MINUTE', 10))->by($request->ip()),
        ]);

        RateLimiter::for('support.bug-report', function (Request $request) {
            $email = Str::lower((string) $request->input('email', 'guest'));

            return [
                Limit::perMinute((int) env('RATE_LIMIT_BUG_REPORT_PER_MINUTE', 5))->by($email.'|'.$request->ip()),
                Limit::perMinute((int) env('RATE_LIMIT_BUG_REPORT_IP_PER_MINUTE', 10))->by($request->ip()),
            ];
        });
    }
}
