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

export default function LandingPage() {
  return (
    <div className="text-slate-950">
      <Navbar />
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
      <Footer />
    </div>
  );
}
