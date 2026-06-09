<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Services\Reports\IdleValidationService;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class ValidateIdleTimeData extends Command
{
    protected $signature = 'reports:validate-idle-time 
                            {--start-date= : Start date (YYYY-MM-DD)}
                            {--end-date= : End date (YYYY-MM-DD)}
                            {--user-id= : Specific user ID to validate}
                            {--organization-id= : Organization ID to validate}
                            {--dry-run : Show changes without applying}
                            {--show-issues-only : Only show suspicious cases}';

    protected $description = 'Validate and optionally fix idle time data for users';

    private IdleValidationService $idleValidationService;

    public function __construct(IdleValidationService $idleValidationService)
    {
        parent::__construct();
        $this->idleValidationService = $idleValidationService;
    }

    public function handle()
    {
        $startDate = $this->option('start-date') 
            ? Carbon::parse($this->option('start-date'))->startOfDay()
            : Carbon::now()->startOfDay();
            
        $endDate = $this->option('end-date') 
            ? Carbon::parse($this->option('end-date'))->endOfDay()
            : Carbon::now()->endOfDay();
            
        $dryRun = $this->option('dry-run');
        $showIssuesOnly = $this->option('show-issues-only');

        $this->info("Validating idle time data from {$startDate->toDateString()} to {$endDate->toDateString()}");
        
        if ($dryRun) {
            $this->warn('DRY RUN MODE - No changes will be made');
        }

        // Get users to validate
        $query = User::query();
        
        if ($this->option('user-id')) {
            $query->where('id', (int) $this->option('user-id'));
        } elseif ($this->option('organization-id')) {
            $query->where('organization_id', (int) $this->option('organization-id'));
        }
        
        $users = $query->get(['id', 'name', 'email', 'organization_id']);
        
        $this->info("Found {$users->count()} users to validate");
        
        $issuesFound = 0;
        $issuesFixed = 0;
        $progressBar = $this->output->createProgressBar($users->count());
        
        foreach ($users as $user) {
            $result = $this->validateUserIdle($user, $startDate, $endDate, $dryRun);
            
            if ($result['has_issue']) {
                $issuesFound++;
                
                if (!$showIssuesOnly || $result['corrected']) {
                    $this->newLine();
                    $this->warn("Issue found for user: {$user->name} (ID: {$user->id})");
                    $this->table(
                        ['Metric', 'Value'],
                        [
                            ['Tracked Duration', $this->formatDuration($result['tracked'])],
                            ['Original Idle', $this->formatDuration($result['original_idle'])],
                            ['Corrected Idle', $this->formatDuration($result['corrected_idle'])],
                            ['Working Duration', $this->formatDuration($result['working'])],
                            ['Idle Ratio Before', $result['idle_ratio_before'] . '%'],
                            ['Idle Ratio After', $result['idle_ratio_after'] . '%'],
                            ['Reason', $result['reason']],
                        ]
                    );
                }
                
                if ($result['corrected'] && !$dryRun) {
                    $issuesFixed++;
                }
            }
            
            $progressBar->advance();
        }
        
        $progressBar->finish();
        $this->newLine(2);
        
        $this->info("Summary:");
        $this->info("  Users checked: {$users->count()}");
        $this->info("  Issues found: {$issuesFound}");
        $this->info("  Issues fixed: {$issuesFixed}");
        
        if ($dryRun && $issuesFound > 0) {
            $this->info("  Run without --dry-run to apply fixes");
        }
        
        return 0;
    }
    
    private function validateUserIdle($user, Carbon $startDate, Carbon $endDate, bool $dryRun): array
    {
        // Get tracked duration
        $trackedSeconds = DB::table('time_entries')
            ->where('user_id', $user->id)
            ->whereBetween('start_time', [$startDate, $endDate])
            ->sum('duration') ?? 0;
            
        // Get idle duration
        $idleSeconds = DB::table('activities')
            ->where('user_id', $user->id)
            ->where('type', 'idle')
            ->whereBetween('recorded_at', [$startDate, $endDate])
            ->sum('duration') ?? 0;
            
        // Get activity duration
        $activitySeconds = DB::table('activities')
            ->where('user_id', $user->id)
            ->whereBetween('recorded_at', [$startDate, $endDate])
            ->sum('duration') ?? 0;
            
        // Validate
        $validated = $this->idleValidationService->validateIdleTime(
            $user->id,
            (int) $trackedSeconds,
            (int) $idleSeconds,
            (int) $activitySeconds,
            [
                'source' => 'console_validation',
                'start_date' => $startDate->toDateTimeString(),
                'end_date' => $endDate->toDateTimeString(),
            ]
        );
        
        $hasIssue = $validated['corrected'];
        $idleRatioBefore = $trackedSeconds > 0 
            ? round(($validated['original_idle'] / $trackedSeconds) * 100, 1) 
            : 0;
        $idleRatioAfter = $trackedSeconds > 0 
            ? round(($validated['idle_duration'] / $trackedSeconds) * 100, 1) 
            : 0;
        
        return [
            'has_issue' => $hasIssue,
            'corrected' => $validated['corrected'] && !$dryRun,
            'tracked' => $trackedSeconds,
            'original_idle' => $validated['original_idle'],
            'corrected_idle' => $validated['idle_duration'],
            'working' => $validated['working_duration'],
            'reason' => $validated['reason'],
            'idle_ratio_before' => $idleRatioBefore,
            'idle_ratio_after' => $idleRatioAfter,
        ];
    }
    
    private function formatDuration(int $seconds): string
    {
        $hours = floor($seconds / 3600);
        $minutes = floor(($seconds % 3600) / 60);
        $secs = $seconds % 60;
        
        if ($hours > 0) {
            return sprintf('%dh %dm %ds', $hours, $minutes, $secs);
        } elseif ($minutes > 0) {
            return sprintf('%dm %ds', $minutes, $secs);
        } else {
            return sprintf('%ds', $secs);
        }
    }
}
