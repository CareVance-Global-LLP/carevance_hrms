import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import type { PolicyEndpoints } from '@/services/workingTimeApi';

/**
 * List, create, edit and delete, once, for all four policy kinds.
 *
 * The four differ only in their fields; the lifecycle around those fields is
 * identical — load, open an editor on a copy, validate locally, save, absorb
 * the server's field errors, reload. Written four times, the fifth change to
 * one of them would miss the other three.
 *
 * Two behaviours here are deliberate rather than incidental:
 *
 *  - Server field errors are merged into the form's own error map. The server
 *    owns rules the browser cannot check — a name already used in this
 *    workspace, most of all — and a generic toast leaves nothing to point at.
 *  - A 409 on delete is surfaced as its own message, not swallowed. It means
 *    the policy is still assigned, and the right answer is to deactivate it so
 *    past attendance still resolves, not to cascade the delete through the
 *    assignment history.
 */
export interface PolicyCrudConfig<TPolicy, TDraft> {
  endpoints: PolicyEndpoints<TPolicy>;
  /** What the editor opens with for a new policy. */
  emptyDraft: () => TDraft;
  /** An existing policy, turned back into the form's own string shape. */
  draftFrom: (policy: TPolicy) => TDraft;
  toPayload: (draft: TDraft) => Record<string, unknown>;
  validate: (draft: TDraft) => Record<string, string | undefined>;
  /** For the toasts: "Weekly off policy created." */
  label: string;
}

export interface PolicyCrud<TPolicy, TDraft> {
  policies: TPolicy[];
  isLoading: boolean;
  error: string;
  reload: () => Promise<void>;
  editingId: number | 'new' | null;
  draft: TDraft;
  setDraft: (draft: TDraft) => void;
  errors: Record<string, string | undefined>;
  openEditor: (policy: TPolicy | null) => void;
  closeEditor: () => void;
  save: () => Promise<void>;
  isSaving: boolean;
  remove: (policy: TPolicy) => Promise<void>;
}

export function usePolicyCrud<TPolicy extends { id: number; name: string }, TDraft>(
  config: PolicyCrudConfig<TPolicy, TDraft>
): PolicyCrud<TPolicy, TDraft> {
  const toast = useToast();
  const { endpoints, emptyDraft, draftFrom, toPayload, validate, label } = config;

  const [policies, setPolicies] = useState<TPolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<TDraft>(emptyDraft);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [isSaving, setIsSaving] = useState(false);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await endpoints.list();
      setPolicies(response.data.data || []);
    } catch (e: any) {
      setError(e?.response?.data?.message || `Could not load ${label.toLowerCase()} policies.`);
    } finally {
      setIsLoading(false);
    }
    // endpoints is a module-level constant per kind, so this is stable.
  }, [endpoints, label]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openEditor = useCallback(
    (policy: TPolicy | null) => {
      setDraft(policy ? draftFrom(policy) : emptyDraft());
      setErrors({});
      setEditingId(policy ? policy.id : 'new');
    },
    [draftFrom, emptyDraft]
  );

  const closeEditor = useCallback(() => {
    setEditingId(null);
    setErrors({});
  }, []);

  const save = useCallback(async () => {
    const found = validate(draft);
    const problems = Object.fromEntries(
      Object.entries(found).filter(([, message]) => Boolean(message))
    );
    setErrors(problems);
    if (Object.keys(problems).length > 0) {
      return;
    }

    setIsSaving(true);
    try {
      const payload = toPayload(draft);
      if (editingId === 'new') {
        await endpoints.create(payload);
        toast.show({ kind: 'success', message: `${label} created.` });
      } else if (typeof editingId === 'number') {
        await endpoints.update(editingId, payload);
        toast.show({ kind: 'success', message: `${label} updated.` });
      }
      setEditingId(null);
      setErrors({});
      await reload();
    } catch (e: any) {
      const fieldErrors = e?.response?.data?.errors as Record<string, string[]> | undefined;
      if (fieldErrors) {
        setErrors(
          Object.fromEntries(
            Object.entries(fieldErrors).map(([field, messages]) => [field, messages[0]])
          )
        );
      }
      toast.show({
        kind: 'error',
        message: e?.response?.data?.message || `Could not save the ${label.toLowerCase()}.`,
      });
    } finally {
      setIsSaving(false);
    }
  }, [draft, editingId, endpoints, label, reload, toPayload, toast, validate]);

  const remove = useCallback(
    async (policy: TPolicy) => {
      try {
        await endpoints.remove(policy.id);
        toast.show({ kind: 'success', message: `${policy.name} deleted.` });
        await reload();
      } catch (e: any) {
        // 409 is the deliberate refusal to delete a policy people are still
        // assigned to; its message names how many.
        toast.show({
          kind: 'error',
          message: e?.response?.data?.message || `Could not delete the ${label.toLowerCase()}.`,
        });
      }
    },
    [endpoints, label, reload, toast]
  );

  return {
    policies,
    isLoading,
    error,
    reload,
    editingId,
    draft,
    setDraft,
    errors,
    openEditor,
    closeEditor,
    save,
    isSaving,
    remove,
  };
}

export default usePolicyCrud;
