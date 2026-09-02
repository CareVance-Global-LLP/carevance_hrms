'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/components/ui/primitives';

/**
 * Motion 4 — the chain trace. The hero, and the pitch rendered.
 *
 * Five fragments of the real product, carrying ONE employee and ONE number from
 * a tracked minute to a payslip, joined by a line that draws left to right. The
 * continuity is the argument: every competitor can show five screenshots, none
 * can show the same record in all five.
 *
 * Three things about the implementation are load-bearing:
 *
 * 1. THE FRAGMENTS ARE VISIBLE IN THE SERVER-RENDERED HTML and are hidden by
 *    `useLayoutEffect` — which runs before paint — only once we know motion is
 *    wanted. The obvious alternative, `opacity: 0` in CSS undone by JS, leaves
 *    the entire hero permanently blank if the bundle fails. Failing visible is
 *    the only acceptable direction to fail.
 *
 * 2. THE LCP ELEMENT IS NOT IN HERE. The headline beside this is real text and
 *    paints immediately; nothing that fades in is allowed to be the largest
 *    contentful paint, which is why the hero copy is not animated at all.
 *
 * 3. anime.js owns these nodes, and nothing else touches their transform. One
 *    owner per element — two would fight over the same property.
 *
 * 4. THE DATA ARRIVES AS A PROP. This is a client component, so importing
 *    lib/demo here would bundle the WHOLE demo dataset — every payslip line,
 *    the run roster, the differences report — into the browser payload for the
 *    five numbers this actually renders. The server page builds the array and
 *    passes it down, which kept ~9 KB gzipped out of the initial chunk.
 */

export interface ChainNode {
  key: string;
  stage: string;
  caption: string;
  value: string;
  detail: string;
  tone: 'dark' | 'light' | 'brand';
}

export function ChainHero({ nodes }: { nodes: readonly ChainNode[] }) {
  const root = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  /* Hide before paint, but only when motion is actually wanted. */
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const nodes = root.current?.querySelectorAll<HTMLElement>('[data-chain-node]');
    nodes?.forEach((n) => {
      n.style.opacity = '0';
      n.style.transform = 'translateY(10px)';
    });
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    // Loaded on the client only, and after the hero has already painted, so the
    // library is never on the critical path for LCP.
    import('animejs')
      .then(({ createTimeline, svg }) => {
        if (cancelled || !root.current) return;

        const nodes = root.current.querySelectorAll<HTMLElement>('[data-chain-node]');
        const line = root.current.querySelector<SVGPathElement>('[data-chain-line]');

        const tl = createTimeline({
          defaults: { ease: 'out(3)', duration: 520 },
        });

        if (line) {
          // The line draws for 1400ms and the fragments land at the moments it
          // reaches them — hence the -=1200 style offsets below rather than a
          // uniform stagger, which would drift away from the line.
          tl.add(svg.createDrawable(line), { draw: ['0 0', '0 1'], duration: 1400, ease: 'inOut(2)' }, 0);
        }

        nodes.forEach((node, i) => {
          tl.add(
            node,
            { opacity: [0, 1], translateY: [10, 0] },
            // First node arrives immediately; the rest track the line's tip.
            line ? 120 + i * 260 : i * 90
          );
        });

        return () => tl.revert();
      })
      .catch(() => {
        // If the library fails to load, leave the fragments visible rather than
        // stranding the hero — undo the pre-paint hide.
        root.current?.querySelectorAll<HTMLElement>('[data-chain-node]').forEach((n) => {
          n.style.opacity = '';
          n.style.transform = '';
        });
      });

    return () => {
      cancelled = true;
    };
  }, [ready]);

  return (
    <div ref={root} className="relative" data-cursor-label="The chain">
      <div className="relative">
        {/*
          The connector, running the full width at the cards' vertical centre.
          The cards are opaque, so what the reader actually sees is the line
          crossing the four GAPS between them — which is the point: it reads as
          five links joining up, and the left-to-right draw lights each gap in
          turn as the fragment beside it arrives.

          It sits at z-0 with the cards at z-10. An earlier version placed it
          above the row at a fixed offset, where it was hidden behind the cards
          entirely and the whole trace animation was invisible.

          Hidden below lg, where the fragments stack and a horizontal line would
          be nonsense. aria-hidden because it carries no information the ordered
          list does not already carry.
        */}
        <svg
          className="pointer-events-none absolute inset-x-0 top-1/2 z-0 hidden h-8 w-full -translate-y-1/2 lg:block"
          viewBox="0 0 1000 32"
          preserveAspectRatio="none"
          fill="none"
          aria-hidden="true"
        >
          <path
            data-chain-line
            d="M40 16 H960"
            stroke="rgb(var(--brand-400))"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="1 0"
          />
        </svg>

        <ol className="relative z-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:gap-4">
          {nodes.map((node, i) => (
            <li key={node.key} data-chain-node className="relative">
              <ChainCard {...node} index={i} />
            </li>
          ))}
        </ol>
      </div>

      <p className="mt-4 text-center text-[12.5px] leading-5 text-n-600">
        One employee, one month, one number — carried from a tracked minute to a paid payslip.
        No export, no reconciliation, no second system.
      </p>
    </div>
  );
}

function ChainCard({
  stage,
  caption,
  value,
  detail,
  tone,
  index,
}: {
  stage: string;
  caption: string;
  value: string;
  detail: string;
  tone: 'dark' | 'light' | 'brand';
  index: number;
}) {
  return (
    <div
      data-cursor-theme={tone === 'dark' ? 'dark' : undefined}
      className={cn(
        'flex h-full flex-col rounded-xl border p-3.5 shadow-card',
        tone === 'dark' && 'border-transparent surface-fixed-dark',
        tone === 'light' && 'border-n-200 bg-card',
        tone === 'brand' && 'border-brand-200 bg-brand-50'
      )}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'flex h-4 w-4 items-center justify-center rounded-full text-[9.5px] font-bold tnum',
            tone === 'dark' && 'bg-white/15 text-white/80',
            tone === 'light' && 'bg-n-100 text-n-600',
            tone === 'brand' && 'bg-brand-700 text-on-brand'
          )}
          aria-hidden="true"
        >
          {index + 1}
        </span>
        <p
          className={cn(
            'text-[10px] font-semibold tracking-[0.08em] uppercase',
            tone === 'dark' ? 'text-white/80' : tone === 'brand' ? 'text-brand-700' : 'text-n-600'
          )}
        >
          {stage}
        </p>
      </div>

      <p
        className={cn(
          'mt-2.5 font-display text-xl font-bold tnum',
          tone === 'dark' ? 'text-white' : tone === 'brand' ? 'text-brand-900' : 'text-n-900'
        )}
      >
        {value}
      </p>
      <p
        className={cn(
          'text-[11px] font-medium',
          tone === 'dark' ? 'text-white/80' : tone === 'brand' ? 'text-brand-700' : 'text-n-600'
        )}
      >
        {caption}
      </p>
      <p
        className={cn(
          'mt-auto pt-2 text-[10.5px] leading-4',
          tone === 'dark' ? 'text-white/70' : tone === 'brand' ? 'text-brand-700/80' : 'text-n-600'
        )}
      >
        {detail}
      </p>
    </div>
  );
}
