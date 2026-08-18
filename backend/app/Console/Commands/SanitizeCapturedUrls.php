<?php

namespace App\Console\Commands;

use App\Models\ActivitySession;
use App\Support\CapturedUrl;
use Illuminate\Console\Command;

/**
 * Removes credentials from URLs captured before sanitising existed.
 *
 * The desktop agent and the API both strip query strings now, but rows written
 * earlier still hold whatever the browser reported. On this database that
 * included a complete OAuth callback — `code`, `state`, `session_state` — a
 * live authorization code sitting in a table every admin can read and export.
 *
 * Rewrites in place. There is no undo, and that is the intent: the whole point
 * is that the credential stops existing. Run --dry-run first if you want to see
 * the scale before committing to it.
 */
class SanitizeCapturedUrls extends Command
{
    protected $signature = 'monitoring:sanitize-urls
        {--dry-run : Report what would change without writing}
        {--chunk=500 : Rows to process at a time}';

    protected $description = 'Strip query strings and userinfo from URLs already stored on activity sessions';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $chunk = max(50, (int) $this->option('chunk'));

        $scanned = 0;
        $changed = 0;
        $samples = [];

        ActivitySession::query()
            ->withoutGlobalScopes()
            ->whereNotNull('url')
            ->where('url', '<>', '')
            ->orderBy('id')
            ->chunkById($chunk, function ($sessions) use (&$scanned, &$changed, &$samples, $dryRun) {
                foreach ($sessions as $session) {
                    $scanned++;
                    $original = (string) $session->url;
                    $safe = CapturedUrl::sanitize($original);

                    if ($safe === null || $safe === $original) {
                        continue;
                    }

                    $changed++;
                    if (count($samples) < 5) {
                        // Hosts and paths only in the log: printing the value we are
                        // removing would defeat the point of removing it.
                        $samples[] = sprintf('#%d %s', $session->id, $safe);
                    }

                    if (! $dryRun) {
                        $session->timestamps = false;
                        $session->forceFill(['url' => $safe])->save();
                    }
                }
            });

        $this->line(sprintf('Scanned %d session URL(s).', $scanned));
        $this->line(sprintf('%s %d row(s).', $dryRun ? 'Would rewrite' : 'Rewrote', $changed));

        foreach ($samples as $sample) {
            $this->line('  → ' . $sample);
        }

        if ($dryRun && $changed > 0) {
            $this->comment('Run again without --dry-run to apply.');
        }

        return self::SUCCESS;
    }
}
