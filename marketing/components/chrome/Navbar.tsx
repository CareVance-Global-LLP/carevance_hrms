'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import {
  CTA,
  PRODUCT_FEATURED,
  PRODUCT_MORE,
  SOLUTIONS,
  COMPARISONS,
  RESOURCES,
  TOOLS,
  SITE,
  type NavItem,
} from '@/lib/site';
import { Button, Container, cn } from '@/components/ui/primitives';
import { ThemeToggle } from '@/components/chrome/theme';
import { Wordmark } from '@/components/chrome/Wordmark';

/**
 * The primary navigation.
 *
 * Two things here are requirements rather than choices:
 *
 * · The Product menu is a grouped mega-menu with six described items and a
 *   secondary column, not a flat eleven-item list. Eleven equal links force the
 *   reader to do the categorisation the navigation exists to do for them.
 *
 * · It is operable from the keyboard alone. The trigger is a real <button> with
 *   aria-expanded and aria-controls; Escape closes the panel and returns focus
 *   to the trigger; moving focus out of the panel closes it. Hover is an
 *   enhancement layered on top, never the only way in.
 */

type MenuKey = 'product' | 'solutions' | 'resources' | 'tools' | null;

export function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState<MenuKey>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Route change closes everything — otherwise a menu survives the navigation
     it just triggered and hangs over the new page. */
  useEffect(() => {
    setOpen(null);
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (open) {
        const trigger = navRef.current?.querySelector<HTMLButtonElement>(
          `[data-menu-trigger="${open}"]`
        );
        setOpen(null);
        trigger?.focus();
      }
      if (mobileOpen) setMobileOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, mobileOpen]);

  /* The body must not scroll behind the mobile drawer. */
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  /* Hover intent. A bare onMouseLeave closes the panel while the pointer is
     crossing the gap between trigger and panel, which makes the menu feel like
     it is fighting the reader. */
  const openMenu = (key: MenuKey) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(key);
  };
  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(null), 120);
  };

  return (
    <header
      ref={navRef}
      className={cn(
        'sticky top-0 z-50 w-full border-b transition-colors duration-200',
        scrolled || open || mobileOpen
          ? 'border-n-200 bg-app/85 backdrop-blur-md supports-[backdrop-filter]:bg-app/70'
          : 'border-transparent bg-transparent'
      )}
      onMouseLeave={scheduleClose}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-10 focus:rounded-lg focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-modal"
      >
        Skip to content
      </a>

      <Container width="wide">
        {/*
          The bar loses 8px on scroll. It is a small move deliberately: the
          navbar is sticky, so the height it settles at is height the reader
          loses from every screen below the fold for the rest of the visit, and
          anything more aggressive turns into a bar that visibly jumps each time
          the reader crosses the threshold.

          Height is the one property animated anywhere on this site that is not
          transform or opacity, and it is the exception that has to be made: a
          sticky header must actually occupy less space, which a scaled one does
          not. It is one element, one 200ms transition, at the top of the layer.
        */}
        <nav
          aria-label="Primary"
          className={cn(
            'flex items-center gap-2 transition-[height] duration-200 ease-[cubic-bezier(0.22,0.61,0.36,1)] motion-reduce:transition-none',
            scrolled ? 'h-14' : 'h-16'
          )}
        >
          <Link href="/" className="mr-2 flex items-center gap-2 rounded-lg" aria-label={`${SITE.name} home`}>
            <Wordmark />
          </Link>

          <div className="hidden items-center gap-0.5 lg:flex">
            <MenuTrigger
              menuKey="product"
              label="Product"
              open={open}
              onOpen={openMenu}
              onClose={scheduleClose}
            >
              <ProductPanel />
            </MenuTrigger>

            <MenuTrigger
              menuKey="solutions"
              label="Solutions"
              open={open}
              onOpen={openMenu}
              onClose={scheduleClose}
            >
              <SimplePanel
                columns={[
                  { heading: 'By business', items: SOLUTIONS },
                  { heading: 'Switching from', items: COMPARISONS },
                ]}
              />
            </MenuTrigger>

            <TopLink href="/pricing" active={pathname === '/pricing'}>
              Pricing
            </TopLink>

            <MenuTrigger
              menuKey="tools"
              label="Free tools"
              open={open}
              onOpen={openMenu}
              onClose={scheduleClose}
            >
              <SimplePanel columns={[{ heading: 'Calculators', items: TOOLS }]} footerHref="/tools" footerLabel="All free tools" />
            </MenuTrigger>

            <MenuTrigger
              menuKey="resources"
              label="Resources"
              open={open}
              onOpen={openMenu}
              onClose={scheduleClose}
            >
              <SimplePanel columns={[{ heading: 'Learn', items: RESOURCES }]} />
            </MenuTrigger>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {/*
              Responsive visibility is applied to a WRAPPER, never to the control
              itself.

              `<Button className="hidden sm:inline-flex">` looks like it should
              work and does not: `hidden` and `inline-flex` are both display
              utilities in the same Tailwind layer, and the base class list
              already carries `inline-flex`, which is generated later and wins
              regardless of the order they appear in the attribute. The result
              was both CTAs rendering at 390px and pushing the navbar 4px past
              the viewport on every page.
            */}
            <span className="hidden sm:flex">
              <ThemeToggle />
            </span>
            <Link
              href={CTA.signIn.href}
              className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-n-600 transition-colors hover:text-n-900 lg:inline-flex"
            >
              {CTA.signIn.label}
            </Link>
            <span className="hidden xl:flex">
              <Button href={CTA.tour.href} tone="secondary">
                See it live — 2 min
              </Button>
            </span>
            <span className="hidden sm:flex">
              <Button href={CTA.demoShort.href} tone="primary">
                {CTA.demoShort.label}
              </Button>
            </span>

            <button
              type="button"
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((v) => !v)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-n-700 hover:bg-n-100 lg:hidden"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                {mobileOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
              </svg>
            </button>
          </div>
        </nav>
      </Container>

      {mobileOpen && (
        <div
          id="mobile-nav"
          className="menu-in max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-n-200 bg-app lg:hidden"
        >
            <Container className="py-6">
              <MobileGroup heading="Product" items={[...PRODUCT_FEATURED, ...PRODUCT_MORE]} />
              <MobileGroup heading="Solutions" items={[...SOLUTIONS, ...COMPARISONS]} />
              <MobileGroup heading="Free tools" items={TOOLS} />
              <MobileGroup heading="Resources" items={RESOURCES} />
              <div className="mt-6 grid gap-2 border-t border-n-200 pt-6">
                <Link href="/pricing" className="py-2 text-[15px] font-semibold text-n-900">
                  Pricing
                </Link>
                <Link href={CTA.signIn.href} className="py-2 text-[15px] font-semibold text-n-700">
                  {CTA.signIn.label}
                </Link>
                <div className="mt-2 grid gap-2">
                  <Button href={CTA.demo.href} size="lg">
                    {CTA.demo.label}
                  </Button>
                  <Button href={CTA.tour.href} tone="secondary" size="lg">
                    {CTA.tour.label}
                  </Button>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <ThemeToggle />
                  <span className="text-sm text-n-600">Switch theme</span>
                </div>
              </div>
          </Container>
        </div>
      )}
    </header>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────── */

function TopLink({
  href,
  children,
  active,
}: {
  href: string;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
        active ? 'text-brand-700' : 'text-n-600 hover:text-n-900'
      )}
    >
      {children}
    </Link>
  );
}

