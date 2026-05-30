<?php

namespace App\Services\Tasks;

use App\Models\Task;
use App\Models\TaskActivity;
use App\Models\User;

class TaskActivityService
{
    public function log(
        Task $task,
        User $actor,
        string $action,
        string $description,
        ?array $meta = null
    ): TaskActivity {
        return TaskActivity::create([
            'task_id' => $task->id,
            'actor_id' => $actor->id,
            'action' => $action,
            'description' => $description,
            'meta' => $meta,
        ]);
    }

    public function logCreated(Task $task, User $actor): void
    {
        $this->log($task, $actor, 'created', "Task created by {$actor->name}");
    }

    public function logStatusChanged(Task $task, User $actor, string $oldStatus, string $newStatus): void
    {
        if ($oldStatus === $newStatus) {
            return;
        }
        $this->log($task, $actor, 'status_changed', "Status changed from {$oldStatus} to {$newStatus}", [
            'old' => $oldStatus,
            'new' => $newStatus,
        ]);
    }

    public function logAssigneeChanged(Task $task, User $actor, ?User $oldAssignee, array $newAssigneeIds): void
    {
        $oldIds = $oldAssignee ? [$oldAssignee->id] : [];
        $oldSet = collect($oldIds);
        $newSet = collect($newAssigneeIds)->filter(fn ($id) => $id > 0)->unique()->values();

        $added = $newSet->diff($oldSet);
        $removed = $oldSet->diff($newSet);

        if ($added->isNotEmpty() && $removed->isEmpty()) {
            $names = User::whereIn('id', $added)->pluck('name')->implode(', ');
            $this->log($task, $actor, 'assignee_changed', "Assigned to {$names}", [
                'added' => $added->all(),
            ]);
        } elseif ($removed->isNotEmpty() && $added->isEmpty()) {
            $this->log($task, $actor, 'assignee_changed', 'Assignee removed', [
                'removed' => $removed->all(),
            ]);
        } elseif ($added->isNotEmpty() && $removed->isNotEmpty()) {
            $addedNames = User::whereIn('id', $added)->pluck('name')->implode(', ');
            $this->log($task, $actor, 'assignee_changed', "Assignees updated: added {$addedNames}", [
                'added' => $added->all(),
                'removed' => $removed->all(),
            ]);
        }
    }

    public function logPriorityChanged(Task $task, User $actor, string $oldPriority, string $newPriority): void
    {
        if ($oldPriority === $newPriority) {
            return;
        }
        $this->log($task, $actor, 'priority_changed', "Priority changed from {$oldPriority} to {$newPriority}", [
            'old' => $oldPriority,
            'new' => $newPriority,
        ]);
    }

    public function logDueDateChanged(Task $task, User $actor, ?string $oldDate, ?string $newDate): void
    {
        if ($oldDate === $newDate) {
            return;
        }
        $desc = $oldDate
            ? "Due date changed from {$oldDate} to {$newDate}"
            : "Due date set to {$newDate}";
        $this->log($task, $actor, 'due_date_changed', $desc, [
            'old' => $oldDate,
            'new' => $newDate,
        ]);
    }

    public function logTitleChanged(Task $task, User $actor, string $oldTitle, string $newTitle): void
    {
        if ($oldTitle === $newTitle) {
            return;
        }
        $this->log($task, $actor, 'title_changed', "Title changed from \"{$oldTitle}\" to \"{$newTitle}\"", [
            'old' => $oldTitle,
            'new' => $newTitle,
        ]);
    }

    public function getActivities(Task $task, int $limit = 50): array
    {
        return TaskActivity::where('task_id', $task->id)
            ->with('actor:id,name,email')
            ->orderBy('created_at', 'desc')
            ->limit($limit)
            ->get()
            ->toArray();
    }
}
