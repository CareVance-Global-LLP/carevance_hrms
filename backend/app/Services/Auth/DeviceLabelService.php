<?php

namespace App\Services\Auth;

/**
 * Turn a stored user agent into something a person recognises.
 *
 * The one rule, taken verbatim from the client-side helper this replaces
 * (SecurityPane's describeBrowser): nothing here is invented. If the user
 * agent does not say, the label does not claim. A half-parsed string is worse
 * than "Unknown device" — somebody deciding whether to revoke a session needs
 * to know when we cannot tell, not to be handed a plausible-looking guess and
 * revoke the wrong one.
 *
 * No dependency, and deliberately not a full UA database. A parser with
 * thousands of rules is the correct tool for analytics, where being wrong
 * about 2% of traffic costs nothing. Here the output is a security decision,
 * so the rule set is small enough to read and every branch is one somebody can
 * check against a real string.
 *
 * Order is load-bearing in both ladders:
 *
 * - Electron is tested FIRST, because our own desktop tracker's user agent
 *   contains "Chrome/" as well — Electron embeds Chromium. Testing Chrome
 *   first would label the desktop app as a browser, and "Chrome on Windows" is
 *   the row a user is most likely to assume is their actual browser.
 * - Edge and Opera before Chrome, and Chrome before Safari, because both
 *   Chromium forks carry "Chrome/" and every Chromium UA carries "Safari/".
 * - iPhone/iPad before Mac, because iPadOS reports "Macintosh" in desktop mode.
 */
class DeviceLabelService
{
    public const UNKNOWN = 'Unknown device';

    /**
     * Our own desktop shell. Electron builds its default user agent from the
     * app's productName, so this string is what CareVance Tracker sends; the
     * "Electron/" token is the reliable half and productName only confirms it.
     */
    public const DESKTOP = 'CareVance Desktop';

    /**
     * Break-glass tokens are minted for the CUSTOMER'S employee, not for the
     * engineer holding them, so one appears in that employee's own session
     * list as a device they never signed in from. Hiding it would defeat the
     * point of break-glass, which is that the customer can see it happening.
     * It is named for what it is instead.
     */
    public const SUPPORT = 'CareVance support access';

    public function describe(?string $userAgent): string
    {
        $ua = trim((string) $userAgent);

        if ($ua === '') {
            return self::UNKNOWN;
        }

        if ($this->isDesktopShell($ua)) {
            return self::DESKTOP;
        }

        $client = $this->client($ua);
        $platform = $this->platform($ua);

        if ($client !== null && $platform !== null) {
            return $client.' on '.$platform;
        }

        // One half alone is still a true statement, and true-but-vague beats
        // both a guess and a bare "Unknown" when we genuinely know something.
        return $client ?? $platform ?? self::UNKNOWN;
    }

    /**
     * The label for a whole token row, abilities included.
     *
     * @param  array<int, string>|string|null  $abilities  Raw JSON or a decoded list.
     */
    public function describeToken(?string $userAgent, array|string|null $abilities = null): string
    {
        if ($this->isBreakGlass($abilities)) {
            return self::SUPPORT;
        }

        return $this->describe($userAgent);
    }

    /** @param array<int, string>|string|null $abilities */
    private function isBreakGlass(array|string|null $abilities): bool
    {
        if (is_string($abilities)) {
            $decoded = json_decode($abilities, true);
            $abilities = is_array($decoded) ? $decoded : [];
        }

        foreach ($abilities ?? [] as $ability) {
            if (is_string($ability) && str_starts_with($ability, 'break_glass:')) {
                return true;
            }
        }

        return false;
    }

    private function isDesktopShell(string $ua): bool
    {
        return str_contains($ua, 'Electron/')
            || str_contains($ua, 'CareVance Tracker')
            || str_contains($ua, 'CareVance-Tracker');
    }

    private function client(string $ua): ?string
    {
        return match (true) {
            str_contains($ua, 'Edg/'), str_contains($ua, 'Edge/') => 'Edge',
            str_contains($ua, 'OPR/'), str_contains($ua, 'Opera') => 'Opera',
            str_contains($ua, 'SamsungBrowser/') => 'Samsung Internet',
            str_contains($ua, 'Firefox/'), str_contains($ua, 'FxiOS/') => 'Firefox',
            str_contains($ua, 'CriOS/'), str_contains($ua, 'Chrome/') => 'Chrome',
            str_contains($ua, 'Safari/') => 'Safari',
            default => null,
        };
    }

    private function platform(string $ua): ?string
    {
        return match (true) {
            str_contains($ua, 'iPhone') => 'iPhone',
            str_contains($ua, 'iPad') => 'iPad',
            str_contains($ua, 'Android') => 'Android',
            str_contains($ua, 'Windows') => 'Windows',
            str_contains($ua, 'Mac OS X'), str_contains($ua, 'Macintosh') => 'macOS',
            str_contains($ua, 'CrOS') => 'ChromeOS',
            str_contains($ua, 'Linux') => 'Linux',
            default => null,
        };
    }
}
