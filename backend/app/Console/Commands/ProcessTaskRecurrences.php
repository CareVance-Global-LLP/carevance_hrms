<?php

namespace App\Console\Commands;

use App\Models\Task;
use App\Models\TaskRecurrence;
use Illuminate\Console\Command;

class ProcessTaskRecurrences extends Command
{
    protected $signature = 'tasks:process-recurrences';
    protected $description = 'Generate recurring tasks';

    public function handle(): int
    {
        $now = now()->startOfDay();
        $recurrences = TaskRecurrence::query()
            ->where('is_active', true)
            ->where('next_run_date', '<=', $now)
            ->where(function ($q) use ($now) {
                $q->whereNull('end_date')->orWhere('end_date', '>=', $now);
            })
            ->get();

        $count = 0;
        foreach ($recurrences as $rec) {
            $task = Task::create([
                'group_id' => $rec->template_group_id,
                'project_id' => $rec->template_project_id,
                'title' => $rec->template_title,
                'description' => $rec->template_description,
                'priority' => $rec->template_priority,
                'estimated_time' => $rec->template_estimated_time,
                'status' => 'todo',
            ]);

            if ($rec->template_assignee_ids) {
                $task->assignees()->sync($rec->template_assignee_ids);
            }

            if ($rec->template_label_ids) {
                $task->labels()->sync($rec->template_label_ids);
            }

            $rec->update(['next_run_date' => $this->computeNextRun($rec)]);
            $count++;
        }

        $this->info("Generated {$count} recurring task(s).");
        return Command::SUCCESS;
    }

    private function computeNextRun(TaskRecurrence $rec): string
    {
        $next = \Carbon\Carbon::parse($rec->next_run_date);
        $interval = max(1, (int) $rec->interval_value);

        return match ($rec->frequency) {
            'daily' => $next->addDays($interval)->toDateString(),
            'weekly' => $next->addWeeks($interval)->toDateString(),
            'monthly' => $next->addMonths($interval)->toDateString(),
            'yearly' => $next->addYears($interval)->toDateString(),
            default => $next->addDays($interval)->toDateString(),
        };
    }
}
