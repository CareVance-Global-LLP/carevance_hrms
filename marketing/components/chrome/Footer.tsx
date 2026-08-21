import Link from 'next/link';
import {
  SITE,
  PRODUCT_FEATURED,
  PRODUCT_MORE,
  SOLUTIONS,
  COMPARISONS,
  TOOLS,
  RESOURCES,
  COMPANY,
  LEGAL,
  type NavItem,
} from '@/lib/site';
import { Container, Eyebrow } from '@/components/ui/primitives';
import { Wordmark } from '@/components/chrome/Wordmark';

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-n-200 bg-sunken">
      <Container width="wide" className="py-14">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2.4fr)]">
          <div>
            <Wordmark />
            <p className="mt-4 max-w-xs text-sm leading-6 text-n-600">
              Indian HR and payroll where the evidence of work and the payslip are the same
              system.
            </p>
            <p className="mt-5 text-sm text-n-600">
              <a
                href={`mailto:${SITE.salesEmail}`}
                className="font-medium text-n-700 underline-offset-4 hover:underline"
              >
                {SITE.salesEmail}
              </a>
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            <Column heading="Product" items={[...PRODUCT_FEATURED, ...PRODUCT_MORE]} />
            <Column
              heading="Solutions"
              items={[...SOLUTIONS, ...COMPARISONS, { href: '/pricing', label: 'Pricing' }]}
            />
            <Column heading="Free tools" items={TOOLS} />
            <Column heading="Company" items={[...RESOURCES, ...COMPANY]} />
          </div>
        </div>

        <div className="mt-12 border-t border-n-200 pt-6">
          {/*
            The honesty note. A visitor deciding whether to hand over salary data
            is exactly the person who should be told, unprompted, that the
            numbers on this site are counted rather than claimed — and where to
            check them.
          */}
          <p className="max-w-3xl text-[13px] leading-6 text-n-600">
            Every figure on this site is counted from the CareVance codebase, not estimated.{' '}
            <Link href="/methodology" className="font-medium text-n-700 underline underline-offset-4">
              See how we count
            </Link>
            . We publish no customer counts, review scores or certification badges, because we
            have not earned them yet. Prices exclude 18% GST.
          </p>

          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] text-n-600">
              © {year} {SITE.legalName}. All rights reserved.
            </p>
            <ul className="flex flex-wrap gap-x-5 gap-y-2">
              {LEGAL.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-[13px] text-n-600 underline-offset-4 hover:text-n-800 hover:underline"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Container>
    </footer>
  );
}

function Column({ heading, items }: { heading: string; items: readonly NavItem[] }) {
  return (
    <div>
      <Eyebrow tone="muted">{heading}</Eyebrow>
      <ul className="mt-3 grid gap-2">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="text-sm text-n-600 underline-offset-4 transition-colors hover:text-n-900 hover:underline"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
