import Link from 'next/link';
import type { ReactNode } from 'react';
import { CTA } from '@/lib/site';
import { Reveal } from '@/components/motion/Reveal';
import {
  Button,
  Card,
  Container,
  Eyebrow,
  Lead,
  Section,
  SectionTitle,
  cn,
} from '@/components/ui/primitives';

/**
 * Shared furniture for the product pages.
 *
 * The discipline these enforce is Personio's, and it is the strongest single
 * pattern found across the ten sites researched: EVERY feature block pairs a
 * real screen with one specific, defensible sentence. Not "powerful reporting"
 * — "the differences report names every component that moved between two runs,
 * and which override moved it."
 *
 * `FeatureBlock` therefore requires a `claim` prop. If you cannot cite a line in
 * PRODUCT_TRUTH.md, you do not have a feature block; you have a slogan.
 */

export function ProductHero({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow: string;
  title: string;
  lede: string;
  children?: ReactNode;
}) {
  return (
    <section className="pt-14 pb-10 sm:pt-20 lg:pt-24">
      <Container>
        <div className="max-w-3xl">
          <Eyebrow>{eyebrow}</Eyebrow>
          <SectionTitle as="h1" className="mt-3">
            {title}
          </SectionTitle>
          <Lead className="mt-5">{lede}</Lead>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button href={CTA.demo.href} size="lg">
              {CTA.demo.label}
            </Button>
            <Button href="/pricing" tone="secondary" size="lg">
              See pricing
            </Button>
          </div>
        </div>
        {children && <div className="mt-12">{children}</div>}
      </Container>
    </section>
  );
}

export function FeatureBlock({
  eyebrow,
  title,
  body,
  claim,
  points,
  screen,
  flip = false,
  stat,
}: {
  eyebrow?: string;
  title: string;
  body: string;
  /** PRODUCT_TRUTH.md claim ID. Required — see the note above. */
  claim: string;
  points?: ReadonlyArray<{ text: string; claim: string }>;
  screen: ReactNode;
  flip?: boolean;
  /** A number beside the screen, never floated on top of it. */
  stat?: { value: string; label: string };
}) {
  return (
    <div
      data-claim={claim}
      className="grid gap-8 lg:grid-cols-2 lg:items-center lg:gap-14"
    >
      <div className={cn(flip && 'lg:order-2')}>
        {eyebrow && <Eyebrow className="mb-3">{eyebrow}</Eyebrow>}
        <h3 className="font-display text-2xl leading-tight font-bold text-balance text-n-900">
          {title}
        </h3>
        <p className="mt-3 leading-7 text-pretty text-n-600">{body}</p>

        {points && (
          <ul className="mt-5 grid gap-2.5">
            {points.map((p) => (
              <li
                key={p.text}
                data-claim={p.claim}
                className="flex gap-2.5 text-[14.5px] leading-6 text-n-700"
              >
                <svg
                  viewBox="0 0 16 16"
                  className="mt-1.5 h-3 w-3 shrink-0 text-brand-600"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 8.5 6.2 11.6 13 4.6" />
                </svg>
                <span>{p.text}</span>
              </li>
            ))}
          </ul>
        )}

        {stat && (
          <div className="mt-6 border-l-2 border-brand-300 pl-4">
            <p className="font-display text-data text-n-900 tnum">{stat.value}</p>
            <p className="mt-0.5 text-[13.5px] leading-5 text-n-600">{stat.label}</p>
          </div>
        )}
      </div>

      <Reveal className={cn('min-w-0', flip && 'lg:order-1')}>{screen}</Reveal>
    </div>
  );
}

/** Honest counterpart to a feature list. Every product page carries one. */
export function NotBuiltNote({
  items,
  children,
}: {
  items: readonly string[];
  children?: ReactNode;
}) {
  return (
    <Card className="border-n-300 p-6">
      <Eyebrow tone="muted">What this page does not claim</Eyebrow>
      {children && <p className="mt-3 text-[14px] leading-6 text-n-600">{children}</p>}
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item} className="flex gap-2.5 text-[13.5px] leading-5 text-n-600">
            <svg
              viewBox="0 0 16 16"
              className="mt-1 h-3 w-3 shrink-0 text-n-500"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
            {item}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ProductCta({
  title = 'See it run on your own numbers.',
  body = 'Twenty minutes, with someone who can answer engine questions rather than read a script.',
}: {
  title?: string;
  body?: string;
}) {
  return (
    <Section tone="deep">
      <Container width="prose" className="text-center">
        <h2 className="font-display text-title text-balance">{title}</h2>
        <p className="mx-auto mt-4 max-w-xl leading-7 text-pretty text-white/80">{body}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button href={CTA.demo.href} tone="inverse" size="lg">
            {CTA.demo.label}
          </Button>
          <Button href="/tools" tone="inverse-secondary" size="lg">
            Try the free calculators
          </Button>
        </div>
      </Container>
    </Section>
  );
}

/** Placeholder body for the P2 pages, marked honestly rather than faked. */
export function PlaceholderNote({ topic, related }: { topic: string; related: string }) {
  return (
    <Section>
      <Container width="prose">
        <Card className="border-accent-200 bg-accent-50 p-6">
          <Eyebrow tone="accent">This page is still being written</Eyebrow>
          <p className="mt-3 leading-7 text-n-700">
            The {topic} module is built and shipping — this marketing page for it is not finished.
            Rather than fill it with copy nobody has checked against the codebase, it says so.
          </p>
          <p className="mt-3 leading-7 text-n-700">
            In the meantime, {related} covers the part of this that matters most, and a demo will
            show you the real screens.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button href={CTA.demoShort.href}>{CTA.demoShort.label}</Button>
            <Button href="/product" tone="secondary">
              Platform overview
            </Button>
          </div>
        </Card>
        <p className="mt-6 text-center text-[13px] text-n-600">
          Every claim on this site traces to a line in the product audit.{' '}
          <Link href="/methodology" className="underline underline-offset-4 hover:text-n-800">
            How we count
          </Link>
        </p>
      </Container>
    </Section>
  );
}
