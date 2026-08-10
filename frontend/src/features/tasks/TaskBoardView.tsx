import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { Task } from '@/types';
import { cn } from '@/utils/cn';
import { getReadableTextColor } from '@/utils/getContrastColor';
import TaskAvatar from './TaskAvatar';
import { PRIORITY_META, STATUS_OPTIONS, type TaskStatus } from './taskConstants';
import { formatDate, isOverdue, sortTasks } from './taskUtils';

interface TaskBoardViewProps {
  tasks: Task[];
  canManageTasks: boolean;
  onOpenTask: (task: Task) => void;
  onChangeStatus: (task: Task, status: TaskStatus) => void;
  onAddTask: (status: TaskStatus) => void;
}

function BoardColumn({
  status,
  children,
  isEmpty,
}: {
  status: TaskStatus;
  children: React.ReactNode;
  isEmpty: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `column-${status}` });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-[8rem] flex-col gap-2 rounded-lg border p-2 transition-colors',
        isOver ? 'border-sky-400 bg-sky-50/60' : 'border-slate-200 bg-slate-50',
        isEmpty && !isOver ? 'border-dashed' : ''
      )}
    >
      {children}
    </div>
  );
}

function DraggableCard({ task, children }: { task: Task; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task-${task.id}`,
    data: { task },
  });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={isDragging ? 'opacity-40' : undefined}>
      {children}
    </div>
  );
}

/**
 * The board, kept as a peer of the list rather than the only way in.
 *
 * A card is now a title, a due chip and an avatar. The six-field detail grid it
 * used to carry moved to the slide-over, which takes the column from about two
 * visible cards to eight or so — the difference between a board you can plan
 * against and one you scroll.
 */
export default function TaskBoardView({
  tasks,
  canManageTasks,
  onOpenTask,
  onChangeStatus,
  onAddTask,
}: TaskBoardViewProps) {
  const [activeDragTask, setActiveDragTask] = useState<Task | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(event: DragStartEvent) => {
        setActiveDragTask((event.active.data.current?.task as Task | undefined) ?? null);
      }}
      onDragEnd={(event: DragEndEvent) => {
        setActiveDragTask(null);
        const { active, over } = event;
        if (!over) return;

        const targetStatus = String(over.id).replace('column-', '') as TaskStatus;
        if (!STATUS_OPTIONS.some((option) => option.value === targetStatus)) return;

        const taskId = Number(String(active.id).replace('task-', ''));
        const task = tasks.find((candidate) => candidate.id === taskId);
        if (!task || task.status === targetStatus) return;

        onChangeStatus(task, targetStatus);
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {STATUS_OPTIONS.map((section) => {
          const columnTasks = sortTasks(tasks.filter((task) => task.status === section.value));

          return (
            <BoardColumn key={section.value} status={section.value} isEmpty={columnTasks.length === 0}>
              <div className={cn('flex items-center justify-between rounded-md border px-2.5 py-1.5', section.accent)}>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700">
                    {section.label}
                  </span>
                  <span className="text-xs tabular-nums text-slate-600" aria-hidden="true">
                    {columnTasks.length}
                  </span>
                  <span className="sr-only">{columnTasks.length} tasks</span>
                </div>
                {canManageTasks ? (
                  <button
                    type="button"
                    aria-label={`Add a task to ${section.label}`}
                    onClick={() => onAddTask(section.value)}
                    className="rounded p-0.5 text-slate-600 transition hover:bg-white/70 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>

              <div className="flex max-h-[34rem] flex-col gap-2 overflow-y-auto">
                {columnTasks.length === 0 ? (
                  <p className="px-2 py-4 text-center text-xs text-slate-600">Nothing here.</p>
                ) : (
                  columnTasks.map((task) => {
                    const priority = PRIORITY_META[task.priority || 'medium'];
                    const overdue = isOverdue(task);

                    return (
                      <DraggableCard key={task.id} task={task}>
                        <article className="rounded-md border border-slate-200 bg-surface-card p-2.5 shadow-sm transition hover:border-slate-300">
                          <button
                            type="button"
                            onClick={() => onOpenTask(task)}
                            className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                          >
                            <p
                              className={cn(
                                'line-clamp-2 text-sm font-medium leading-snug',
                                task.status === 'done' ? 'text-slate-600' : 'text-slate-950'
                              )}
                            >
                              {task.title}
                            </p>
                          </button>

                          {task.labels?.length ? (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {task.labels.slice(0, 3).map((label) => (
                                <span
                                  key={label.id}
                                  className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                                  style={{ backgroundColor: label.color, color: getReadableTextColor(label.color) }}
                                >
                                  {label.name}
                                </span>
                              ))}
                            </div>
                          ) : null}

                          <div className="mt-2 flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              {task.due_date ? (
                                <span
                                  className={cn(
                                    'truncate text-[11px] tabular-nums',
                                    overdue ? 'font-semibold text-rose-700' : 'text-slate-600'
                                  )}
                                >
                                  {formatDate(task.due_date)}
                                </span>
                              ) : null}
                              {task.priority && task.priority !== 'medium' ? (
                                <span className={cn('text-[10px] uppercase tracking-wide', priority?.className)}>
                                  {priority?.label}
                                </span>
                              ) : null}
                            </div>
                            <TaskAvatar task={task} className="h-5 w-5 text-[8px]" />
                          </div>
                        </article>
                      </DraggableCard>
                    );
                  })
                )}
              </div>
            </BoardColumn>
          );
        })}
      </div>

      <DragOverlay>
        {activeDragTask ? (
          <div className="rounded-md border border-sky-400 bg-surface-card p-2.5 shadow-lg">
            <p className="line-clamp-2 text-sm font-medium text-slate-950">{activeDragTask.title}</p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
