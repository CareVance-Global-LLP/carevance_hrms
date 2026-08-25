import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, FileCheck2, Laptop, RotateCcw, ShieldCheck, Undo2, Upload } from 'lucide-react';
import { employeeWorkspaceApi, type ChecklistItem, type ChecklistOwnerKind } from '@/services/api';
import { formatDate } from '@/lib/dateTime';
import { UPLOAD_FOR_CATEGORY, isEvidenceBacked } from './checklistEvidence';

const OWNER_LABEL: Record<ChecklistOwnerKind, string> = {
  hr: 'HR',
  manager: 'Manager',
  employee: 'Employee',
  it: 'IT',
  finance: 'Finance',
  buddy: 'Buddy',
};

/** Owners are ordered by when they typically act, not alphabetically. */
const OWNER_ORDER: ChecklistOwnerKind[] = ['hr', 'employee', 'it', 'manager', 'finance', 'buddy'];

const REQUIRES_ICON = {
  document: Upload,
  asset_return: Laptop,
  acknowledgement: ShieldCheck,
} as const;

export interface ChecklistPanelProps {
  items: ChecklistItem[];
  canEdit: boolean;
  busyItemId?: number | null;
  onComplete: (item: ChecklistItem) => void;
  onReopen: (item: ChecklistItem) => void;
  emptyMessage?: string;
  /**
   * Turns the upload icon into a working control, filing against this person.
   *
   * Optional because this panel is shared with Exits, whose items ask for
   * asset returns rather than documents, and because a pre-boarding journey has
   * no account to file anything against yet.
   */
  uploadFor?: { userId: number } | null;
  /** Called once an upload lands, so the caller can refetch and see the tick. */
  onUploaded?: () => void;
}

/**
 * Grouped by who has to act, because that is how the work is actually divided —
 * a flat list makes each person hunt for their own rows.
 */
