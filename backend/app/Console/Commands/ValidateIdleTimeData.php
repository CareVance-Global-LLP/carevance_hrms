<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Services\Reports\IdleValidationService;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class ValidateIdleTimeData extends Command
{
    protected $signature = 'reports:validate-idle-time 
                            {--start-date= : Start date (YYYY-MM-DD)}
                            {--end-date= : End date (YYYY-MM-DD)}
                            {--user-id= : Specific user ID to validate}
                            {--organization-id= : Organization ID to validate}
                            {--high-idle-ratio=95 : Minimum idle % to report (default 95)}';

    protected $description = 'Report users with high idle ratios for monitoring';

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
        $minRatio = max(1, min(100, (int) $this->option('high-idle-ratio'))) / 100;

        $this->info("Checking idle ratios >= {$this->option('high-idle-ratio')}% from {$startDate->toDateString()} to {$endDate->toDateString()}");

        $users = User::query()
            ->when($this->option('user-id'), fn ($q) => $q->where('id', (int) $this->option('user-id')))
            ->when($this->option('organization-id'), fn ($q) => $q->where('organization_id', (int) $this->option('organization-id')))
            ->get(['id', 'name', 'email']);

        $found = 0;
        foreach ($users as $user) {
            $tracked = (int) DB::table('time_entries')
                ->where('user_id', $user->id)
                ->whereBetween('start_time', [$startDate, $endDate])
                ->sum('duration');
            if ($tracked < 300) continue;

            $idle = (int) DB::table('activities')
                ->where('user_id', $user->id)
                ->where('type', 'idle')
                ->whereBetween('recorded_at', [$startDate, $endDate])
                ->sum('duration');

            $ratio = $tracked > 0 ? $idle / $tracked : 0;
            if ($ratio >= $minRatio) {
                $found++;
                $this->table(
                    ['User', 'Tracked', 'Idle', 'Idle %'],
                    [[$user->name, $this->fmt($tracked), $this->fmt($idle), round($ratio * 100, 1) . '%']]
                );
            }
        }

        $this->info($found ? "Found {$found} user(s) with high idle ratio" : 'No issues found');
    }

    private function fmt(int $seconds): string
    {
        $h = intdiv($seconds, 3600);
        $m = intdiv($seconds % 3600, 60);
        return $h ? "{$h}h {$m}m" : "{$m}m";
    }
}
