import { AlertCircle, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import Button from '@/components/ui/Button';

export function PageLoadingState({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
        <span>{label}</span>
      </div>
    </div>
  );
}

export function PageErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <SurfaceCard className="border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="flex-1">
          <p>{message}</p>
          {onRetry ? (
            <Button onClick={onRetry} variant="secondary" size="sm" className="mt-3 border-rose-200 bg-white text-rose-700 hover:border-rose-300 hover:bg-white">
              Try again
            </Button>
          ) : null}
        </div>
      </div>
    </SurfaceCard>
  );
}

export function PageEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <SurfaceCard className="p-10 text-center text-slate-500">
      <Inbox className="mx-auto mb-3 h-12 w-12 text-gray-300" />
      <p className="font-medium text-slate-700">{title}</p>
      {description ? <p className="mt-1 text-sm">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </SurfaceCard>
  );
}

export function FeedbackBanner({
  tone,
  message,
}: {
  tone: 'success' | 'error';
  message: string;
}) {
  const styles = tone === 'success'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : 'border-rose-200 bg-rose-50 text-rose-700';

  return <div className={`rounded-lg border px-4 py-3 text-sm shadow-sm ${styles}`}>{message}</div>;
}
