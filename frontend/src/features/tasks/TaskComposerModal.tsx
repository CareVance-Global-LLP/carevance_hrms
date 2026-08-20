import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import Button from '@/components/ui/Button';
import { FieldLabel, SelectInput, TextInput, TextareaInput } from '@/components/ui/FormField';
import type { Group, Project, Task, TaskLabel, User } from '@/types';
import { getReadableTextColor } from '@/utils/getContrastColor';
import { PRIORITY_OPTIONS, TYPE_OPTIONS, STATUS_OPTIONS, type TaskPriority, type TaskStatus } from './taskConstants';
import { titleCase } from './taskUtils';

export interface TaskFormState {
  title: string;
  description: string;
  group_id: string;
  project_id: string;
  assignee_id: string;
  assignee_ids: string[];
  status: TaskStatus;
  /** Bug / Story / Epic / Task — what kind of work this is. */
  type: NonNullable<Task['type']>;
  priority: TaskPriority;
  due_date: string;
  estimated_time: string;
  remind_at: string;
  label_ids: string[];
}

export const createTaskFormState = (groupId = '', status: TaskStatus = 'todo'): TaskFormState => ({
  title: '',
  description: '',
  group_id: groupId,
  project_id: '',
  assignee_id: '',
  assignee_ids: [],
  status,
  type: 'task',
  priority: 'medium',
  due_date: '',
  estimated_time: '',
  remind_at: '',
  label_ids: [],
});

/**
 * Populates the form from an existing task.
 *
 * The old version mapped `in_review` down to `todo` here, because the form's
 * status type excluded it — so opening an in-review task in the editor silently
 * demoted it before you had changed anything. All four statuses are real now.
 */
export const taskToFormState = (task: Task): TaskFormState => ({
  title: task.title,
  description: task.description || '',
  group_id: task.group_id ? String(task.group_id) : '',
  project_id: task.project_id ? String(task.project_id) : '',
  assignee_id: task.assignee_id ? String(task.assignee_id) : '',
  assignee_ids: task.assignees?.map((member) => String(member.id)) || (task.assignee_id ? [String(task.assignee_id)] : []),
  status: task.status,
  type: task.type || 'task',
  priority: task.priority || 'medium',
  due_date: task.due_date?.split('T')[0] || '',
  estimated_time: task.estimated_time ? String(task.estimated_time) : '',
  remind_at: task.remind_at?.split('T')[0] || '',
  label_ids: task.labels?.map((label) => String(label.id)) || [],
});

interface TaskComposerModalProps {
  isEditing: boolean;
  form: TaskFormState;
  onChange: (patch: Partial<TaskFormState>) => void;
  onSubmit: (resolvedGroupId: string) => void;
  onClose: () => void;
  isSaving: boolean;
  groups: Group[];
  users: User[];
  projects: Project[];
  labels: TaskLabel[];
  lockedGroupId: string;
}

