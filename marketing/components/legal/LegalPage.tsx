import type { ReactNode } from 'react';
import Link from 'next/link';
import { LEGAL } from '@/lib/site';
import { breadcrumbSchema, JsonLd } from '@/lib/schema';
import { Container, Eyebrow, Section, SectionTitle } from '@/components/ui/primitives';

/**
 * Shell for the three legal documents.
 *
 * Two conventions here are deliberate. First, every document carries an
 * effective date — an undated policy is unenforceable in practice and tells the
 * reader nothing about what they agreed to. Second, details that only the
 * company can supply (registered entity name, address, grievance officer) are
 * marked with a visible <Pending> rather than filled with something plausible.
 * A legal document containing an invented registered address is worse than one
 * that is honestly incomplete.
 */

export const EFFECTIVE_DATE = '20 August 2026';
export const EFFECTIVE_ISO = '2026-08-20';

export function LegalPage({
  title,
  href,
  summary,
  children,
}: {
  title: string;
  href: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <>
      <JsonLd
        schema={breadcrumbSchema([
          { label: 'Home', href: '/' },
          { label: title, href },
        ])}
      />

      <section className="pt-14 pb-8 sm:pt-20">
        <Container width="prose">
          <Eyebrow>Legal</Eyebrow>
          <SectionTitle as="h1" className="mt-3">
            {title}
          </SectionTitle>
          <p className="mt-4 text-[16px] leading-7 text-n-600">{summary}</p>
          <p className="mt-5 text-[13px] text-n-600">
            Effective <time dateTime={EFFECTIVE_ISO}>{EFFECTIVE_DATE}</time>. We will give notice
            of material changes before they take effect, and keep prior versions available on
            request.
          </p>

          <nav aria-label="Legal documents" className="mt-6 flex flex-wrap gap-2">
            {LEGAL.map((doc) => (
              <Link
                key={doc.href}
                href={doc.href}
                aria-current={doc.href === href ? 'page' : undefined}
                className={
                  doc.href === href
                    ? 'rounded-lg bg-brand-700 px-3 py-1.5 text-[13px] font-semibold text-on-brand'
                    : 'rounded-lg border border-n-300 px-3 py-1.5 text-[13px] font-medium text-n-700 transition-colors hover:border-n-400 hover:text-n-900'
                }
              >
                {doc.label}
              </Link>
            ))}
          </nav>
        </Container>
      </section>

      <Section className="pt-0">
        <Container width="prose">
          <div
            className="grid gap-5 text-[15px] leading-7 text-n-700 [&_h2]:mt-6 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-n-900 [&_h3]:mt-4 [&_h3]:font-semibold [&_h3]:text-n-900 [&_li]:leading-7 [&_ol]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_strong]:text-n-900 [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-1.5"
          >
            {children}
          </div>
        </Container>
      </Section>
    </>
  );
}

/**
 * A detail only the company can fill in. Rendered visibly, because a reader
 * deserves to know a clause is incomplete rather than discovering later that it
 * was quietly guessed.
 */
export function Pending({ children }: { children: ReactNode }) {
  return (
    <mark className="rounded bg-accent-100 px-1.5 py-0.5 text-[14px] font-semibold text-accent-700">
      [{children}]
    </mark>
  );
}
