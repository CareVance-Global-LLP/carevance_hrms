<?php

namespace App\Console\Commands;

use App\Services\Monitoring\MonitoringAlertEvaluator;
use Carbon\Carbon;
use Illuminate\Console\Command;

/**
 * Runs the monitoring alert rules for a completed day.
 *
 * Yesterday by default, not today: a rule like "tracked less than six hours"
 * is meaningless at 9am, and firing it against a day still in progress would
 * alert on every employee every morning until the system was ignored.
 */
class EvaluateMonitoringAlerts extends Command
{
    protected $signature = 'monitoring:evaluate-alerts
        {--date= : The day to evaluate (Y-m-d). Defaults to yesterday.}';

    protected $description = 'Evaluate monitoring alert rules and notify admins about what breached';

    public function handle(MonitoringAlertEvaluator $evaluator): int
    {
        $date = $this->option('date')
            ? Carbon::parse($this->option('date'))
            : Carbon::yesterday();

        $result = $evaluator->evaluateForDate($date);

        $this->info(sprintf(
            'Evaluated %d rule(s) for %s and raised %d notification(s).',
            $result['rules'],
            $date->toDateString(),
            $result['notifications']
        ));

        return self::SUCCESS;
    }
}
