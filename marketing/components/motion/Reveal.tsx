'use client';

import { useEffect, useRef, useState, type ReactNode, type ElementType } from 'react';

/**
 * Motion 1 — Reveal, and Motion 2 — Stagger.
 *
 * These deliberately do NOT use motion/react.
 *
 * The navbar sits in the root layout, so anything it imports lands in the
 * initial bundle of every page — and these two primitives are used on nearly
 * every section, which dragged the animation library onto the critical path and
 * put the homepage 56 KB over the 180 KB budget. A reveal is one opacity and one
 * translate on an intersection: that is an IntersectionObserver and a CSS
 * transition, about a kilobyte, and indistinguishable to the reader.
 *
 * The same reasoning removed the dependency entirely: the tab pill became a
 * measured transform, and the cursor's spring became eight lines of lerp. Six
 * motions, hand-rolled, and 56 KB back under the budget.
 *
 * Under `prefers-reduced-motion` this renders a plain element with no observer
 * attached at all. Content and layout are identical; only the movement is gone.
 */

const EASE = 'cubic-bezier(0.22,0.61,0.36,1)';

/** Fires once at 20% intersection and never again — never re-trigger on scroll-up. */
function useRevealOnce<T extends HTMLElement>(enabled: boolean) {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(!enabled);

  useEffect(() => {
    if (!enabled) return;
    const node = ref.current;
    if (!node) return;

    // Already in view on load (or IO unsupported): show immediately rather than
    // waiting for a scroll that may never come.
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled]);

  return { ref, shown };
}

function usePrefersMotion(): boolean {
  // Starts false so the server-rendered markup and the first client paint agree;
  // the effect turns motion on only after hydration, for readers who want it.
  const [wants, setWants] = useState(false);
  useEffect(() => {
    setWants(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);
  return wants;
}

interface RevealProps {
  children: ReactNode;
  /** Extra delay in ms. Use sparingly; prefer <Stagger>. */
  delay?: number;
  as?: ElementType;
  className?: string;
  id?: string;
}

export function Reveal({ children, delay = 0, as: Tag = 'div', className, id }: RevealProps) {
  const animate = usePrefersMotion();
  const { ref, shown } = useRevealOnce<HTMLDivElement>(animate);

  return (
    <Tag
      ref={ref}
      id={id}
      className={className}
      style={
        animate
          ? {
              opacity: shown ? 1 : 0,
              transform: shown ? 'none' : 'translateY(16px)',
              transition: `opacity 500ms ${EASE} ${delay}ms, transform 500ms ${EASE} ${delay}ms`,
              willChange: shown ? undefined : 'opacity, transform',
            }
          : undefined
      }
    >
      {children}
    </Tag>
  );
}

/** Never stagger more than this — past it the tail reads as lag, not choreography. */
const STAGGER_CAP = 8;

export function Stagger({
  children,
  className,
  as: Tag = 'div',
  step = 60,
}: {
  children: ReactNode;
  className?: string;
  as?: ElementType;
  /** Milliseconds between children. */
  step?: number;
}) {
  const animate = usePrefersMotion();
  const { ref, shown } = useRevealOnce<HTMLDivElement>(animate);

  return (
    <Tag
      ref={ref}
      className={className}
      data-stagger={animate ? (shown ? 'shown' : 'hidden') : undefined}
      style={animate ? ({ '--stagger-step': `${step}ms` } as React.CSSProperties) : undefined}
    >
      {children}
    </Tag>
  );
}

export function StaggerItem({
  children,
  className,
  as: Tag = 'div',
  index = 0,
}: {
  children: ReactNode;
  className?: string;
  as?: ElementType;
  index?: number;
}) {
  const capped = Math.min(index, STAGGER_CAP);
  return (
    <Tag
      className={className}
      style={{ '--stagger-index': capped } as React.CSSProperties}
      data-stagger-item=""
    >
      {children}
    </Tag>
  );
}