function MenuTrigger({
  menuKey,
  label,
  open,
  onOpen,
  onClose,
  children,
}: {
  menuKey: Exclude<MenuKey, null>;
  label: string;
  open: MenuKey;
  onOpen: (k: MenuKey) => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelId = useId();
  const isOpen = open === menuKey;

  return (
    <div
      className="relative"
      onMouseEnter={() => onOpen(menuKey)}
      onMouseLeave={onClose}
      /* Tabbing out of the last link in the panel must close it. Without this
         the panel stays open over content the reader has already moved past. */
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) onClose();
      }}
    >
      <button
        type="button"
        data-menu-trigger={menuKey}
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-haspopup="true"
        onClick={() => (isOpen ? onClose() : onOpen(menuKey))}
        className={cn(
          'inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
          isOpen ? 'text-n-900' : 'text-n-600 hover:text-n-900'
        )}
      >
        {label}
        <svg
          viewBox="0 0 16 16"
          className={cn('h-3.5 w-3.5 transition-transform duration-200', isOpen && 'rotate-180')}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 6.5 8 10.5l4-4" />
        </svg>
      </button>

      {isOpen && (
        <div id={panelId} className="menu-in absolute top-full left-0 z-50 pt-2">
          <div className="rounded-xl border border-n-200 bg-card p-2 shadow-modal">{children}</div>
        </div>
      )}
    </div>
  );
}

