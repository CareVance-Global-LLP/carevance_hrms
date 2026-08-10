import { AlertTriangle, Clock, Lock, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/utils/cn';
import type { RenewalNotice } from './renewalState';

const TONE = {
  ok: {
    wrap: 'border-emerald-200 bg-emerald-50',
    icon: 'bg-emerald-600 text-white',
    title: 'text-emerald-800',
    Icon: Clock,
  },
  closing: {
    wrap: 'border-amber-200 bg-amber-50',
    icon: 'bg-amber-500 text-slate-950',
    title: 'text-amber-800',
    Icon: Clock,
  },
  past_due: {
    wrap: 'border-rose-200 bg-rose-50',
    icon: 'bg-rose-600 text-white',
    title: 'text-rose-800',
    Icon: AlertTriangle,
  },
  expired: {
    wrap: 'border-rose-200 bg-rose-50',
    icon: 'bg-rose-600 text-white',
    title: 'text-rose-800',
    Icon: Lock,
  },
} as const;

interface RenewalBannerProps {
  notice: RenewalNotice;
  onDismiss?: () => void;
  className?: string;
}

export default function RenewalBanner({ notice, onDismiss, className }: RenewalBannerProps) {
  const navigate = useNavigate();
  const tone = TONE[notice.tone];
  const Icon = tone.Icon;

  return (
    <div className={cn('flex flex-wrap items-start gap-3 rounded-xl border p-4', tone.wrap, className)} role="status">
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', tone.icon)}>
        <Icon className="h-4 w-4" />
      </span>

      <div className="min-w-[14rem] flex-1">
        <p className={cn('text-sm font-semibold', tone.title)}>{notice.title}</p>
        <p className="mt-1 text-xs leading-5 text-slate-700">{notice.body}</p>
      </div>

      <div className="flex items-center gap-2">
        {notice.action ? (
          <button
            type="button"
            onClick={() => navigate('/settings/billing')}
            className="rounded-lg bg-surface-inverse px-3.5 py-2 text-xs font-semibold text-on-inverse transition hover:opacity-90"
          >
            {notice.action}
          </button>
        ) : null}
        {/* Expiry is not dismissible: hiding it would leave a read-only
            workspace with no explanation for why nothing works. */}
        {onDismiss && notice.tone !== 'expired' ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="rounded-md p-1.5 text-slate-600 transition hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
