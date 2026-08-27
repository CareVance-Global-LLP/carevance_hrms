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

        // Singleton so its userId => timezone memo survives a whole request.
        // The report rollups and the activity feed ask it per ROW; a fresh
        // instance per resolution would re-read employee_work_infos for every
        // row of a timeline page.
        $this->app->singleton(\App\Services\Attendance\UserTimezoneResolver::class);
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
         * Outbound webhooks.
         *
         * Registered on exactly the five models that carry the eight published
         * events, so nothing else pays for the check. On the model lifecycle
         * rather than at each call site because an event somebody has to
         * remember to emit is one that silently stops being emitted.
         */
        foreach ([
            \App\Models\User::class,
            \App\Models\EmployeeExit::class,
            \App\Models\PayrollMonthlyRun::class,
            \App\Models\LeaveRequest::class,
            \App\Models\Invoice::class,
        ] as $model) {
            $model::observe(\App\Observers\WebhookEventObserver::class);
        }

        /*
         * AI mode's vocabulary is DERIVED from the schema, so a migration is
         * the event that makes it wrong.
         *
         * Registered here rather than folded into the cache key, which is what
         * this replaced. That key was a hash of every table and column, so it
         * invalidated itself perfectly — and had to read the entire schema to
         * decide whether anything had changed, which cost more than the cache
         * saved and was paid on every AI question. Listening moves that cost to
         * the handful of times a year the schema actually changes.
         *
         * On the migration event rather than at the call sites for the same
         * reason as the observers above: an invalidation somebody has to
         * remember to call is one that silently stops being called. Migrator
         * fires MigrationsEnded for both 'up' and 'down', so migrate,
         * migrate:fresh and migrate:rollback are all covered.
         *
         * The day-long TTL on the entry is the backstop for the case this
         * cannot see — a schema changed outside a migration, which has happened
         * in this codebase before (bank_transfer_batches).
         *
         * DO NOT REMOVE THE rescue() AS DEFENSIVE NOISE. It guards one specific
         * failure. forgetCached() calls Cache::forget(), and CACHE_STORE
         * defaults to `database` (.env.example, config/cache.php), so that is a
         * query against the `cache` TABLE. MigrationsEnded fires for 'down' as
         * well as 'up', so `migrate:reset` or a full rollback drops that table
         * and then this listener queries it — turning a rollback that SUCCEEDED
         * into a QueryException thrown after all the work was done. The suite
         * cannot catch it because phpunit.xml pins CACHE_STORE=array.
         *
         * rescue() rather than skipping 'down': a rollback changes the schema
         * too, so the vocabulary is just as stale afterwards, and it should
         * still be forgotten whenever the store is actually reachable. rescue()
         * reports to the exception handler rather than swallowing silently, so
         * this stays visible in logs rather than becoming a bare catch.
         */
        \Illuminate\Support\Facades\Event::listen(
            \Illuminate\Database\Events\MigrationsEnded::class,
            fn () => rescue(fn () => \App\Services\Ai\SemanticLayer::forgetCached()),
        );

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
         * Consequence worth knowing: the strict rule is not reachable through a
         * request in the test suite, because this closure short-circuits before
         * it. PasswordPolicyTest therefore asserts the production rule directly
         * against `productionRules()` rather than by posting to an endpoint.
         *
         * The minimum is 8, not 12. That was a deliberate call and it is the
         * one part of this policy that is weaker than the guidance for a system
         * holding payroll and PII — an 8-character password is materially
         * cheaper to attack offline. What keeps it defensible is that ONLY the
         * length was relaxed: every other rule below still applies, so
         * "Abcd12!x" passes and "password" does not. Raising it back is a
         * one-character edit here and nothing else.
         *
         * Existing weak passwords keep working — login only checks the hash.
         * This gates what can be *set* from here on.
         */
        Password::defaults(function () {
            if (! $this->app->isProduction()) {
                return Password::min(8);
            }

            return self::productionRules();
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

        /*
         * Second-factor verification.
         *
         * Tighter than login on purpose. A six-digit code has a million
         * combinations, but a one-step clock window means several are valid at
         * once, so an unbounded attempt rate against a *known-good* password
         * is a genuine brute force. Keyed on the challenge as well as the IP:
         * limiting by IP alone would let one attacker exhaust the budget for
         * every user behind a shared NAT.
         */
        RateLimiter::for('auth.mfa.verify', fn (Request $request) => [
            Limit::perMinute((int) env('RATE_LIMIT_MFA_PER_MINUTE', 6))
                ->by(sha1((string) $request->input('challenge', 'none'))),
            Limit::perMinute((int) env('RATE_LIMIT_MFA_IP_PER_MINUTE', 30))->by($request->ip()),
        ]);

        /*
         * The customer-facing read API.
         *
         * Keyed on the API key rather than the IP: several customers may
         * integrate from the same cloud region, and limiting by IP would let
         * one of them exhaust the budget for the others.
         */
        RateLimiter::for('api.public', function (Request $request) {
            $key = (string) ($request->header('X-API-Key')
                ?: $request->header('Authorization', 'anonymous'));

            return [
                Limit::perMinute((int) env('RATE_LIMIT_PUBLIC_API_PER_MINUTE', 120))->by(sha1($key)),
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

        // Reading your own device list writes an audit row every time, so it
        // is rate-limited like a write. Sixty a minute is far above opening a
        // settings screen and far below burying the audit trail in polling.
        RateLimiter::for('auth.sessions', fn (Request $request) => [
            Limit::perMinute((int) env('RATE_LIMIT_SESSIONS_PER_MINUTE', 60))->by((string) optional($request->user())->getAuthIdentifier()),
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

        /*
         * Upload chunks are legitimately bursty.
         *
         * A 200 MB attachment at a 5 MB chunk size is ~40 requests back to
         * back, and a slower link negotiates smaller pieces and therefore MORE
         * of them — a 2 MB dev limit turns the same file into ~125. Applying an
         * ordinary write throttle here would cut off exactly the large uploads
         * this endpoint exists to make possible, and the failure would look
         * like a network fault rather than a policy.
         */
        RateLimiter::for('uploads.chunks', fn (Request $request) => [
            Limit::perMinute((int) env('RATE_LIMIT_UPLOAD_CHUNKS_PER_MINUTE', 600))->by((string) optional($request->user())->getAuthIdentifier()),
        ]);

        RateLimiter::for('notifications.publish', fn (Request $request) => [
            Limit::perMinute((int) env('RATE_LIMIT_NOTIFICATION_PUBLISH_PER_MINUTE', 10))->by((string) optional($request->user())->getAuthIdentifier()),
        ]);

        RateLimiter::for('ai.chat', fn (Request $request) => [
            Limit::perMinute((int) env('RATE_LIMIT_AI_CHAT_PER_MINUTE', 10))
                ->by((string) (optional($request->user())->getAuthIdentifier() ?? $request->ip())),
        ]);

        RateLimiter::for('search.ask', fn (Request $request) => [
            Limit::perMinute(20)->by($request->user()?->id ?: $request->ip()),
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

    /**
     * The rule set production actually enforces.
     *
     * Named and static so it can be asserted directly. `Password::defaults()`
     * short-circuits to a bare `min(8)` outside production — deliberately, so
     * the suite runs offline and fast — which means no request-level test can
     * ever reach these rules. Without this seam the strict policy would be
     * entirely uncovered, which is what the comment in boot() used to concede.
     */
    public static function productionRules(): Password
    {
        return Password::min(8)
            ->letters()
            ->mixedCase()
            ->numbers()
            ->symbols()
            ->uncompromised();
    }
}
