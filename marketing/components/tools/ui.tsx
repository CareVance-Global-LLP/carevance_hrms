'use client';

import { useId, type ReactNode } from 'react';
import { rupees } from '@/lib/calc';
import { cn } from '@/components/ui/primitives';

/**
 * Shared controls for the calculator cluster.
 *
 * The whole cluster is on the cursor block-list and every control here is a
 * native input — a range, a number field, a select. Free tools are a conversion
 * surface, and a custom-built "slider" that a screen reader cannot operate or a
 * keyboard cannot nudge would trade the one thing these pages are for.
 */

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-[13px] font-semibold text-n-800">
        {label}
      </label>
      {hint && <p className="mt-0.5 text-[11.5px] leading-4 text-n-600">{hint}</p>}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

const CONTROL =
  'w-full rounded-lg border border-n-300 bg-card px-3 py-2 text-[14px] text-n-900 ' +
  'transition-colors placeholder:text-n-500 hover:border-n-400 ' +
  'focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring';

export function MoneyInput({
  id,
  value,
  onChange,
  min = 0,
  max = 100000000,
  step = 1000,
  label,
  hint,
}: {
  id: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="relative">
        <span
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[14px] text-n-600"
          aria-hidden="true"
        >
          ₹
        </span>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          value={Number.isFinite(value) ? value : ''}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className={cn(CONTROL, 'pl-7 tnum')}
        />
      </div>
    </Field>
  );
}

export function NumberInput({
  id,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  hint,
  suffix,
}: {
  id: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  hint?: string;
  suffix?: string;
}) {
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="relative">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={Number.isFinite(value) ? value : ''}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className={cn(CONTROL, suffix && 'pr-12', 'tnum')}
        />
        {suffix && (
          <span
            className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[13px] text-n-600"
            aria-hidden="true"
          >
            {suffix}
          </span>
        )}
      </div>
    </Field>
  );
}

export function SelectInput<T extends string>({
  id,
  value,
  onChange,
  options,
  label,
  hint,
}: {
  id: string;
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string; group?: string }>;
  label: string;
  hint?: string;
}) {
  const groups = Array.from(new Set(options.map((o) => o.group).filter(Boolean)));

  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={CONTROL}
      >
        {groups.length > 0
          ? groups.map((g) => (
              <optgroup key={g} label={g as string}>
                {options
                  .filter((o) => o.group === g)
                  .map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
              </optgroup>
            ))
          : options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
      </select>
    </Field>
  );
}

export function SegmentedInput<T extends string>({
  value,
  onChange,
  options,
  label,
  hint,
}: {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  label: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <fieldset>
      <legend className="text-[13px] font-semibold text-n-800">{label}</legend>
      {hint && <p className="mt-0.5 text-[11.5px] leading-4 text-n-600">{hint}</p>}
      <div className="mt-1.5 inline-flex w-full rounded-lg border border-n-300 bg-sunken p-1">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              'flex-1 cursor-pointer rounded-md px-3 py-1.5 text-center text-[13px] font-semibold transition-colors',
              value === o.value ? 'bg-card text-n-900 shadow-card' : 'text-n-600 hover:text-n-800'
            )}
          >
            <input
              type="radio"
              name={id}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/* ── Results ──────────────────────────────────────────────────────────── */

export function ResultRow({
  label,
  value,
  note,
  tone = 'default',
  indent = false,
}: {
  label: string;
  value: number | string;
  note?: string;
  tone?: 'default' | 'muted' | 'negative' | 'total' | 'accent';
  indent?: boolean;
}) {
  const tones = {
    default: 'text-n-800',
    muted: 'text-n-500',
    negative: 'text-rose-700',
    total: 'font-bold text-n-900',
    accent: 'font-bold text-brand-800',
  };

  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 py-1.5',
        indent && 'pl-4',
        tone === 'total' && 'border-t border-n-200 pt-2.5'
      )}
    >
      <div className="min-w-0">
        <span className={cn('text-[13.5px]', tone === 'total' ? 'font-semibold text-n-900' : 'text-n-600')}>
          {label}
        </span>
        {note && <span className="ml-2 text-[11.5px] text-n-600">{note}</span>}
      </div>
      <span className={cn('shrink-0 text-[13.5px] tnum', tones[tone])}>
        {typeof value === 'number' ? rupees(value) : value}
      </span>
    </div>
  );
}

export function Headline({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50 p-5">
      <p className="text-caption uppercase text-brand-700">{label}</p>
      {/*
        aria-live so a screen-reader user hears the recomputed answer when they
        change an input. Without it the number silently changes behind them and
        the tool is unusable non-visually.
      */}
      <p
        aria-live="polite"
        className="mt-1 font-display text-3xl leading-tight font-bold text-brand-900 tnum"
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-[13px] text-brand-800/80">{sub}</p>}
    </div>
  );
}

/** The refusal state, mirroring the override balancer's behaviour. */
export function Refusal({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-xl border border-danger-500/30 bg-danger-50 p-4">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] text-danger-700 uppercase">
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="8" cy="8" r="6.4" />
          <path d="M8 5v3.5M8 11h.01" strokeLinecap="round" />
        </svg>
        This does not balance
      </p>
      <div className="mt-1.5 text-[13px] leading-5 text-n-800">{children}</div>
    </div>
  );
}
