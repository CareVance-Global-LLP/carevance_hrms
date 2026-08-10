import { Check } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { ThemeChoice } from '@/contexts/ThemeContext';

/**
 * The swatches below are the only literal colours in the settings feature, and
 * deliberately so: a tile has to render the theme it is *offering*, which means
 * the light tile must stay light while the app is dark. Theme tokens resolve to
 * the active theme by design, so they cannot express "the other one".
 * These values mirror the light/dark surface + brand tokens in styles/theme.css.
 */
const PALETTES = {
  light: { ground: '#F1F4F6', panel: '#FFFFFF', line: '#E4E8EB', muted: '#D2D8DD', brand: '#5D969D' },
  dark: { ground: '#0A1015', panel: '#161F26', line: '#212C34', muted: '#2A3841', brand: '#6FA9B0' },
} as const;

function Preview({ mode }: { mode: 'light' | 'dark' | 'system' }) {
  if (mode === 'system') {
    // Two halves, because "System" is genuinely two answers depending on the
    // device — a single swatch would have to pick one and misrepresent it.
    return (
      <div className="flex h-[70px]">
        <div className="w-1/2 overflow-hidden">
          <Preview mode="light" />
        </div>
        <div className="w-1/2 overflow-hidden">
          <Preview mode="dark" />
        </div>
      </div>
    );
  }

  const p = PALETTES[mode];
  return (
    <div className="flex h-[70px] overflow-hidden" style={{ background: p.ground }}>
      <div className="flex w-[30%] flex-col gap-1 p-1.5" style={{ background: p.panel, borderRight: `1px solid ${p.line}` }}>
        <span className="h-1 rounded-full" style={{ background: p.brand }} />
        <span className="h-1 rounded-full" style={{ background: p.muted }} />
        <span className="h-1 rounded-full" style={{ background: p.muted }} />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-1.5">
        <span className="h-5 rounded" style={{ background: p.panel, border: `1px solid ${p.line}` }} />
        <span className="h-1 rounded-full" style={{ background: p.muted }} />
        <span className="h-1 w-3/5 rounded-full" style={{ background: p.muted }} />
      </div>
    </div>
  );
}

interface ThemeTileProps {
  value: ThemeChoice;
  label: string;
  hint: string;
  selected: boolean;
  onSelect: (value: ThemeChoice) => void;
}

export default function ThemeTile({ value, label, hint, selected, onSelect }: ThemeTileProps) {
  const mode = value === 'system' ? 'system' : value;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onSelect(value)}
      className={cn(
        'rounded-xl border bg-surface-card p-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400',
        selected ? 'border-sky-400 ring-2 ring-sky-300/30' : 'border-slate-200 hover:border-slate-300'
      )}
    >
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <Preview mode={mode} />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-900">{label}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-slate-600">{hint}</span>
        {selected ? <Check className="h-4 w-4 shrink-0 text-sky-600" /> : null}
      </div>
    </button>
  );
}
