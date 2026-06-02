import { Crown, Network, User as UserIcon } from 'lucide-react';
import type { TeamPerson } from '@/types';

type Tone = 'admin' | 'manager' | 'employee';

const TONES: Record<Tone, { border: string; bg: string; avatar: string; text: string }> = {
  admin: { border: 'border-rose-200', bg: 'bg-rose-50', avatar: 'bg-rose-100 text-rose-700', text: 'text-rose-700' },
  manager: { border: 'border-sky-200', bg: 'bg-sky-50', avatar: 'bg-sky-100 text-sky-700', text: 'text-sky-700' },
  employee: { border: 'border-amber-200', bg: 'bg-amber-50', avatar: 'bg-amber-100 text-amber-700', text: 'text-amber-700' },
};

const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export const toneForLevel = (level: number | null | undefined): Tone => {
  if (level === null || level === undefined) return 'employee';
  if (level <= 10) return 'admin';
  if (level < 100) return 'manager';
  return 'employee';
};

export const iconForTone = (tone: Tone) => {
  if (tone === 'admin') return Crown;
  if (tone === 'manager') return Network;
  return UserIcon;
};

interface TeamPersonCardProps {
  person: TeamPerson;
  tone?: Tone;
  subtitle?: string | null;
  variant?: 'card' | 'row';
  highlight?: boolean;
  isSelf?: boolean;
}

export default function TeamPersonCard({ person, tone, subtitle, variant = 'card', highlight = false, isSelf = false }: TeamPersonCardProps) {
  const t = TONES[tone ?? toneForLevel(person.hierarchy_level)];

  if (variant === 'row') {
    return (
      <div className={`flex items-center gap-3 rounded-lg border p-3 ${t.border} ${t.bg} ${highlight ? 'ring-2 ring-sky-400' : ''}`}>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${t.avatar}`}>
          {initials(person.name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">
            {person.name}
            {isSelf ? <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-sky-700">You</span> : null}
          </p>
          <p className="truncate text-[11px] text-slate-500">
            {[person.role_name, person.designation, person.department].filter(Boolean).join(' · ') || '—'}
          </p>
        </div>
        {subtitle ? <span className={`shrink-0 text-[11px] font-semibold ${t.text}`}>{subtitle}</span> : null}
      </div>
    );
  }

  return (
    <div className={`w-[210px] rounded-xl border-2 p-3 shadow-sm transition-all hover:shadow-md ${t.border} ${t.bg} ${highlight ? 'ring-2 ring-sky-400' : ''}`}>
      <div className="flex items-start gap-2.5">
        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${t.avatar}`}>
          {initials(person.name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-bold leading-tight text-slate-900">
            {person.name}
            {isSelf ? <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-sky-700">(You)</span> : null}
          </p>
          <p className={`mt-0.5 text-[11px] font-semibold ${t.text}`}>{person.role_name || '—'}</p>
          {person.designation ? <p className="mt-0.5 truncate text-[11px] text-slate-500">{person.designation}</p> : null}
          {person.department ? <p className="mt-0.5 truncate text-[11px] font-medium text-slate-500">{person.department}</p> : null}
        </div>
      </div>
    </div>
  );
}

export { initials };
