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
            ->with(['assignee', 'assignees', 'group', 'project'])
            ->get();

        $count = 0;
        foreach ($tasks as $task) {
            // Same defect as ProcessOverdueTasks: resolved solely through the
            // group, and every task on the live database has a NULL group_id,
            // so no reminder had ever been sent.
            $organizationId = ProcessOverdueTasks::organizationIdFor($task);
            if (!$organizationId) continue;

            $userIds = collect([$task->assignee_id])
                ->merge($task->assignees->pluck('id'))
                ->filter()
                ->unique()
                ->values()
                ->toArray();

            if (empty($userIds)) continue;

            // Called a `send()` method that does not exist on
            // AppNotificationService — the only public method is sendToUsers(),
            // with named arguments rather than an array. This threw
            // BadMethodCallException on the first task carrying a reminder.
            // Nothing noticed because no scheduler was running in production;
            // now that one is, this would have fataled every minute.
            // Matched to the working call in ProcessOverdueTasks.
            $notificationService->sendToUsers(
                organizationId: $organizationId,
                userIds: collect($userIds),
                senderId: null,
                type: 'task_assigned',
                title: "Reminder: {$task->title}",
                message: "Task \"{$task->title}\" is due soon.",
                meta: [
                    'route' => "/tasks/{$task->id}",
                    'task_id' => $task->id,
                    'status' => $task->status,
                ],
            );

            $task->update(['reminded_at' => $now]);
            $count++;
        }

        $this->info("Sent {$count} task reminder(s).");
        return Command::SUCCESS;
    }
}
