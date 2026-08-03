import { lazy, Suspense } from 'react';
import Navbar from '@/components/landing/Navbar';
import Hero from '@/components/landing/Hero';
import DemoSection from '@/components/landing/DemoSection';
import Features from '@/components/landing/Features';
import Workflow from '@/components/landing/Workflow';
import Benefits from '@/components/landing/Benefits';
import Security from '@/components/landing/Security';
import FAQSection from '@/components/landing/FAQSection';
import CTA from '@/components/landing/CTA';
import Footer from '@/components/landing/Footer';
import LandingPageChatBubble from '@/components/LandingPageChatBubble';
import ScrollProgress from '@/components/landing/ScrollProgress';
import MagneticCursor from '@/components/landing/MagneticCursor';

const Screenshots = lazy(() => import('@/components/landing/Screenshots'));

function ScreenshotsFallback() {
  return (
    <div className="bg-white px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 text-center">
          <div className="h-5 w-24 animate-pulse rounded-full bg-slate-200" />
          <div className="h-8 w-72 animate-pulse rounded bg-slate-200 sm:h-10" />
          <div className="h-5 w-56 animate-pulse rounded bg-slate-200" />
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-56 animate-pulse rounded-lg bg-slate-100" />
          ))}
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
      name: 'Carevance',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Windows, Web',
      description: 'All-in-one workforce management platform for time tracking, employee monitoring, attendance, payroll, and HR operations.',
      url: 'https://carevance.com',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
        description: 'Free for up to 5 users',
      },
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: '4.8',
        ratingCount: '150',
      },
    },
    {
      '@type': 'Organization',
      name: 'Carevance',
      url: 'https://carevance.com',
      logo: 'https://carevance.com/logo.png',
      sameAs: [],
    },
    {
      '@type': 'WebSite',
      name: 'Carevance',
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
      <div className="text-slate-950">
        <ScrollProgress />
        <MagneticCursor />
        <Navbar />
        <main>
          <Hero />
          <DemoSection />
          <Features />
          <Workflow />
          <Benefits />
          <Suspense fallback={<ScreenshotsFallback />}>
            <Screenshots />
          </Suspense>
          <Security />
          <div className="h-px bg-slate-200" />
          <FAQSection />
          <CTA />
        </main>
        <Footer />
        <LandingPageChatBubble />
      </div>
    </>
  );
}
