import Navbar from '@/components/landing/Navbar';
import Footer from '@/components/landing/Footer';
import AdaptiveSurface from '@/components/ui/AdaptiveSurface';
import { legalReviewNotice, type LegalSection } from '@/lib/legalContent';
import { useMemo } from 'react';

interface LegalDocumentPageProps {
  eyebrow: string;
  title: string;
  description: string;
  lastUpdated: string;
  sections: LegalSection[];
}

export default function LegalDocumentPage({
  eyebrow,
  title,
  description,
  lastUpdated,
  sections,
}: LegalDocumentPageProps) {
  const navbarMode = useMemo(() => (window.desktopTracker ? 'desktop-auth' : 'marketing'), []);

  return (
    <div className="relative overflow-x-clip bg-[linear-gradient(180deg,#fcfdff_0%,#f2f8ff_24%,#eef5ff_48%,#f8fafc_100%)] text-slate-950">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(circle_at_top,rgba(125,211,252,0.35),transparent_58%)]" />
      <div className="pointer-events-none absolute left-[-8%] top-[16%] h-80 w-80 rounded-full bg-sky-200/30 blur-3xl" />
      <div className="pointer-events-none absolute right-[-6%] top-[38%] h-[26rem] w-[26rem] rounded-full bg-cyan-200/20 blur-3xl" />

      <Navbar mode={navbarMode} />

      <section className="px-4 pb-10 pt-16 sm:px-6 sm:pb-12 sm:pt-22 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-sky-700">{eyebrow}</p>
          <h1 className="mt-5 text-4xl font-semibold tracking-[-0.06em] text-slate-950 sm:text-[4.4rem] sm:leading-[0.94]">
            {title}
          </h1>
          <p className="mt-6 max-w-3xl text-base leading-8 text-slate-600 sm:text-[1.08rem]">
            {description}
          </p>
          <p className="mt-4 text-sm font-medium text-slate-500">Last updated: {lastUpdated}</p>
        </div>
      </section>

      <section className="px-4 pb-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl space-y-6">
          <AdaptiveSurface
            className="rounded-[30px] border border-amber-200/80 bg-amber-50/85 p-5 shadow-[0_24px_70px_-48px_rgba(15,23,42,0.28)]"
            tone="light"
            backgroundColor="rgba(255,251,235,0.85)"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">Launch note</p>
            <p className="mt-3 text-sm leading-7 text-amber-900">{legalReviewNotice}</p>
          </AdaptiveSurface>

          {sections.map((section) => (
            <AdaptiveSurface
              key={section.id}
              className="rounded-[30px] border border-white/80 bg-white/88 p-6 shadow-[0_28px_80px_-50px_rgba(15,23,42,0.32)] sm:p-8"
              tone="light"
              backgroundColor="rgba(255,255,255,0.88)"
            >
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950">{section.heading}</h2>
              <div className="mt-4 space-y-4">
                {section.paragraphs.map((paragraph, index) => (
                  <p key={`${section.id}-paragraph-${index}`} className="text-sm leading-7 text-slate-600 sm:text-[0.98rem]">
                    {paragraph}
                  </p>
                ))}
              </div>
              {section.bullets?.length ? (
                <ul className="mt-5 space-y-3">
                  {section.bullets.map((bullet) => (
                    <li
                      key={bullet}
                      className="rounded-[22px] border border-slate-200/80 bg-slate-50/80 px-4 py-3 text-sm leading-7 text-slate-600"
                    >
                      {bullet}
                    </li>
                  ))}
                </ul>
              ) : null}
            </AdaptiveSurface>
          ))}
        </div>
      </section>

      <Footer />
    </div>
  );
}
