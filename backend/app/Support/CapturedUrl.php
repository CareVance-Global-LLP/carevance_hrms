<?php

namespace App\Support;

/**
 * Removes the parts of a captured URL that carry secrets rather than describe
 * a page.
 *
 * The desktop agent strips these before sending, but the server must not rely
 * on that: an older build, a replayed offline queue, or any future client can
 * all post a raw URL, and by the time it is in `activity_sessions.url` it is
 * readable by every admin who opens the timeline and included in CSV exports.
 *
 * Found on 17 Aug 2026 in this database — a single captured visit holding a
 * complete OAuth callback: `code` (66 characters), `state`, `session_state`
 * and `iss`. A live authorization code, recorded by accident, because the
 * document-source branch stored whatever the browser reported verbatim.
 *
 * A productivity report needs to know which page somebody was on. It has never
 * needed the credentials used to get there.
 */
class CapturedUrl
{
    /**
     * @param string|null $url
     * @param string $detailLevel `full` keeps the path, `host` reduces to the
     *        domain, `off` records no address at all. The query string is
     *        stripped at every level — an organisation may choose how much
     *        detail to keep, never whether to keep credentials.
     * @return string|null
     */
    public static function sanitize(?string $url, string $detailLevel = 'full'): ?string
    {
        if ($detailLevel === 'off') {
            return null;
        }

        $value = trim((string) $url);
        if ($value === '') {
            return null;
        }

        $parts = parse_url($value);
        if ($parts === false || empty($parts['host'])) {
            // Not parseable as a URL. Returned unchanged rather than dropped —
            // callers store labels here too, and silently emptying one would
            // lose a legitimate row to a parsing quirk.
            return $value;
        }

        $scheme = isset($parts['scheme']) ? $parts['scheme'] . '://' : '//';
        $host = $parts['host'];
        $port = isset($parts['port']) ? ':' . $parts['port'] : '';
        $path = $parts['path'] ?? '';

        /*
         * Hash routing puts the real page in the fragment (`#/me/attendance`),
         * so it is kept — unless it carries `key=value` pairs, which is how the
         * OAuth implicit flow returns access_token and id_token.
         */
        $fragment = '';
        if (isset($parts['fragment']) && $parts['fragment'] !== '' && ! str_contains($parts['fragment'], '=')) {
            $fragment = '#' . $parts['fragment'];
        }

        // `user` and `pass` are dropped by never being reassembled.
        if ($detailLevel === 'host') {
            return $scheme . $host . $port;
        }

        return $scheme . $host . $port . $path . $fragment;
    }
}