export default function ChecklistPanel({
  items,
  canEdit,
  busyItemId,
  onComplete,
  onReopen,
  emptyMessage = 'No checklist items yet.',
  uploadFor = null,
  onUploaded,
}: ChecklistPanelProps) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const pendingItem = useRef<ChecklistItem | null>(null);
  const [uploadingItemId, setUploadingItemId] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  /** What this item's uploads must be tagged as, or null if it takes none. */
  const uploadTargetFor = (item: ChecklistItem) => {
    if (!uploadFor || item.requires !== 'document') return null;
    const category = item.checklist_template_item?.document_category;
    return category ? (UPLOAD_FOR_CATEGORY[category] ?? null) : null;
  };

  const chooseFile = (item: ChecklistItem) => {
    pendingItem.current = item;
    setUploadError(null);
    if (fileInput.current) {
      fileInput.current.value = '';
      fileInput.current.click();
    }
  };

  const upload = async (file: File) => {
    const item = pendingItem.current;
    const target = item ? uploadTargetFor(item) : null;
    if (!item || !target || !uploadFor) return;

    setUploadingItemId(item.id);
    setUploadError(null);
    try {
      await employeeWorkspaceApi.uploadDocument(uploadFor.userId, {
        title: item.title,
        category: target.category,
        // Without this a PAN card lands as a government_id_proof that cannot be
        // told from an Aadhaar, and the matcher correctly refuses to count it.
        id_type: target.idType,
        file,
        review_status: 'pending',
        visible_to_employee: true,
      });
      onUploaded?.();
    } catch (error: any) {
      setUploadError(error?.response?.data?.message || `Could not upload for "${item.title}".`);
    } finally {
      setUploadingItemId(null);
      pendingItem.current = null;
    }
  };

  const groups = useMemo(() => {
    const byOwner = new Map<ChecklistOwnerKind, ChecklistItem[]>();
    items.forEach((item) => {
      const list = byOwner.get(item.owner_kind) ?? [];
      list.push(item);
      byOwner.set(item.owner_kind, list);
    });

    return OWNER_ORDER.filter((owner) => byOwner.has(owner)).map((owner) => ({
      owner,
      items: [...(byOwner.get(owner) ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    }));
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 px-6 py-10 text-center text-sm text-slate-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* One input for the whole panel; the item is held in a ref alongside. */}
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />

      {uploadError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{uploadError}</p>
      ) : null}

      {groups.map(({ owner, items: ownerItems }) => {
        const done = ownerItems.filter((item) => item.status === 'done' || item.status === 'skipped').length;

        return (
          <section key={owner} className="rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
              <h4 className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                {OWNER_LABEL[owner]}
              </h4>
              <span className="text-[10px] font-bold tabular-nums text-slate-500">
                {done}/{ownerItems.length}
              </span>
            </div>

            <div className="divide-y divide-slate-100">
              {ownerItems.map((item) => {
                const settled = item.status === 'done' || item.status === 'skipped';
                const RequiresIcon =
                  item.requires !== 'none' ? REQUIRES_ICON[item.requires as keyof typeof REQUIRES_ICON] : null;
                const busy = busyItemId === item.id;
                const uploadTarget = uploadTargetFor(item);
                const uploading = uploadingItemId === item.id;
                // Evidence-backed items are not ticked by hand, so their box is
                // a status indicator rather than a control.
                const evidenceOnly = isEvidenceBacked(item);
                const togglable = canEdit && !evidenceOnly;
                // Null on a manual tick — and then there is nothing honest to
                // name, which is itself the useful signal.
                const evidence = item.evidence_label ?? item.document?.title ?? null;

                return (
                  <div key={item.id} className="flex items-start gap-3 px-3 py-2.5">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={settled}
                      aria-disabled={evidenceOnly}
                      aria-label={
                        evidenceOnly
                          ? `${item.title} — completes itself from the document or recorded detail`
                          : settled
                            ? `Reopen ${item.title}`
                            : `Complete ${item.title}`
                      }
                      title={
                        evidenceOnly
                          ? 'Completes itself once the document is uploaded or the detail is recorded.'
                          : undefined
                      }
                      disabled={!togglable || busy}
                      onClick={() => (settled ? onReopen(item) : onComplete(item))}
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                        // Evidence-backed boxes read as status, not as a broken
                        // control: full opacity, no hover, no pointer.
                        evidenceOnly ? 'cursor-default' : 'disabled:opacity-50'
                      } ${
                        settled
                          ? 'border-success-500 bg-success-500 text-white'
                          : item.is_blocking
                            ? `border-accent-400 bg-white${evidenceOnly ? '' : ' hover:border-accent-500'}`
                            : `border-slate-300 bg-white${evidenceOnly ? '' : ' hover:border-blue-400'}`
                      }`}
                    >
                      {settled ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`text-[13px] font-semibold ${
                            settled ? 'text-slate-500 line-through' : 'text-slate-900'
                          }`}
                        >
                          {item.title}
                        </span>

                        {item.is_blocking && !settled ? (
                          <span className="rounded-full border border-accent-200 bg-accent-50 px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.06em] text-warning-800">
                            blocking
                          </span>
                        ) : null}

                        {/*
                          A real control where an upload can answer the item,
                          and the plain marker everywhere else. It used to be
                          decorative in both cases, so an admin reading "Upload
                          PAN card" beside an upload icon had no way to act on
                          it without leaving the page.
                        */}
                        {uploadTarget && !settled ? (
                          <button
                            type="button"
                            onClick={() => chooseFile(item)}
                            disabled={uploading}
                            title={`Upload a file for "${item.title}"`}
                            aria-label={`Upload a file for ${item.title}`}
                            className="rounded p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-blue-600 disabled:opacity-50"
                          >
                            {uploading ? (
                              <RotateCcw className="h-3 w-3 animate-spin" />
                            ) : (
                              <Upload className="h-3 w-3" />
                            )}
                          </button>
                        ) : RequiresIcon ? (
                          <span title={item.requires.replace('_', ' ')}>
                            <RequiresIcon className="h-3 w-3 text-slate-500" />
                          </span>
                        ) : null}
                      </div>

                      {item.description ? (
                        <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{item.description}</p>
                      ) : null}

                      {/*
                        What cleared this item — a file, or a detail already on
                        the record.

                        Without it a ticked row says only that somebody ticked
                        it, and an admin checking whether a joiner's PAN is
                        actually on file has to leave the page to find out. Most
                        of these now complete themselves, and this is what makes
                        the difference between that and a click visible.
                      */}
                      {settled && evidence ? (
                        <p className="mt-0.5 flex items-center gap-1 text-[11px] leading-snug text-success-700">
                          <FileCheck2 className="h-3 w-3 shrink-0" />
                          <span className="truncate">From {evidence}</span>
                        </p>
                      ) : null}

                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-semibold">
                        {item.due_date ? (
                          <span
                            className={
                              item.is_overdue
                                ? 'flex items-center gap-1 text-warning-800'
                                : 'text-slate-500'
                            }
                          >
                            {item.is_overdue ? <AlertTriangle className="h-2.5 w-2.5" /> : null}
                            Due {formatDate(item.due_date)}
                          </span>
                        ) : null}
                        {item.owner?.name ? (
                          <span className="text-slate-500">· {item.owner.name}</span>
                        ) : (
                          <span className="text-slate-300">· unassigned</span>
                        )}
                      </div>
                    </div>

                    {/*
                      Not offered on an evidence-backed item. Reopening one
                      would be undone by the next read — the evidence is still
                      on file, so the sync completes it again — and a button
                      that visibly does nothing is worse than no button.
                    */}
                    {settled && togglable ? (
                      <button
                        type="button"
                        onClick={() => onReopen(item)}
                        disabled={busy}
                        aria-label={`Reopen ${item.title}`}
                        className="shrink-0 rounded-md p-1 text-slate-300 transition hover:bg-slate-100 hover:text-slate-600"
                      >
                        {busy ? <RotateCcw className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
