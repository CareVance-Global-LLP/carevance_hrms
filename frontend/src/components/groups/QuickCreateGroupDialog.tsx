import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import Button from '@/components/ui/Button';
import { FeedbackBanner } from '@/components/ui/PageState';
import { FieldLabel, TextInput, TextareaInput } from '@/components/ui/FormField';
import { queryKeys } from '@/lib/queryKeys';
import { groupApi } from '@/services/api';
import type { Group } from '@/types';

interface QuickCreateGroupDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (group: Group) => void;
  title?: string;
  eyebrow?: string;
  description?: string;
}

export default function QuickCreateGroupDialog({
  open,
  onClose,
  onCreated,
  title = 'Create a new group',
  eyebrow = 'Group quick add',
  description = 'Add a group here and it will become available immediately in the current flow.',
}: QuickCreateGroupDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const createGroupMutation = useMutation({
    mutationFn: async () => (await groupApi.create({
      name: name.trim(),
      description: groupDescription.trim() || undefined,
    })).data as Group,
    onSuccess: async (group) => {
      setFeedback({ tone: 'success', message: `Group "${group.name}" was created.` });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.groups }),
        queryClient.invalidateQueries({ queryKey: queryKeys.reportGroups }),
        queryClient.invalidateQueries({ queryKey: ['add-user-groups'] }),
      ]);
      onCreated?.(group);
      setName('');
      setGroupDescription('');
      onClose();
    },
    onError: (error: any) => {
      const fieldErrors = error?.response?.data?.errors;
      const firstFieldError = fieldErrors
        ? Object.values(fieldErrors).flat().find(Boolean)
        : null;

      setFeedback({
        tone: 'error',
        message: String(firstFieldError || error?.response?.data?.message || 'Failed to create group.'),
      });
    },
  });

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-sm sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-600">{eyebrow}</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">{title}</h2>
            <p className="mt-2 text-sm text-slate-500">{description}</p>
          </div>
          <button
            type="button"
            aria-label="Close group modal"
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {feedback ? <div className="mt-5"><FeedbackBanner tone={feedback.tone} message={feedback.message} /></div> : null}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            setFeedback(null);
            createGroupMutation.mutate();
          }}
          className="mt-6 space-y-4"
        >
          <div>
            <FieldLabel>Group Name</FieldLabel>
            <TextInput
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Digital Marketing"
            />
          </div>

          <div>
            <FieldLabel>Description</FieldLabel>
            <TextareaInput
              rows={4}
              value={groupDescription}
              onChange={(event) => setGroupDescription(event.target.value)}
              placeholder="Optional notes about the team's scope or responsibilities."
            />
          </div>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose} disabled={createGroupMutation.isPending}>Cancel</Button>
            <Button type="submit" disabled={createGroupMutation.isPending || !name.trim()}>
              {createGroupMutation.isPending ? 'Saving...' : 'Create Group'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
