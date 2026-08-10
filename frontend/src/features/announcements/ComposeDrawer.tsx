import { useMemo, useState } from 'react';
import { Send, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import SlideOver from '@/features/employees/SlideOver';
import { FieldLabel, SelectInput, TextInput, TextareaInput } from '@/components/ui/FormField';
import { cn } from '@/utils/cn';
import { PRIORITY_OPTIONS, PRIORITY_META, type AnnouncementPriority } from './announcementUtils';

export interface ComposeState {
  type: 'announcement' | 'news' | 'poll';
  priority: AnnouncementPriority;
  title: string;
  message: string;
  question: string;
  options: string[];
  isMultipleChoice: boolean;
  recipientIds: number[];
}

export const emptyCompose = (): ComposeState => ({
  type: 'announcement',
  priority: 'medium',
  title: '',
  message: '',
  question: '',
  options: ['', ''],
  isMultipleChoice: false,
  recipientIds: [],
});

interface Recipient {
  id: number;
  name: string;
  email: string;
  groups?: Array<{ id: number; name: string }>;
}

interface ComposeDrawerProps {
  state: ComposeState;
  onChange: (patch: Partial<ComposeState>) => void;
  onClose: () => void;
  onPublish: () => void;
  isPublishing: boolean;
  users: Recipient[];
  groups: Array<{ id: number; name: string }>;
}

/**
 * Composing lives in a drawer now. It used to be a permanently expanded panel
 * between the filters and the feed, so an admin scrolled past the entire
 * publishing UI every time they wanted to read something.
 */
export default function ComposeDrawer({
  state,
  onChange,
  onClose,
  onPublish,
  isPublishing,
  users,
  groups,
}: ComposeDrawerProps) {
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [recipientSearch, setRecipientSearch] = useState('');

  const isPoll = state.type === 'poll';

  const visibleRecipients = useMemo(() => {
    const needle = recipientSearch.trim().toLowerCase();
    return users.filter((person) => {
      if (departmentId && !person.groups?.some((group) => group.id === departmentId)) return false;
      if (!needle) return true;
      return `${person.name} ${person.email}`.toLowerCase().includes(needle);
    });
  }, [users, departmentId, recipientSearch]);

  const canPublish = isPoll
    ? state.question.trim().length > 0 && state.options.filter((option) => option.trim()).length >= 2
    : state.title.trim().length > 0 && state.message.trim().length > 0;

  return (
    <SlideOver
      open
      onClose={onClose}
      title="New announcement"
      subtitle={
        state.recipientIds.length > 0
          ? `To ${state.recipientIds.length} selected recipient${state.recipientIds.length === 1 ? '' : 's'}`
          : 'To everyone in your organization'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPublishing}>
            Cancel
          </Button>
          {/* The publish button used to stay live during the request, so a
              double-click sent the announcement to everyone twice. */}
          <Button onClick={onPublish} disabled={isPublishing || !canPublish} iconLeft={<Send className="h-4 w-4" />}>
            {isPublishing ? 'Publishing...' : 'Publish'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>Type</FieldLabel>
            <SelectInput
              value={state.type}
              aria-label="Announcement type"
              onChange={(event) => onChange({ type: event.target.value as ComposeState['type'] })}
            >
              <option value="announcement">Announcement</option>
              <option value="news">News</option>
              <option value="poll">Poll</option>
            </SelectInput>
          </div>

          {state.type === 'announcement' ? (
            <div>
              <FieldLabel>Priority</FieldLabel>
              <SelectInput
                value={state.priority}
                aria-label="Priority"
                onChange={(event) => onChange({ priority: event.target.value as AnnouncementPriority })}
              >
                {PRIORITY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {PRIORITY_META[option].label}
                  </option>
                ))}
              </SelectInput>
            </div>
          ) : null}
        </div>

        {/* The title field used to stay on screen for polls and then have its
            value thrown away at publish time. Polls have a question, not a title. */}
        {isPoll ? (
          <>
            <div>
              <FieldLabel>Question</FieldLabel>
              <TextInput
                value={state.question}
                maxLength={255}
                aria-label="Question"
                onChange={(event) => onChange({ question: event.target.value })}
                placeholder="What would you like to ask?"
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <FieldLabel>Options</FieldLabel>
                {state.options.length < 12 ? (
                  <button
                    type="button"
                    onClick={() => onChange({ options: [...state.options, ''] })}
                    className="text-xs font-semibold text-blue-700 transition hover:text-blue-600"
                  >
                    + Add option
                  </button>
                ) : null}
              </div>
              <div className="space-y-2">
                {state.options.map((option, index) => (
                  <div key={index} className="flex gap-2">
                    <TextInput
                      className="flex-1"
                      value={option}
                      maxLength={255}
                      aria-label={`Option ${index + 1}`}
                      placeholder={`Option ${index + 1}`}
                      onChange={(event) =>
                        onChange({
                          options: state.options.map((current, position) =>
                            position === index ? event.target.value : current
                          ),
                        })
                      }
                    />
                    {state.options.length > 2 ? (
                      <button
                        type="button"
                        aria-label={`Remove option ${index + 1}`}
                        onClick={() => onChange({ options: state.options.filter((_, position) => position !== index) })}
                        className="rounded p-1.5 text-slate-600 transition hover:bg-rose-50 hover:text-rose-700"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={state.isMultipleChoice}
                  onChange={(event) => onChange({ isMultipleChoice: event.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                Allow multiple selections
              </label>
            </div>
          </>
        ) : (
          <>
            <div>
              <FieldLabel>Title</FieldLabel>
              <TextInput
                value={state.title}
                maxLength={150}
                aria-label="Title"
                onChange={(event) => onChange({ title: event.target.value })}
                placeholder="Office closed Monday — building maintenance"
              />
            </div>
            <div>
              <FieldLabel>Message</FieldLabel>
              <TextareaInput
                rows={5}
                value={state.message}
                aria-label="Message"
                onChange={(event) => onChange({ message: event.target.value })}
                placeholder="Write the update you want people to receive."
              />
            </div>
          </>
        )}

        <div>
          <FieldLabel>Recipients</FieldLabel>
          <div className="space-y-2.5 rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap gap-2">
              {groups.length > 0 ? (
                <SelectInput
                  className="w-40"
                  aria-label="Filter recipients by department"
                  value={departmentId ?? ''}
                  onChange={(event) => setDepartmentId(event.target.value ? Number(event.target.value) : null)}
                >
                  <option value="">All departments</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </SelectInput>
              ) : null}
              <TextInput
                className="min-w-[9rem] flex-1"
                aria-label="Search recipients"
                value={recipientSearch}
                onChange={(event) => setRecipientSearch(event.target.value)}
                placeholder="Search by name or email"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span>
                Showing <span className="font-semibold text-slate-800">{visibleRecipients.length}</span> of {users.length}
              </span>
              <span>·</span>
              <span>
                Selected <span className="font-semibold text-slate-800">{state.recipientIds.length}</span>
              </span>
              {visibleRecipients.length > 0 ? (
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      recipientIds: Array.from(
                        new Set([...state.recipientIds, ...visibleRecipients.map((person) => person.id)])
                      ),
                    })
                  }
                  className="rounded border border-slate-200 px-2 py-0.5 font-medium transition hover:border-blue-300 hover:text-blue-700"
                >
                  Select shown
                </button>
              ) : null}
              {state.recipientIds.length > 0 ? (
                <button
                  type="button"
                  onClick={() => onChange({ recipientIds: [] })}
                  className="rounded border border-slate-200 px-2 py-0.5 font-medium transition hover:border-blue-300 hover:text-blue-700"
                >
                  Clear
                </button>
              ) : null}
            </div>

            {/* The list used to refuse to render until you picked a department
                or typed a search, so there was no way to just see who exists. */}
            <div className="max-h-52 overflow-y-auto rounded border border-slate-100">
              {visibleRecipients.length === 0 ? (
                <p className="p-3 text-sm text-slate-600">No one matches that filter.</p>
              ) : (
                visibleRecipients.map((person) => {
                  const checked = state.recipientIds.includes(person.id);
                  return (
                    <label
                      key={person.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm transition',
                        checked ? 'bg-blue-50 text-blue-900' : 'text-slate-700 hover:bg-slate-50'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          onChange({
                            recipientIds: event.target.checked
                              ? [...state.recipientIds, person.id]
                              : state.recipientIds.filter((id) => id !== person.id),
                          })
                        }
                        className="h-4 w-4 rounded border-slate-300 text-blue-600"
                      />
                      <span className="min-w-0 flex-1 truncate">{person.name}</span>
                      <span className="shrink-0 text-xs text-slate-600">{person.email}</span>
                    </label>
                  );
                })
              )}
            </div>

            <p className="text-xs text-slate-600">
              {state.recipientIds.length > 0
                ? `Goes to ${state.recipientIds.length} selected recipient${state.recipientIds.length === 1 ? '' : 's'}.`
                : 'Nobody selected — this goes to everyone in your organization.'}
            </p>
          </div>
        </div>
      </div>
    </SlideOver>
  );
}
