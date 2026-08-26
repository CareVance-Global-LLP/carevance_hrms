<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Delete bearer tokens that have already expired.
 *
 * Nothing ever removed one. Logout deletes the token in the caller's hand and
 * that is all: every other session a person has ever opened stays in
 * `personal_access_tokens` until its row is deleted by hand, which is to say
 * forever. Production currently holds 272 rows for 7 people, one account
 * carrying 90 of them.
 *
 * Two reasons that matters, and only the second is about storage:
 *
 * - "Where you are signed in" reads this table. A list is only usable if the
 *   rows in it are sessions somebody actually has, and while the endpoint
 *   filters expired rows out of the response, an unbounded table behind it is
 *   a query that gets slower every week for no benefit.
 * - A row that can never authenticate again is a hash of a credential kept
 *   past any purpose it served. Deleting it is the smallest possible version
 *   of "kept only as long as it serves the stated purpose".
 *
 * This is housekeeping, NOT revocation. AuthenticateApiToken already refuses
 * an expired token — it filters on `expires_at` in the lookup — so nothing
 * here changes who can sign in or when. That is what makes running it nightly
 * and unattended safe.
 *
 * A NULL `expires_at` is never touched. It means "does not expire", not
 * "expired long ago", and the two are one careless `orWhereNull` apart.
 *
 * Deleted in bounded batches rather than one statement: the table has an index
 * on `token` and none on `expires_at`, so the first run after this ships scans
 * the table, and a single unbounded DELETE would hold locks on every row it
 * touched for the length of that scan.
 */
class PurgeExpiredApiTokens extends Command
{
    protected $signature = 'tokens:purge-expired
        {--dry-run : Report what would be deleted without deleting it}
        {--grace-days=7 : Keep expired tokens this many days before deleting}
        {--chunk=1000 : Rows to delete per batch}';

    protected $description = 'Delete personal access tokens that expired more than the grace period ago';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $graceDays = max(0, (int) $this->option('grace-days'));
        $chunkSize = max(100, (int) $this->option('chunk'));

        /*
         * A grace period, rather than deleting the moment a token lapses.
         *
         * An expired session is the one a person is most likely to be looking
         * for — "I signed in on a machine at the airport last Tuesday, was that
         * me?" — and it is also the row an incident investigation wants. Seven
         * days costs nothing and keeps the audit trail's neighbour alive long
         * enough to be read. It cannot extend anybody's access: the token
         * stopped working the moment it expired, whatever this command does.
         */
        $cutoff = now()->subDays($graceDays);

        $matching = DB::table('personal_access_tokens')
            ->whereNotNull('expires_at')
            ->where('expires_at', '<', $cutoff);

        $expiredCount = (clone $matching)->count();

        if ($expiredCount === 0) {
            $this->info('No expired tokens to remove.');

            return self::SUCCESS;
        }

        if ($dryRun) {
            $this->info(sprintf(
                'Would delete %d token(s) that expired before %s [dry run].',
                $expiredCount,
                $cutoff->toDateTimeString(),
            ));

            return self::SUCCESS;
        }

        $deleted = 0;

        do {
            $batch = (clone $matching)
                ->orderBy('id')
                ->limit($chunkSize)
                ->pluck('id')
                ->all();

            if ($batch === []) {
                break;
            }

            $deleted += DB::table('personal_access_tokens')
                ->whereIn('id', $batch)
                ->delete();
        } while (count($batch) === $chunkSize);

        Log::info('Expired API tokens purged.', [
            'rows_deleted' => $deleted,
            'grace_days' => $graceDays,
            'cutoff' => $cutoff->toDateTimeString(),
        ]);

        $this->info(sprintf(
            'Deleted %d token(s) that expired before %s.',
            $deleted,
            $cutoff->toDateTimeString(),
        ));

        return self::SUCCESS;
    }
}
