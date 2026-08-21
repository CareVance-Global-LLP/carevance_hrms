'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { cursorAllowedOnPath } from '@/lib/motion';

/**
 * The custom cursor — the restrained specification (brief §7.3).
 *
 * Worth saying plainly, because it shaped this file: across the ten competitors
 * researched, NOT ONE ships a custom cursor. It is here because it was asked
 * for, and it earns its place only by being unobtrusive and by disappearing
 * everywhere it could do harm. Four gates, all required:
 *
 *   1. `pointer: fine`                    — never on touch
 *   2. `prefers-reduced-motion: no-preference`
 *   3. viewport ≥ 1024px
 *   4. not on a conversion or form route  — see cursorAllowedOnPath()
 *
 * And one rule that is not a gate but matters more than any of them: the native
 * cursor is NEVER suppressed over text inputs. Losing the I-beam is what makes a
 * custom cursor feel broken rather than considered, so `cursor: none` on the
 * body carries an explicit `cursor: auto` carve-out for every text-entry
 * element.
 *
 * Implementation notes. ONE fixed element, moved with translate3d inside a
 * single rAF loop; never `left`/`top`, which would lay out and paint every
 * frame. ONE delegated `pointermove` on the document; never a listener per
 * element. The spring is eight lines of critically-damped lerp rather than an
 * animation library — this component was the last consumer of one, and a 45 KB
 * dependency for a trailing ring is not a trade the performance budget allows.
 */

const RING = 28;
const RING_ACTIVE = 48;
/** Higher follows the pointer more tightly. 0.18 gives a light, unmistakable lag. */
const FOLLOW = 0.18;

export function Cursor() {
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(false);

  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);

  const allowedRoute = cursorAllowedOnPath(pathname);

  /* Gates 1–3, re-evaluated on resize so dragging a window across the 1024px
     boundary turns it off rather than leaving a stranded ring behind. */
  useEffect(() => {
    const query = window.matchMedia(
      '(pointer: fine) and (min-width: 1024px) and (prefers-reduced-motion: no-preference)'
    );
    const apply = () => setEnabled(query.matches && allowedRoute);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [allowedRoute]);

  /* Hide the native pointer only while the custom one is up, and never over
     text-entry elements. Injected here rather than in globals.css so a page
     where the cursor is disabled never carries the rule at all. */
  useEffect(() => {
    if (!enabled) return;
    const style = document.createElement('style');
    style.textContent = `
      body { cursor: none; }
      a, button, [role="button"], [role="tab"], summary, label { cursor: none; }
      input, textarea, select, [contenteditable], [contenteditable] * { cursor: auto !important; }
      input[type="range"], input[type="checkbox"], input[type="radio"] { cursor: pointer !important; }
    `;
    document.head.appendChild(style);
    return () => style.remove();
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    const ring = ringRef.current;
    const dot = dotRef.current;
    const label = labelRef.current;
    if (!ring || !dot || !label) return;

    let targetX = -200;
    let targetY = -200;
    let x = -200;
    let y = -200;
    let visible = false;
    let raf = 0;

    // Read directly rather than through React state: a pointermove that sets
    // state would re-render the whole subtree on every frame of a mouse drag.
    let active = false;
    let inverted = false;
    let labelText = '';

    const onMove = (event: PointerEvent) => {
      targetX = event.clientX;
      targetY = event.clientY;
      start();

      const target = event.target as Element | null;
      if (!target?.closest) return;

      // A text-entry element means: stand down entirely, give back the I-beam.
      if (target.closest('input, textarea, select, [contenteditable]')) {
        if (visible) {
          visible = false;
          ring.style.opacity = '0';
        }
        return;
      }

      if (!visible) {
        visible = true;
        ring.style.opacity = '1';
      }

      const labelled = target.closest<HTMLElement>('[data-cursor-label]');
      const nextLabel = labelled?.dataset.cursorLabel ?? '';
      const nextActive = Boolean(
        labelled || target.closest('a, button, [role="button"], [role="tab"], [data-cursor="lift"]')
      );
      const nextInverted = Boolean(
        target.closest('[data-cursor-theme="dark"], .band-deep, .surface-fixed-dark')
      );

      if (nextLabel !== labelText) {
        labelText = nextLabel;
        label.textContent = nextLabel;
        label.style.display = nextLabel ? 'block' : 'none';
      }

      if (nextActive !== active || nextInverted !== inverted || nextLabel !== labelText) {
        active = nextActive;
        inverted = nextInverted;

        const ink = inverted ? '255 255 255' : 'var(--brand-600)';
        const size = labelText ? 28 : active ? RING_ACTIVE : RING;

        ring.style.width = labelText ? 'auto' : `${size}px`;
        ring.style.height = `${size}px`;
        ring.style.borderRadius = labelText ? '999px' : `${size}px`;
        ring.style.borderColor = `rgb(${ink} / ${inverted ? 0.9 : 0.55})`;
        ring.style.backgroundColor = active ? `rgb(${ink} / 0.12)` : 'transparent';
        label.style.color = `rgb(${ink})`;
      }
    };

    const onLeave = () => {
      visible = false;
      ring.style.opacity = '0';
    };

    /*
     * The spring. A lerp toward the pointer each frame gives exponential decay,
     * which is what a critically-damped spring looks like anyway — and it is
     * frame-rate independent enough at 60–144Hz for a 28px ring.
     *
     * The loop STOPS once the ring has caught up, and pointermove restarts it.
     * An unconditional rAF would keep a frame scheduled forever, which costs
     * battery on a page nobody is touching — and, less obviously, means the
     * document never reports itself idle, which breaks screenshot and
     * performance tooling that waits for a stable frame.
     */
    const tick = () => {
      const dx = targetX - x;
      const dy = targetY - y;

      if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) {
        x = targetX;
        y = targetY;
        ring.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
        raf = 0;
        return;
      }

      x += dx * FOLLOW;
      y += dy * FOLLOW;
      ring.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);

    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      cancelAnimationFrame(raf);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div ref={dotRef} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[200]">
      <div
        ref={ringRef}
        className="absolute top-0 left-0 flex items-center justify-center opacity-0 transition-[width,height,background-color,border-color,border-radius,opacity] duration-150 ease-[cubic-bezier(0.22,0.61,0.36,1)]"
        style={{
          width: RING,
          height: RING,
          borderRadius: RING,
          borderWidth: 1.5,
          borderStyle: 'solid',
          borderColor: 'rgb(var(--brand-600) / 0.55)',
        }}
      >
        <span
          ref={labelRef}
          className="hidden px-2.5 text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap uppercase"
        />
      </div>
    </div>
  );
}
