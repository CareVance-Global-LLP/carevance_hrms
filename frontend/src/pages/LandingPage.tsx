import { lazy, Suspense } from 'react';
import { MotionConfig } from 'framer-motion';
import Navbar from '@/components/landing/Navbar';
import Hero from '@/components/landing/Hero';
import DayOne from '@/components/landing/DayOne';
import ProblemCost from '@/components/landing/ProblemCost';
import ProductTour from '@/components/landing/ProductTour';
import Workflow from '@/components/landing/Workflow';
import RoleTabs from '@/components/landing/RoleTabs';
import Security from '@/components/landing/Security';
import HonestProof from '@/components/landing/HonestProof';
import PricingBanner from '@/components/landing/PricingBanner';
import FAQSection from '@/components/landing/FAQSection';
import CTA from '@/components/landing/CTA';
import Footer from '@/components/landing/Footer';
import LandingPageChatBubble from '@/components/LandingPageChatBubble';
import ScrollProgress from '@/components/landing/ScrollProgress';
import MagneticCursor from '@/components/landing/MagneticCursor';
import { landingFaqs, faqPageSchema } from '@/components/landing/landingFaqs';

import { productLabel, siteUrl } from '@/config/brand';
/*
 * The three heaviest sections are below the fold and are code-split.
 *
 * SplitFlow and ComplianceBytes each dynamically import anime.js on top of
 * their own weight, and ProductTour pulls in Lenis; none of that belongs in the
 * bundle a reader downloads before they have seen the hero. PrivacyDemo is
 * lazy for a different reason — it renders a full-size screenshot that would
 * otherwise compete with the hero for bandwidth.
 */
const SplitFlow = lazy(() => import('@/components/landing/SplitFlow'));
const ComplianceBytes = lazy(() => import('@/components/landing/ComplianceBytes'));
const PrivacyDemo = lazy(() => import('@/components/landing/PrivacyDemo'));

/**
 * Placeholder for a code-split section.
 *
 * It RESERVES HEIGHT rather than collapsing to nothing. A Suspense fallback of
 * zero height means every section below jumps up while the chunk loads and
 * back down when it arrives, which is cumulative layout shift measured
 * directly — and it happens on exactly the slow connections where CLS is
 * already worst. The height is approximate; being roughly right is worth far
 * more than being exactly nothing.
 */
function SectionFallback() {
  return (
    <div className="px-4 py-20 sm:px-6 lg:px-8" aria-hidden="true">
      <div className="mx-auto max-w-7xl">
        <div className="h-5 w-28 animate-pulse rounded-full bg-slate-200" />
        <div className="mt-4 h-9 w-2/3 max-w-xl animate-pulse rounded bg-slate-200" />
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <div className="h-64 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-64 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      </div>
    </div>
  );
}

const schemaData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareApplication',
      name: productLabel,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Windows, Web',
      description: 'All-in-one workforce management platform for time tracking, employee monitoring, attendance, payroll, and HR operations.',
      url: siteUrl,
      /*
       * The offer is the REAL entry price, in the only currency this product
       * sells in. It previously advertised "0 USD — free for up to 5 users",
       * which was wrong twice over: there is no free tier (five seats is the
       * 14-day TRIAL), and this product does not sell in dollars. Structured
       * data is what Google shows in the result, so a wrong price here is a
       * wrong price in public.
       *
       * ₹399/user/month is BASIC_TRACKING in src/constants/pricing.ts, the same
       * table PricingSection renders. Keep them together.
       */
      offers: {
        '@type': 'Offer',
        price: '399',
        priceCurrency: 'INR',
        description: 'Per user, per month, billed monthly. Minimum 10 seats. 14-day free trial.',
      },
      /*
       * THE aggregateRating BLOCK IS DELETED, NOT MOVED.
       *
       * It declared 4.8 from 150 ratings. No such ratings exist. Fabricated
       * review markup is a direct violation of Google's structured-data
       * policies and is grounds for a manual action against the whole domain —
       * and separately, anyone who opens the page source sees a company
       * inventing reviews about itself.
       *
       * DO NOT RE-ADD THIS until real ratings exist on a platform that issues
       * them, and then only with the count that platform actually reports.
       */
    },
    {
      '@type': 'Organization',
      name: productLabel,
      url: 'https://carevance.com',
      logo: siteUrl ? `${siteUrl}/logo.png` : undefined,
      sameAs: [],
    },
    {
      '@type': 'WebSite',
      name: productLabel,
      url: 'https://carevance.com',
    },
  ],
};

export default function LandingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schemaData) }}
      />
      {/*
        FAQPage, built from the SAME array the accordion below renders. Emitting
        a hand-maintained copy is how structured data ends up describing answers
        the page no longer gives — which is a policy violation, not just drift.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqPageSchema(landingFaqs)) }}
      />
      {/*
        THE BASELINE REDUCED-MOTION GUARANTEE FOR THIS WHOLE PAGE.

        `reducedMotion="user"` tells framer-motion to switch TRANSFORM
        animations off for anyone whose OS asks for reduced motion, while
        leaving opacity and colour alone — fades are not a vestibular trigger,
        movement is. One provider covers every `motion` element below it,
        including the components nobody has audited yet and any section added
        later, which is the property a per-component audit can never have: it
        cannot be forgotten.

        WHAT IT DOES NOT COVER, and why several components still check the hook
        themselves: this intercepts *animations*, not motion values bound
        through `style`. A `useScroll` → `useTransform` value applied as
        `style={{ y }}` is a live binding, not an animation, so scroll-scrubbed
        effects (the tour rail, the privacy blur, the split panels, the parallax
        in Security/Workflow/SectionNumber) and pointer springs
        (MagneticButton, the hero tilt) each opt out explicitly.

        Scoped to the landing page rather than the app root on purpose — the
        authenticated app has its own motion vocabulary, and changing it is a
        separate decision with its own testing.
      */}
      <MotionConfig reducedMotion="user">
      <div className="text-slate-950">
        <ScrollProgress />
        <MagneticCursor />
        <Navbar />
        <main>
          {/*
            THE ORDER IS THE ARGUMENT, and it is not arbitrary.
            ─────────────────────────────────────────────────────────────
            It runs proof → pain → tour → compliance → roles → price →
            objections → ask. The old order (hero → demo → features →
            workflow → benefits → screenshots) opened with capability and
            never named the reader's problem, which is why a visitor who
            did not already know they wanted this bounced at the fold.

            Sections that used to sit here and no longer do — DemoSection,
            Features, Benefits, Screenshots — are superseded rather than
            deleted: the product tour shows the same screenshots in a
            sequence that means something, RoleTabs says what each buyer
            gets, and Security carries what Benefits was asserting. The
            files remain for /pricing and other routes.
          */}
          <Hero />
          <DayOne />
          <ProblemCost />
          <ProductTour />

          <Suspense fallback={<SectionFallback />}>
            <SplitFlow />
          </Suspense>
          <Suspense fallback={<SectionFallback />}>
            <ComplianceBytes />
          </Suspense>

          <Workflow />

          <Suspense fallback={<SectionFallback />}>
            <PrivacyDemo />
          </Suspense>

          <RoleTabs />
          <Security />
          <HonestProof />
          <PricingBanner />
          <div className="h-px bg-slate-200" />
          <FAQSection
            items={landingFaqs}
            eyebrow="Questions"
            title="Eight questions worth asking us"
            description="Including the ones where the answer is no."
          />
          <CTA />
        </main>
        <Footer />
        <LandingPageChatBubble />
      </div>
      </MotionConfig>
    </>
  );
}
