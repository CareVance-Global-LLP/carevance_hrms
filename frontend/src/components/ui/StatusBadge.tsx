import { cn } from '@/utils/cn';

type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'border-[rgba(155,148,152,0.3)] bg-[rgba(155,148,152,0.1)] text-[#9B9498]',
  info: 'border-[rgba(93,150,157,0.3)] bg-[rgba(93,150,157,0.1)] text-[#5D969D]',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-[rgba(227,168,66,0.3)] bg-[rgba(227,168,66,0.1)] text-[#C8923A]',
  danger: 'border-rose-200 bg-rose-50 text-rose-700',
};

export default function StatusBadge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]',
        toneClasses[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
