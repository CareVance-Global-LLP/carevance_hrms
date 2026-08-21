import type { ReactNode } from 'react';
import { cn } from '@/components/ui/primitives';

/**
 * Chrome for the product screens.
 *
 * The brief reserves device frames for the mobile app and the desktop tracker,
 * where the frame carries information — a tracker that runs in its own window
 * and a phone you punch in from are different claims, and the frame is what
 * says so. Everything else gets a plain browser-less panel, because a fake
 * browser bar around a web app tells the reader nothing they had not assumed.
 */

export function Panel({
  children,
  className,
  label,
  toolbar,
}: {
  children: ReactNode;
  className?: string;
  /** Screen name, rendered as the panel's heading strip. */
  label?: string;
  toolbar?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-n-200 bg-card shadow-card',
        className
      )}
    >
      {(label || toolbar) && (
        <div className="flex items-center justify-between gap-3 border-b border-n-200 bg-sunken px-4 py-2.5">
          {label && <p className="text-caption uppercase text-n-600">{label}</p>}
          {toolbar}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * The Electron tracker's own window.
 *
 * Deliberately dark in BOTH themes via `.surface-fixed-dark` — the real tracker
 * is a dark utility window, and letting it invert with the page would turn the
 * one screenshot that proves "this runs on your desktop" into another white
 * card indistinguishable from the web app beside it.
 */
export function TrackerWindow({
  children,
  className,
  title = 'CareVance Tracker',
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <div
      className={cn('overflow-hidden rounded-xl shadow-modal surface-fixed-dark', className)}
      data-cursor-theme="dark"
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-3.5 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
        </span>
        <p className="ml-1 text-[11px] font-semibold tracking-[0.04em] text-white/80">{title}</p>
      </div>
      {children}
    </div>
  );
}

/** The Expo app. The frame is the claim: this is a phone, in a pocket. */
export function PhoneFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative w-[248px] shrink-0 rounded-[2rem] border-[6px] border-n-800 bg-card shadow-modal',
        className
      )}
    >
      <span
        aria-hidden="true"
        className="absolute top-2 left-1/2 h-1.5 w-16 -translate-x-1/2 rounded-full bg-n-800"
      />
      <div className="overflow-hidden rounded-[1.5rem] pt-6">{children}</div>
    </div>
  );
}

/**
 * A number set beside a screen rather than floated on top of it.
 *
 * None of the ten researched competitors overlays stat chips on screenshots,
 * and the reason is visible the moment you try: a chip covers the UI it is
 * describing and reads as a template. Stats sit alongside.
 */
export function StatBeside({
  value,
  label,
  source,
  claim,
}: {
  value: ReactNode;
  label: string;
  source?: string;
  claim?: string;
}) {
  return (
    <div data-claim={claim} title={source}>
      <p className="font-display text-data text-n-900 tnum">{value}</p>
      <p className="mt-1 text-sm leading-6 text-n-600">{label}</p>
    </div>
  );
}