function ProductPanel() {
  return (
    <div className="flex w-[46rem] gap-2">
      <ul className="grid flex-1 grid-cols-2 gap-1">
        {PRODUCT_FEATURED.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="block rounded-lg p-3 transition-colors hover:bg-n-100 focus-visible:bg-n-100"
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold text-n-900">
                {item.label}
                {item.placeholder && <SoonDot />}
              </span>
              <span className="mt-0.5 block text-[13px] leading-5 text-n-600">{item.blurb}</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="w-52 shrink-0 rounded-lg bg-sunken p-3">
        <p className="text-caption uppercase text-n-600">Also included</p>
        <ul className="mt-2 grid gap-0.5">
          {PRODUCT_MORE.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium text-n-700 transition-colors hover:bg-card hover:text-n-900"
              >
                {item.label}
                {item.placeholder && <SoonDot />}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function SimplePanel({
  columns,
  footerHref,
  footerLabel,
}: {
  columns: Array<{ heading: string; items: readonly NavItem[] }>;
  footerHref?: string;
  footerLabel?: string;
}) {
  return (
    <div className="w-[22rem] max-w-[90vw]">
      {columns.map((col) => (
        <div key={col.heading} className="p-1">
          <p className="px-3 pt-2 pb-1 text-caption uppercase text-n-600">{col.heading}</p>
          <ul className="grid gap-0.5">
            {col.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded-lg px-3 py-2 transition-colors hover:bg-n-100 focus-visible:bg-n-100"
                >
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-n-900">
                    {item.label}
                    {item.placeholder && <SoonDot />}
                  </span>
                  {item.blurb && (
                    <span className="mt-0.5 block text-[13px] leading-5 text-n-600">{item.blurb}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {footerHref && (
        <div className="mt-1 border-t border-n-200 p-1">
          <Link
            href={footerHref}
            className="block rounded-lg px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-n-100"
          >
            {footerLabel} →
          </Link>
        </div>
      )}
    </div>
  );
}

function MobileGroup({ heading, items }: { heading: string; items: readonly NavItem[] }) {
  return (
    <div className="border-b border-n-200 py-4 first:pt-0">
      <p className="text-caption uppercase text-n-600">{heading}</p>
      <ul className="mt-2 grid gap-0.5">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="flex items-center gap-1.5 py-2 text-[15px] font-medium text-n-800"
            >
              {item.label}
              {item.placeholder && <SoonDot />}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Marks a page that exists but is still placeholder copy. Honesty in the nav
 * costs one dot and saves a reader the click; a stub presented as finished is
 * the same category of small lie the rest of this site is built to avoid.
 */
function SoonDot() {
  return (
    <span
      title="In progress"
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400"
      aria-label="(in progress)"
    />
  );
}
