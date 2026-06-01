<?php

namespace App\Console\Commands;

use App\Models\ChatGroupMessage;
use App\Models\ChatMessage;
use Illuminate\Console\Command;
use Carbon\Carbon;

class CleanupOldChatMessages extends Command
{
    protected $signature = 'chat:cleanup-old-messages
                            {--days=60 : Number of days after which messages should be deleted}
                            {--dry-run : Show what would be deleted without actually deleting}';

    protected $description = 'Delete chat messages older than specified days (default: 60 days)';

    public function handle(): int
    {
        $days = (int) $this->option('days');
        $dryRun = $this->option('dry-run');
        $cutoffDate = Carbon::now()->subDays($days);

        $this->info("Cleaning up chat messages older than {$days} days (before: {$cutoffDate->toDateTimeString()})");

        if ($dryRun) {
            $this->warn('DRY RUN MODE - No messages will actually be deleted');
        }

        // Count messages to be deleted
        $directMessagesCount = ChatMessage::where('created_at', '<', $cutoffDate)->count();
        $groupMessagesCount = ChatGroupMessage::where('created_at', '<', $cutoffDate)->count();

        $this->info("Found {$directMessagesCount} direct messages to delete");
        $this->info("Found {$groupMessagesCount} group messages to delete");

        if ($dryRun) {
            $this->info('Dry run completed. No messages were deleted.');
            return self::SUCCESS;
        }

        // Delete in batches to avoid memory issues
        $batchSize = 1000;
        $totalDeleted = 0;

        // Delete direct messages
        $this->info('Deleting old direct messages...');
        do {
            $deleted = ChatMessage::where('created_at', '<', $cutoffDate)
                ->limit($batchSize)
                ->delete();
            $totalDeleted += $deleted;
            $this->info("Deleted {$deleted} direct messages (total: {$totalDeleted})");
        } while ($deleted > 0);

        // Delete group messages
        $this->info('Deleting old group messages...');
        do {
            $deleted = ChatGroupMessage::where('created_at', '<', $cutoffDate)
                ->limit($batchSize)
                ->delete();
            $totalDeleted += $deleted;
            $this->info("Deleted {$deleted} group messages (total: {$totalDeleted})");
        } while ($deleted > 0);

        $this->info("Cleanup completed. Total messages deleted: {$totalDeleted}");

        return self::SUCCESS;
    }
}