export default function TaskComposerModal({
  isEditing,
  form,
  onChange,
  onSubmit,
  onClose,
  isSaving,
  groups,
  users,
  projects,
  labels,
  lockedGroupId,
}: TaskComposerModalProps) {
  const [assigneeDropdownOpen, setAssigneeDropdownOpen] = useState(false);

  const resolvedGroupId = form.group_id || lockedGroupId;
  const selectedGroupId = resolvedGroupId ? Number(resolvedGroupId) : null;

  const availableAssignees = useMemo(
    () => users.filter((member) => !selectedGroupId || member.groups?.some((group) => group.id === selectedGroupId)),
    [selectedGroupId, users]
  );
  const availableProjects = useMemo(
    () => projects.filter((project) => !selectedGroupId || Number(project.group_id) === Number(selectedGroupId)),
    [projects, selectedGroupId]
  );

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-surface-card p-6 shadow-modal sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Task composer</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">
              {isEditing ? 'Edit task' : 'Create task'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          className="mt-6 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(resolvedGroupId);
          }}
        >
          <div>
            <FieldLabel>Task Title</FieldLabel>
            <TextInput
              required
              value={form.title}
              onChange={(event) => onChange({ title: event.target.value })}
              placeholder="Prepare weekly performance review"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <FieldLabel>Department</FieldLabel>
              {lockedGroupId ? (
                <div className="min-h-11 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700">
                  {groups[0]?.name || 'Assigned department'}
                </div>
              ) : (
                <SelectInput
                  required
                  value={form.group_id}
                  onChange={(event) =>
                    onChange({ group_id: event.target.value, project_id: '', assignee_id: '', assignee_ids: [] })
                  }
                >
                  <option value="">Select department</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </SelectInput>
              )}
            </div>

            <div>
              <FieldLabel>Project</FieldLabel>
              <SelectInput
                value={form.project_id}
                onChange={(event) => onChange({ project_id: event.target.value })}
                disabled={!resolvedGroupId}
              >
                <option value="">{!resolvedGroupId ? 'Select department first' : 'No project'}</option>
                {availableProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </SelectInput>
            </div>

            <div>
              <FieldLabel>Assign To</FieldLabel>
              <div className="relative">
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center justify-between rounded-lg border border-slate-200 bg-surface-card px-3 py-2 text-left text-sm text-slate-800 shadow-sm transition hover:border-slate-300 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-600"
                  disabled={!resolvedGroupId}
                  aria-expanded={assigneeDropdownOpen}
                  onClick={() => setAssigneeDropdownOpen((current) => !current)}
                >
                  <span className="truncate">
                    {!resolvedGroupId
                      ? 'Select department first'
                      : form.assignee_ids.length === 0
                        ? 'Unassigned'
                        : `${form.assignee_ids.length} employee${form.assignee_ids.length === 1 ? '' : 's'} selected`}
                  </span>
                  <span className="text-slate-600" aria-hidden="true">
                    {assigneeDropdownOpen ? '▴' : '▾'}
                  </span>
                </button>
                {assigneeDropdownOpen && resolvedGroupId ? (
                  <div className="absolute z-30 mt-2 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-surface-card p-2 shadow-lg">
                    {availableAssignees.length === 0 ? (
                      <p className="px-2 py-2 text-xs text-slate-600">No employees available for this department.</p>
                    ) : (
                      availableAssignees.map((member) => {
                        const checked = form.assignee_ids.includes(String(member.id));
                        return (
                          <label
                            key={member.id}
                            className={`mb-1 flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm ${
                              checked ? 'bg-blue-50 text-blue-900' : 'text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => {
                                const nextIds = new Set(form.assignee_ids);
                                if (event.target.checked) nextIds.add(String(member.id));
                                else nextIds.delete(String(member.id));
                                const ordered = availableAssignees
                                  .map((item) => String(item.id))
                                  .filter((id) => nextIds.has(id));
                                onChange({ assignee_ids: ordered, assignee_id: ordered[0] || '' });
                              }}
                            />
                            <span className="truncate">{member.name}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                ) : null}
              </div>
              <p className="mt-2 text-xs text-slate-600">
                {!resolvedGroupId ? 'Select department first' : 'Pick more than one to share the task.'}
              </p>
            </div>

            <div>
              <FieldLabel>Status</FieldLabel>
              <SelectInput
                value={form.status}
                onChange={(event) => onChange({ status: event.target.value as TaskStatus })}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectInput>
            </div>

            <div>
              <FieldLabel>Type</FieldLabel>
              <SelectInput
                value={form.type}
                onChange={(event) => onChange({ type: event.target.value as NonNullable<Task['type']> })}
              >
                {TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectInput>
            </div>

            <div>
              <FieldLabel>Priority</FieldLabel>
              <SelectInput
                value={form.priority}
                onChange={(event) => onChange({ priority: event.target.value as TaskPriority })}
              >
                {PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority} value={priority}>
                    {titleCase(priority)}
                  </option>
                ))}
              </SelectInput>
            </div>

            <div>
              <FieldLabel>Due Date</FieldLabel>
              <TextInput
                type="date"
                value={form.due_date}
                onChange={(event) => onChange({ due_date: event.target.value })}
              />
            </div>

            <div>
              <FieldLabel>Estimated Time (minutes)</FieldLabel>
              <TextInput
                type="number"
                min="0"
                value={form.estimated_time}
                onChange={(event) => onChange({ estimated_time: event.target.value })}
                placeholder="120"
              />
            </div>

            <div>
              <FieldLabel>Reminder Date</FieldLabel>
              <TextInput
                type="date"
                value={form.remind_at}
                onChange={(event) => onChange({ remind_at: event.target.value })}
              />
            </div>
          </div>

          <div>
            <FieldLabel>Labels</FieldLabel>
            <div className="flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-surface-card px-3 py-2">
              {form.label_ids.length === 0 ? (
                <span className="text-sm text-slate-600">No labels selected</span>
              ) : (
                form.label_ids.map((id) => {
                  const label = labels.find((candidate) => String(candidate.id) === id);
                  if (!label) return null;
                  // Label colours are user-chosen, so the text colour has to be
                  // derived from them — a fixed white washes out on light labels.
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
                      style={{ backgroundColor: label.color, color: getReadableTextColor(label.color) }}
                    >
                      {label.name}
                      <button
                        type="button"
                        aria-label={`Remove label ${label.name}`}
                        onClick={() => onChange({ label_ids: form.label_ids.filter((value) => value !== id) })}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  );
                })
              )}
            </div>
            {labels.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {labels
                  .filter((label) => !form.label_ids.includes(String(label.id)))
                  .map((label) => (
                    <button
                      type="button"
                      key={label.id}
                      className="rounded-full px-2 py-0.5 text-xs font-semibold opacity-80 transition hover:opacity-100"
                      style={{ backgroundColor: label.color, color: getReadableTextColor(label.color) }}
                      onClick={() => onChange({ label_ids: [...form.label_ids, String(label.id)] })}
                    >
                      + {label.name}
                    </button>
                  ))}
              </div>
            ) : null}
          </div>

          <div>
            <FieldLabel>Description</FieldLabel>
            <TextareaInput
              rows={5}
              value={form.description}
              onChange={(event) => onChange({ description: event.target.value })}
              placeholder="Capture acceptance criteria, blockers, links, or the expected outcome."
            />
          </div>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving || groups.length === 0}>
              {isSaving ? 'Saving...' : isEditing ? 'Update Task' : 'Create Task'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
