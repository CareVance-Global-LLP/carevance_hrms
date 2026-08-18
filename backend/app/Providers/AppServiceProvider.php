<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Illuminate\Support\ServiceProvider;
use Illuminate\Validation\Rules\Password;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // Singleton so its per-organization memo survives across a whole
        // request. User::getEffectiveMonitoringIntervalMinutesAttribute() is an
        // appended attribute, so it runs once per serialized user — without the
        // shared memo a list endpoint would re-read the organization row for
        // every row in the page.
        $this->app->singleton(\App\Services\Monitoring\MonitoringSettingsResolver::class);

        // Singleton so the permission a caller opens with permit() is visible
        // to the observer resolved from this same container. A fresh instance
        // per resolution would mean the observer never sees it and every
        // governed correction would be refused.
        $this->app->singleton(\App\Services\Payroll\ClosedRunWriteContext::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        /*
         * Closed payroll runs are immutable in the money columns.
         *
         * Registered here rather than in each write path because the whole
         * point is to cover the paths nobody remembers -- see
         * PayrollItemObserver for what it does and does not guard.
         */
        \App\Models\PayrollItem::observe(\App\Observers\PayrollItemObserver::class);

        /*
         * The password policy, in one place.
         *
         * Every password-setting endpoint validated `min:8` and nothing else,
         * which is how an admin account came to have the password "12345678".
         * For a system holding PAN numbers, bank accounts and salary data that
         * is below the floor.
         *
         * `uncompromised()` checks the address against the Have I Been Pwned
         * k-anonymity API, so it is a network call — it belongs in production
         * and nowhere near the test suite, which must run offline and fast.
         * The relaxed non-production rule is deliberate for the same reason:
         * the suite creates users with passwords like "password123" in dozens
         * of places, and rewriting all of them buys nothing.
         *
         * Consequence worth knowing: the strict rule is not exercised by the
         * tests. If you change it, verify it by hand against a real request.
         *
         * Existing weak passwords keep working — login only checks the hash.
         * This gates what can be *set* from here on.
         */
        Password::defaults(function () {
            if (! $this->app->isProduction()) {
                return Password::min(8);
            }

            return Password::min(12)
                ->letters()
                ->mixedCase()
                ->numbers()
                ->symbols()
                ->uncompromised();
        });

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

        RateLimiter::for('ai.chat', fn (Request $request) => [
            Limit::perMinute((int) env('RATE_LIMIT_AI_CHAT_PER_MINUTE', 10))
                ->by((string) (optional($request->user())->getAuthIdentifier() ?? $request->ip())),
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
