import type { Metadata, Viewport } from 'next';
import './globals.css';
import { manrope, spaceGrotesk } from './fonts';
import { SITE } from '@/lib/site';
import { organizationSchema, softwareApplicationSchema } from '@/lib/schema';
import { themeScript } from '@/components/chrome/theme';
import { Navbar } from '@/components/chrome/Navbar';
import { Footer } from '@/components/chrome/Footer';
import { Cursor } from '@/components/motion/Cursor';

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name} — ${SITE.tagline}`,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: SITE.name,
    locale: SITE.locale,
    url: SITE.url,
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  /*
   * Both theme colours are declared so the browser chrome matches the page in
   * either mode. These are the resolved --app-bg values from the product's
   * theme.css; they are literal here because <meta> cannot read a CSS variable.
   */
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F5F7F8' },
    { media: '(prefers-color-scheme: dark)', color: '#0E141A' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en-IN"
      /*
       * The inline script below writes data-theme before paint, which React
       * then sees as a server/client mismatch on <html>. It is the intended
       * behaviour, not a bug to fix by removing the script — suppress the
       * warning for this element only.
       */
      suppressHydrationWarning
      className={`${manrope.variable} ${spaceGrotesk.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/*
          Organization and SoftwareApplication describe the company and the
          product for search and for answer engines. Page-level schema (FAQPage,
          Product+Offer, BreadcrumbList) is emitted by the pages that own it.
        */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema()) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationSchema()) }}
        />
      </head>
      <body className="font-sans antialiased">
        <Cursor />
        <Navbar />
        <main id="main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
