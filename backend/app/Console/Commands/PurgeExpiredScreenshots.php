<?php

namespace App\Console\Commands;

use App\Models\Organization;
use App\Models\Screenshot;
use App\Services\Monitoring\TrackerPolicyResolver;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * Delete screenshots past their organization's retention window.
 *
 * Nothing deleted screenshots before this existed. Rows and image files
 * accumulated for the life of the deployment, which is both an unbounded
 * storage bill and the single easiest finding for a data-protection review to
 * write up — "kept only as long as they serve the stated purpose" needs a
 * mechanism behind it, not just a policy document.
 *
 * The row and the stored file are removed together. A row without its file is
 * a broken thumbnail in the gallery; a file without its row is an orphan
 * nothing will ever clean up, which is exactly the situation this command
 * exists to prevent.
 */
class PurgeExpiredScreenshots extends Command
{
    protected $signature = 'screenshots:purge
        {--dry-run : Report what would be deleted without deleting it}
        {--chunk=200 : Rows to process per batch}';

    protected $description = 'Delete screenshots past their organization retention window, files included';

    public function handle(TrackerPolicyResolver $policy): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $chunkSize = max(25, (int) $this->option('chunk'));
        $disk = Storage::disk('screenshots');

        $organizations = Organization::query()->get(['id', 'name', 'settings']);
        if ($organizations->isEmpty()) {
            $this->info('No organizations to process.');

            return self::SUCCESS;
        }

        $totalDeleted = 0;
        $totalFilesRemoved = 0;
        $totalMissingFiles = 0;

        foreach ($organizations as $organization) {
            $retentionDays = $policy->retentionDaysForOrganization($organization);
            $cutoff = now()->subDays($retentionDays);

            /*
             * Age is measured from captured_at where the client supplied it,
             * falling back to created_at. A screenshot buffered offline for two
             * days and synced today was *taken* two days ago, and the retention
             * clock has to run from when it was taken — otherwise a queue that
             * drains late silently extends the retention window.
             */
            $query = Screenshot::query()
                ->whereHas('timeEntry.user', fn ($q) => $q->where('organization_id', $organization->id))
                ->whereRaw('COALESCE(captured_at, created_at) < ?', [$cutoff]);

            $expiredCount = (clone $query)->count();
            if ($expiredCount === 0) {
                continue;
            }

            $this->line(sprintf(
                '%s: %d screenshot(s) older than %d day(s)%s',
                $organization->name,
                $expiredCount,
                $retentionDays,
                $dryRun ? ' [dry run]' : ''
            ));

            if ($dryRun) {
                $totalDeleted += $expiredCount;
                continue;
            }

            $orgDeleted = 0;
            $orgFilesRemoved = 0;
            $orgMissingFiles = 0;

            // Chunk by id rather than offset: deleting rows as we go shifts
            // every subsequent offset and would skip half the set.
            $query->orderBy('id')->chunkById($chunkSize, function ($screenshots) use (
                $disk,
                &$orgDeleted,
                &$orgFilesRemoved,
                &$orgMissingFiles
            ) {
                foreach ($screenshots as $screenshot) {
                    $filename = (string) $screenshot->filename;

                    if ($filename !== '') {
                        try {
                            if ($disk->exists($filename)) {
                                $disk->delete($filename);
                                $orgFilesRemoved++;
                            } else {
                                $orgMissingFiles++;
                            }
                        } catch (Throwable $e) {
                            // A file we cannot remove must not block the row's
                            // deletion — leaving the row would keep the image
                            // listed in the gallery forever.
                            Log::warning('Screenshot file could not be deleted during purge.', [
                                'screenshot_id' => (int) $screenshot->id,
                                'filename' => $filename,
                                'error' => $e->getMessage(),
                            ]);
                        }
                    }

                    $screenshot->delete();
                    $orgDeleted++;
                }
            });

            $totalDeleted += $orgDeleted;
            $totalFilesRemoved += $orgFilesRemoved;
            $totalMissingFiles += $orgMissingFiles;

            Log::info('Screenshot retention purge completed for organization.', [
                'organization_id' => (int) $organization->id,
                'retention_days' => $retentionDays,
                'rows_deleted' => $orgDeleted,
                'files_removed' => $orgFilesRemoved,
                'files_already_missing' => $orgMissingFiles,
            ]);
        }

        if ($totalDeleted === 0) {
            $this->info('Nothing past retention.');

            return self::SUCCESS;
        }

        $this->info(sprintf(
            '%s %d screenshot(s); %d file(s) removed, %d already missing.',
            $dryRun ? 'Would delete' : 'Deleted',
            $totalDeleted,
            $totalFilesRemoved,
            $totalMissingFiles
        ));

        return self::SUCCESS;
    }
}
