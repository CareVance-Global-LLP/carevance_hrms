import type { ReactNode } from 'react';
import { Pencil, Trash2, X } from 'lucide-react';
import Button from '@/components/ui/Button';

/**
 * The chrome every one of the four policy editors wears.
 *
 * Only the fields differ between weekly off, penalisation, overtime and shift
 * allowance; the frame around them — a titled panel that can be closed, a list
 * row that says what the policy does before it says what it is called — is the
 * same shape, and duplicating it four times is how four screens drift apart.
 */

export function PolicyEditor({
  title,
  onClose,
  onSave,
  onCancel,
  isSaving,
  saveLabel,
  children,
}: {
  title: string;
  onClose: () => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  saveLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-4 rounded-lg border border-slate-300 bg-surface-sunken p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the policy editor"
          className="rounded-md p-1.5 text-slate-500 transition hover:text-slate-900"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {children}

      <div className="mt-4 flex gap-2">
        <Button onClick={onSave} loading={isSaving} disabled={isSaving}>
          {saveLabel}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * A list row.
 *
 * The summary line leads, because a policy name never says what the policy
 * does — "Standard" is what every one of them is called, and the grace period
 * is the thing somebody is checking.
 */
export function PolicyRow({
  name,
  summary,
  isDefault,
  isActive,
  assignedCount,
  onEdit,
  onDelete,
}: {
  name: string;
  summary: ReactNode;
  isDefault: boolean;
  isActive: boolean;
  assignedCount: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-surface-sunken p-3">
      <div className="min-w-[12rem] flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
          {name}
          {isDefault ? (
            <span
              className="rounded border border-blue-300 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-700"
              title="Applies to anyone with no policy of their own"
            >
              workspace default
            </span>
          ) : null}
          {!isActive ? <span className="text-[11px] font-medium text-slate-500">retired</span> : null}
        </p>
        <p className="mt-0.5 text-xs leading-5 text-slate-600">{summary}</p>
      </div>

      <span className="text-xs text-slate-600">{assignedCount} assigned</span>

      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${name}`}
        className="rounded-md p-2 text-slate-500 transition hover:text-blue-600"
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${name}`}
        className="rounded-md p-2 text-slate-500 transition hover:text-red-600"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

/** The preview strip under an editor — the same shape ShiftsPane uses. */
export function PreviewStrip({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 space-y-1.5 rounded-lg border border-slate-200 bg-surface-card px-3 py-2.5 text-xs text-slate-600">
      {children}
    </div>
  );
}

export function EmptyPolicies({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-slate-300 p-4 text-xs text-slate-600">
      {children}
    </p>
  );
}

/** Name, description, default and active — the four fields all of them share. */
export function PolicyIdentityFields({
  name,
  description,
  isDefault,
  isActive,
  nameError,
  onChange,
  defaultHint,
}: {
  name: string;
  description: string;
  isDefault: boolean;
  isActive: boolean;
  nameError?: string;
  defaultHint: string;
  onChange: (patch: {
    name?: string;
    description?: string;
    is_default?: boolean;
    is_active?: boolean;
  }) => void;
}) {
  return (
    <>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="policy-name">
          Name
        </label>
        <input
          id="policy-name"
          value={name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder="e.g. Standard"
          className="w-full rounded-lg border border-slate-300 bg-surface-card px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
        />
        {nameError ? <p className="mt-1 text-xs text-red-600">{nameError}</p> : null}
      </div>

      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="policy-description">
          Description
        </label>
        <textarea
          id="policy-description"
          rows={2}
          value={description}
          onChange={(event) => onChange({ description: event.target.value })}
          placeholder="Who this applies to, and anything the next person needs to know."
          className="w-full rounded-lg border border-slate-300 bg-surface-card px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
        />
      </div>

      <div className="flex flex-wrap gap-4 sm:col-span-2">
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(event) => onChange({ is_default: event.target.checked })}
            className="h-4 w-4 rounded border-slate-300"
          />
          {defaultHint}
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => onChange({ is_active: event.target.checked })}
            className="h-4 w-4 rounded border-slate-300"
          />
          Active
        </label>
      </div>
    </>
  );
}
