import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { HOVER_LIFT_CLASS } from '@/lib/motion';

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* ── Layout ───────────────────────────────────────────────────────────── */

export function Container({
  children,
  className,
  width = 'default',
}: {
  children: ReactNode;
  className?: string;
  width?: 'default' | 'wide' | 'prose';
}) {
  const widths = {
    default: 'max-w-6xl',
    wide: 'max-w-7xl',
    prose: 'max-w-3xl',
  };
  return (
    <div className={cn('mx-auto w-full px-5 sm:px-6 lg:px-8', widths[width], className)}>
      {children}
    </div>
  );
}

export function Section({
  children,
  className,
  id,
  tone = 'default',
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  /** `sunken` gives a section its own band without introducing a new colour. */
  tone?: 'default' | 'sunken' | 'card' | 'deep';
  as?: 'section' | 'div' | 'article';
}) {
  const tones = {
    default: '',
    sunken: 'bg-sunken',
    card: 'bg-card',
    deep: 'band-deep',
  };
  return (
    <Tag
      id={id}
      data-cursor-theme={tone === 'deep' ? 'dark' : undefined}
      className={cn('py-16 sm:py-20 lg:py-24', tones[tone], className)}
    >
      {children}
    </Tag>
  );
}

/* ── Type ─────────────────────────────────────────────────────────────── */

export function Eyebrow({
  children,
  className,
  tone = 'brand',
}: {
  children: ReactNode;
  className?: string;
  tone?: 'brand' | 'accent' | 'muted' | 'inverse';
}) {
  const tones = {
    brand: 'text-brand-700',
    // accent-500 is 2.50:1 on a light surface — below AA even for large text.
    // accent-700 is 5.04:1 in light and stays legible in dark, where the ramp inverts.
    accent: 'text-accent-700',
    muted: 'text-n-600',
    inverse: 'text-white/70',
  };
  return (
    <p className={cn('text-caption uppercase', tones[tone], className)}>{children}</p>
  );
}

export function SectionTitle({
  children,
  className,
  as: Tag = 'h2',
}: {
  children: ReactNode;
  className?: string;
  as?: 'h1' | 'h2' | 'h3';
}) {
  return (
    <Tag className={cn('font-display text-title text-balance text-n-900', className)}>
      {children}
    </Tag>
  );
}

export function Lead({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('text-lg leading-8 text-pretty text-n-600', className)}>{children}</p>
  );
}

/* ── Surface ──────────────────────────────────────────────────────────── */

export function Card({
  children,
  className,
  interactive = false,
  as: Tag = 'div',
  ...rest
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  as?: 'div' | 'li' | 'article';
  /* `data-claim` rides through here — see <Claim>. */
} & Record<`data-${string}`, string | undefined>) {
  return (
    <Tag
      {...rest}
      data-cursor={interactive ? 'lift' : undefined}
      className={cn(
        'rounded-xl border border-n-200 bg-card shadow-card',
        interactive && HOVER_LIFT_CLASS,
        className
      )}
    >
      {children}
    </Tag>
  );
}

/* ── Actions ──────────────────────────────────────────────────────────── */

type ButtonTone = 'primary' | 'secondary' | 'ghost' | 'inverse' | 'inverse-secondary';
type ButtonSize = 'md' | 'lg';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg font-semibold ' +
  'transition-[background-color,color,transform,box-shadow] duration-150 ' +
  'ease-[cubic-bezier(0.22,0.61,0.36,1)] ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
  'disabled:pointer-events-none disabled:opacity-50';

const BUTTON_TONES: Record<ButtonTone, string> = {
  primary: 'bg-brand-700 text-on-brand hover:bg-brand-800 active:translate-y-px shadow-card',
  secondary: 'border border-n-300 bg-card text-n-800 hover:border-n-400 hover:bg-n-50',
  ghost: 'text-n-700 hover:bg-n-100 hover:text-n-900',
  // On a .band-deep slab, which is deep in BOTH themes — so these are literal
  // white/near-black, not tokens that would invert out from under the slab.
  inverse: 'bg-white text-[rgb(var(--cta-to))] hover:bg-white/90 active:translate-y-px',
  'inverse-secondary': 'border border-white/35 text-white hover:bg-white/10',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-[15px]',
};

/**
 * NOTE ON RESPONSIVE VISIBILITY.
 *
 * Do NOT pass `hidden md:inline-flex` (or similar) in `className`. The base
 * class list already sets `inline-flex`, and Tailwind emits display utilities in
 * a fixed order within the layer — so `inline-flex` wins over `hidden` no matter
 * which order they appear in the attribute, and the button stays visible.
 *
 * Wrap it instead:  <span className="hidden md:flex"><Button …/></span>
 */
export function Button({
  href,
  children,
  tone = 'primary',
  size = 'md',
  className,
  external = false,
  ...rest
}: {
  href: string;
  children: ReactNode;
  tone?: ButtonTone;
  size?: ButtonSize;
  className?: string;
  external?: boolean;
} & Omit<ComponentProps<typeof Link>, 'href' | 'className' | 'children'>) {
  const classes = cn(BUTTON_BASE, BUTTON_TONES[tone], BUTTON_SIZES[size], className);

  if (external || href.startsWith('http')) {
    return (
      <a href={href} className={classes} rel="noopener">
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={classes} {...rest}>
      {children}
    </Link>
  );
}

/* ── Citation ─────────────────────────────────────────────────────────── */

/**
 * Marks a claim with the PRODUCT_TRUTH.md ID it was audited under.
 *
 * Invisible in the page, present in the markup. Two reasons it is worth the
 * bytes: the acceptance criterion is that every claim traces to a line in that
 * file, and `grep -o 'data-claim="[^"]*"'` over the built HTML turns that from
 * a promise into a check. It is not a footnote UI — readers never see it.
 */
export function Claim({
  id,
  children,
  className,
  as: Tag = 'span',
}: {
  id: string;
  children: ReactNode;
  className?: string;
  as?: 'span' | 'p' | 'li' | 'div';
}) {
  return (
    <Tag data-claim={id} className={className}>
      {children}
    </Tag>
  );
}
