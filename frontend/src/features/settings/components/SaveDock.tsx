import Button from '@/components/ui/Button';

interface SaveDockProps {
  count: number;
  where: string;
  onSave: () => void;
  onDiscard: () => void;
  isSaving?: boolean;
}

/**
 * Appears only once something has changed, and stays in view while it has.
 * It replaces a Save button that used to sit below twenty-odd fields, where
 * neither it nor its confirmation banner was ever on screen at the same time
 * as the thing being edited.
 */
export default function SaveDock({ count, where, onSave, onDiscard, isSaving }: SaveDockProps) {
  if (count <= 0) {
    return null;
  }

  return (
    <div className="sticky bottom-0 z-20 -mx-1 mt-4 px-1 pb-1">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border-strong bg-surface-raised/95 px-4 py-3 shadow-modal backdrop-blur">
        <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500 ring-4 ring-amber-500/20" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm text-slate-900">
          <span className="font-semibold">
            {count} unsaved change{count === 1 ? '' : 's'}
          </span>{' '}
          <span className="text-slate-600">on {where}</span>
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onDiscard} disabled={isSaving}>
            Discard
          </Button>
          <Button size="sm" onClick={onSave} loading={isSaving} disabled={isSaving}>
            Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}
