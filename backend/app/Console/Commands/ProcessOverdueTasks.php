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
            ->with(['assignee', 'assignees', 'group.organization'])
            ->get();

        $count = 0;
        foreach ($tasks as $task) {
            $organizationId = (int) ($task->group?->organization_id ?? 0);
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
}
