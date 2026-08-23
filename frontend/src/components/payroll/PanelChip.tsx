import type { LucideIcon } from 'lucide-react';
import { Lock } from 'lucide-react';
import { cn } from '@/utils/cn';

interface PanelChipProps {
  label: string;
  icon?: LucideIcon;
  isActive: boolean;
  /** Locked chips render disabled with a padlock rather than disappearing. */
  isLocked?: boolean;
  /** Count badge, e.g. pending proofs. Hidden at 0. */
  badge?: number;
  onClick: () => void;
}

/**
 * The sub-panel selector chip shared by the Tax & Compliance and Employee Pay
 * tabs. Both tabs previously hand-rolled this button with different active
 * treatments — outlined blue with icons on one, solid teal without icons on the
 * other — so the same control looked like two different controls.
 */
export default function PanelChip({
  label,
  icon: Icon,
  isActive,
  isLocked = false,
  badge = 0,
  onClick,
}: PanelChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isLocked}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        isActive
          ? 'border-blue-600 bg-blue-500/10 text-blue-600'
          : isLocked
            ? 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-500'
            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {label}
      {isLocked && <Lock className="h-3 w-3 text-slate-300" />}
      {badge > 0 && (
        <span className="ml-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}
