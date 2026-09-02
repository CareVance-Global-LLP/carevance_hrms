import { Link } from 'react-router-dom';
import { ArrowRight, CalendarRange, Mail, Phone } from 'lucide-react';
import Navbar from '@/components/landing/Navbar';
import Footer from '@/components/landing/Footer';
import LandingPageChatBubble from '@/components/LandingPageChatBubble';
import AdaptiveSurface from '@/components/ui/AdaptiveSurface';
import PublicPageTransition from '@/components/public/PublicPageTransition';
import { pricingUi } from '@/constants/pricing';
import { analytics } from '@/lib/analytics';
import { brandLabel, mailSubjectBrand } from '@/config/brand';

export default function ContactSalesPage() {
  const mailtoLink = `mailto:${pricingUi.contactEmail}?subject=${encodeURIComponent(mailSubjectBrand)}Sales Inquiry`;

  return (
    <div className="relative overflow-x-clip page-canvas text-slate-950">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(circle_at_top,rgba(125,211,252,0.35),transparent_58%)]" />
      <Navbar />

      <PublicPageTransition>
        <section className="px-4 pb-16 pt-16 sm:px-6 sm:pt-22 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-sky-700">Contact sales</p>
              <h1 className="mt-5 text-4xl font-semibold tracking-[-0.06em] text-slate-950 sm:text-[4.4rem] sm:leading-[0.94]">
                Plan an onboarding conversation with the {brandLabel} team
              </h1>
              <p className="mt-6 text-base leading-8 text-slate-600 sm:text-[1.08rem]">
                Reach out when you want a tailored rollout discussion, enterprise pricing guidance, or help mapping your invite and onboarding workflow.
              </p>
            </div>

            <div className="mt-12 grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
              <AdaptiveSurface
                className="rounded-[34px] border border-white/80 bg-white/88 p-6 shadow-[0_36px_90px_-48px_rgba(15,23,42,0.32)] sm:p-8"
                tone="light"
                backgroundColor="rgba(255,255,255,0.88)"
              >
                <div className="rounded-[26px] border border-slate-200/80 bg-slate-50/85 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">What to expect</p>
                  <ul className="mt-4 space-y-3 text-sm leading-7 text-slate-600">
                    <li>Review your workspace structure, roles, and invitation needs.</li>
                    <li>Talk through rollout timing, trial expectations, and billing setup.</li>
                    <li>Identify whether Starter, Growth, or Enterprise is the right fit.</li>
                  </ul>
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <a
                    href={mailtoLink}
                    onClick={() => analytics.trackEvent('book_demo_clicked', { location: 'contact-sales-email' })}
                    className="rounded-[26px] border border-slate-200/90 bg-white p-5 shadow-[0_20px_50px_-32px_rgba(15,23,42,0.22)] transition duration-300 hover:-translate-y-0.5"
                  >
                    <Mail className="h-5 w-5 text-sky-700" />
                    <p className="mt-4 text-lg font-semibold tracking-[-0.03em] text-slate-950">Email sales</p>
                    <p className="mt-2 text-sm leading-7 text-slate-600">{pricingUi.contactEmail}</p>
                  </a>
                  <div className="rounded-[26px] border border-slate-200/90 bg-white p-5 shadow-[0_20px_50px_-32px_rgba(15,23,42,0.22)]">
                    <CalendarRange className="h-5 w-5 text-sky-700" />
                    <p className="mt-4 text-lg font-semibold tracking-[-0.03em] text-slate-950">Book a demo</p>
                    <p className="mt-2 text-sm leading-7 text-slate-600">Use email to request a walkthrough and rollout call.</p>
                  </div>
                </div>
              </AdaptiveSurface>

              <AdaptiveSurface
                className="rounded-[34px] border border-slate-200/85 bg-[linear-gradient(180deg,#06111f_0%,#020617_100%)] p-6 text-white shadow-[0_36px_90px_-42px_rgba(15,23,42,0.8)] sm:p-8"
                tone="dark"
                backgroundColor="#020617"
              >
                <p className="contrast-text-accent text-xs font-semibold uppercase tracking-[0.3em]">Next steps</p>
                <div className="mt-5 space-y-4">
                  {[
                    ['1', 'Share your team size and rollout goals'],
                    ['2', 'Tell us which roles you need to onboard first'],
                    ['3', 'Decide whether you want trial setup or a paid rollout plan'],
                  ].map(([step, text]) => (
                    <div key={step} className="flex gap-3 rounded-[24px] border border-white/10 bg-white/5 px-4 py-4">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-cyan-400/15 text-sm font-semibold text-cyan-200">
                        {step}
                      </span>
                      <p className="pt-1 text-sm leading-7 contrast-text-secondary">{text}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-8 flex flex-col gap-3">
                  <a
                    href={mailtoLink}
                    onClick={() => analytics.trackEvent('book_demo_clicked', { location: 'contact-sales-primary-cta' })}
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3.5 text-sm font-semibold text-slate-950 transition duration-300 hover:-translate-y-0.5"
                  >
                    Start the conversation
                    <ArrowRight className="h-4 w-4" />
                  </a>
                  <Link
                    to="/start-trial"
                    onClick={() => analytics.trackEvent('start_trial_clicked', { location: 'contact-sales-secondary-cta' })}
                    className="inline-flex items-center justify-center rounded-full border border-white/20 bg-white/10 px-5 py-3.5 text-sm font-semibold text-white transition duration-300 hover:-translate-y-0.5 hover:bg-white/15"
                  >
                    Prefer to start with a free trial?
                  </Link>
                </div>

                <div className="mt-8 rounded-[24px] border border-white/10 bg-white/5 px-4 py-4 text-sm leading-7 contrast-text-secondary">
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4" />
                    <span>Sales coordination runs through email in this build so contact details stay editable and deployment-safe.</span>
                  </div>
                </div>
              </AdaptiveSurface>
            </div>
          </div>
        </section>
      </PublicPageTransition>

      <Footer />
      <LandingPageChatBubble />
    </div>
  );
}
