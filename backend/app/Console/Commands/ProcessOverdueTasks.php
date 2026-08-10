<?php

namespace App\Console\Commands;

use App\Models\Task;
use App\Services\AppNotificationService;
use Illuminate\Console\Command;

class ProcessOverdueTasks extends Command
{
    protected $signature = 'tasks:process-overdue';
    protected $description = 'Send notifications for overdue tasks';

    public function handle(AppNotificationService $notificationService): int
    {
        $now = now();
        $tasks = Task::query()
            ->whereNotNull('due_date')
            ->where('due_date', '<', $now->toDateString())
            ->where('status', '!=', 'done')
            ->whereNull('overdue_notified_at')
            ->with(['assignee', 'assignees', 'group', 'project'])
            ->get();

        $count = 0;
        foreach ($tasks as $task) {
            $organizationId = self::organizationIdFor($task);
            if (!$organizationId) continue;

            $userIds = collect([$task->assignee_id])
                ->merge($task->assignees->pluck('id'))
                ->filter()
                ->unique()
                ->values()
                ->toArray();

            if (empty($userIds)) continue;

            $notificationService->sendToUsers(
                organizationId: $organizationId,
                userIds: collect($userIds),
                senderId: null,
                type: 'task_overdue',
                title: "Task overdue: {$task->title}",
                message: "Task \"{$task->title}\" was due on {$task->due_date->toDateString()} but is still not completed.",
                meta: [
                    'route' => "/tasks/{$task->id}",
                    'task_id' => $task->id,
                    'status' => $task->status,
                ],
            );

            $task->update(['overdue_notified_at' => $now]);
            $count++;
        }

        $this->info("Sent {$count} overdue task notification(s).");
        return Command::SUCCESS;
    }

    /**
     * The organisation a task belongs to.
     *
     * Resolved through the group alone until now, and `tasks.group_id` is NULL
     * for every row on the live database — 54 of 54 — so this returned 0 every
     * time and the loop `continue`d past every task. Both the overdue notice
     * and the reminder were dead for 100% of tasks, not merely for ungrouped
     * ones. `tasks` has no organization_id of its own, so fall through the
     * relationships that do: group, then project, then the assignee.
     *
     * Shared by ProcessTaskReminders, which had the same defect.
     */
    public static function organizationIdFor(Task $task): int
    {
        return (int) (
            $task->group?->organization_id
            ?? $task->project?->organization_id
            ?? $task->assignee?->organization_id
            ?? $task->assignees->first()?->organization_id
            ?? 0
        );
    }
}
