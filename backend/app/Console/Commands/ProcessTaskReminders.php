<?php

namespace App\Console\Commands;

use App\Models\Task;
use App\Services\AppNotificationService;
use Illuminate\Console\Command;

class ProcessTaskReminders extends Command
{
    protected $signature = 'tasks:process-reminders';
    protected $description = 'Send notifications for task reminders';

    public function handle(AppNotificationService $notificationService): int
    {
        $now = now();
        $tasks = Task::query()
            ->whereNotNull('remind_at')
            ->whereNull('reminded_at')
            ->where('remind_at', '<=', $now)
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

            $notificationService->send([
                'organizationId' => $organizationId,
                'userIds' => $userIds,
                'senderId' => null,
                'type' => 'task_assigned',
                'title' => "Reminder: {$task->title}",
                'message' => "Task \"{$task->title}\" is due soon.",
                'meta' => [
                    'route' => "/tasks/{$task->id}",
                    'task_id' => $task->id,
                    'status' => $task->status,
                ],
            ]);

            $task->update(['reminded_at' => $now]);
            $count++;
        }

        $this->info("Sent {$count} task reminder(s).");
        return Command::SUCCESS;
    }
}
