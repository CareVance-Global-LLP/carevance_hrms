<?php

namespace Tests\Feature;

use Tests\TestCase;

/**
 * Having Redis credentials must never, on its own, select Redis.
 *
 * `.env.example` ships `REDIS_HOST=127.0.0.1`, so every deployment inherits
 * Redis credentials whether or not a Redis is running. Three config files used
 * to read `env('REDIS_HOST') ? 'redis' : 'database'`, which turned that
 * inherited value into a driver choice nobody made.
 *
 * No environment here has the phpredis extension, so the cache store resolved
 * to Redis and then threw `Class "Redis" not found` from inside
 * ThrottleRequests -> RateLimiter -> RedisStore — before any controller ran.
 * Every throttled route returned 500, and on this app the throttled routes are
 * login, check-email, register and password reset: the entire way in. Seen
 * locally 19 Aug 2026, and in the AWS deployment 20 Aug 2026, where a `.env`
 * without `CACHE_STORE` was enough to lock everybody out.
 *
 * The defaults are asserted by reading the config files with a simulated
 * environment rather than by reading the booted config, so the test fails on
 * the trap being reintroduced even when the local .env happens to mask it.
 */
class RedisIsOptInTest extends TestCase
{
    /** @return array<string, array{0: string, 1: string}> */
    public static function driverConfigs(): array
    {
        return [
            'cache store' => ['config/cache.php', 'default'],
            'session driver' => ['config/session.php', 'driver'],
            'queue connection' => ['config/queue.php', 'default'],
        ];
    }

    /**
     * @dataProvider driverConfigs
     */
    public function test_redis_credentials_alone_do_not_select_redis(string $configPath, string $key): void
    {
        $resolved = $this->resolveWithRedisCredentialsButNoExplicitDriver($configPath, $key);

        $this->assertNotSame(
            'redis',
            $resolved,
            sprintf(
                '%s resolved to redis with only REDIS_HOST set. Merely having Redis '
                .'credentials must not choose the driver — .env.example ships them, '
                .'phpredis is not installed, and the failure locks every user out at login.',
                $configPath,
            ),
        );

        $this->assertSame('database', $resolved);
    }

    public function test_redis_is_still_selectable_when_asked_for_explicitly(): void
    {
        // The point is to remove an accident, not the capability.
        putenv('CACHE_STORE=redis');
        $_ENV['CACHE_STORE'] = 'redis';

        try {
            $this->assertSame('redis', $this->readConfig('config/cache.php')['default']);
        } finally {
            putenv('CACHE_STORE');
            unset($_ENV['CACHE_STORE']);
        }
    }

    /**
     * Read the config file with REDIS_HOST present and the explicit driver
     * variable absent — the exact shape of a deployment that copied
     * .env.example and never set CACHE_STORE.
     */
    private function resolveWithRedisCredentialsButNoExplicitDriver(string $configPath, string $key): mixed
    {
        $explicit = [
            'config/cache.php' => 'CACHE_STORE',
            'config/session.php' => 'SESSION_DRIVER',
            'config/queue.php' => 'QUEUE_CONNECTION',
        ][$configPath];

        $previous = getenv($explicit);
        putenv($explicit);
        unset($_ENV[$explicit]);

        putenv('REDIS_HOST=127.0.0.1');
        $_ENV['REDIS_HOST'] = '127.0.0.1';

        try {
            return $this->readConfig($configPath)[$key];
        } finally {
            if ($previous !== false) {
                putenv($explicit.'='.$previous);
                $_ENV[$explicit] = $previous;
            }
        }
    }

    /** @return array<string, mixed> */
    private function readConfig(string $relativePath): array
    {
        return require base_path($relativePath);
    }
}
