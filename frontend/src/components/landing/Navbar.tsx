import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Download, Menu, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import AdaptiveSurface from '@/components/ui/AdaptiveSurface';
import BrandLogo from '@/components/branding/BrandLogo';
import { desktopDownloadUrl } from '@/lib/runtimeConfig';
import { analytics } from '@/lib/analytics';

const navItems = [
  { label: 'Product', href: '#product' },
  { label: 'Features', href: '#features' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Workflow', href: '#workflow' },
  { label: 'FAQ', href: '#faq' },
];

type NavbarMode = 'marketing' | 'desktop-auth';

interface NavbarProps {
  mode?: NavbarMode;
}

export default function Navbar({ mode = 'marketing' }: NavbarProps) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const location = useLocation();
  const isDesktopAuthMode = mode === 'desktop-auth';

  useEffect(() => {
    let lastScrollY = window.scrollY;

    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const scrollDelta = currentScrollY - lastScrollY;
      const scrollingUp = scrollDelta < 0;

      setIsScrolled(currentScrollY > 12);

      if (currentScrollY < 24) {
        setIsVisible(true);
      } else if (scrollingUp) {
        setIsVisible(true);
      } else if (scrollDelta > 3) {
        setIsVisible(false);
        setIsOpen(false);
      }

      lastScrollY = currentScrollY;
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleBrandClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    setIsOpen(false);

    if (location.pathname === '/') {
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <header
      className={`sticky top-0 z-50 px-4 pt-4 transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform sm:px-6 lg:px-8 ${
        isVisible || isOpen ? 'translate-y-0' : '-translate-y-[115%]'
      }`}
    >
      <AdaptiveSurface
        className={`mx-auto max-w-7xl rounded-[24px] border transition-all duration-500 ${
          isScrolled
            ? 'border-slate-200/95 bg-white/98 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.2)] backdrop-blur-2xl'
            : 'border-slate-200/90 bg-white/96 shadow-[0_12px_40px_-30px_rgba(14,165,233,0.18)] backdrop-blur-xl'
        }`}
        tone="light"
        backgroundColor={isScrolled ? 'rgba(255,255,255,0.98)' : 'rgba(255,255,255,0.96)'}
      >
        <div className="flex items-center justify-between px-4 py-3 sm:px-5 sm:py-4 lg:px-7">
          <Link
            to="/"
            onClick={handleBrandClick}
            className="flex min-w-0 items-center"
          >
            <BrandLogo
              variant="full"
              size="sm"
              className="max-w-[13rem] sm:max-w-[15rem] lg:max-w-[18rem]"
            />
          </Link>

          {!isDesktopAuthMode ? (
            <nav className="hidden items-center gap-8 lg:flex">
              {navItems.map((item) => (
                <a
                  key={item.label}
                  href={location.pathname === '/' ? item.href : `/${item.href}`}
                  className="rounded-full px-3.5 py-2 text-sm font-semibold text-slate-900 transition duration-300 hover:-translate-y-0.5 hover:text-sky-700"
                >
                  {item.label}
                </a>
              ))}
            </nav>
          ) : (
            <div className="hidden flex-1 lg:block" />
          )}

          <div className="hidden items-center gap-3 lg:flex">
            {desktopDownloadUrl && !isDesktopAuthMode ? (
              <a
                href={desktopDownloadUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-slate-300/90 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition duration-300 hover:-translate-y-0.5 hover:border-slate-950 hover:text-slate-950"
              >
                <Download className="h-4 w-4" />
                Download
              </a>
            ) : null}
            <Link
              to="/login"
              className="rounded-full px-4 py-2 text-sm font-semibold text-slate-900 transition duration-300 hover:-translate-y-0.5 hover:text-sky-700"
            >
              Login
            </Link>
            {!isDesktopAuthMode ? (
              <Link
                to="/contact-sales"
                onClick={() => analytics.trackEvent('book_demo_clicked', { location: 'navbar' })}
                className="rounded-full px-4 py-2 text-sm font-semibold text-slate-900 transition duration-300 hover:-translate-y-0.5 hover:text-sky-700"
              >
                Book Demo
              </Link>
            ) : null}
            <Link
              to="/start-trial"
              onClick={() => analytics.trackEvent('start_trial_clicked', { location: 'navbar' })}
              className="rounded-full bg-[linear-gradient(135deg,#020617_0%,#0f172a_30%,#0284c7_100%)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_18px_40px_-18px_rgba(14,165,233,0.7)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_46px_-20px_rgba(14,165,233,0.8)]"
            >
              Start Free Trial
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            className="inline-flex rounded-full border border-slate-200/90 bg-white/95 p-2 text-slate-800 shadow-sm lg:hidden"
            aria-label="Toggle navigation"
          >
            {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden border-t border-slate-200/80 lg:hidden"
            >
              <div className="space-y-3 px-5 py-4">
                {desktopDownloadUrl && !isDesktopAuthMode ? (
                  <a
                    href={desktopDownloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white/90 px-4 py-3 text-sm font-medium text-slate-700"
                  >
                    <Download className="h-4 w-4" />
                    Download Desktop App
                  </a>
                ) : null}
                {!isDesktopAuthMode
                  ? navItems.map((item) =>
                      <a
                        key={item.label}
                        href={location.pathname === '/' ? item.href : `/${item.href}`}
                        onClick={() => setIsOpen(false)}
                        className="block rounded-2xl px-3 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-950/5 hover:text-sky-700"
                      >
                        {item.label}
                      </a>
                    )
                  : null}
                {!isDesktopAuthMode ? (
                  <Link
                    to="/contact-sales"
                    onClick={() => {
                      analytics.trackEvent('book_demo_clicked', { location: 'navbar-mobile' });
                      setIsOpen(false);
                    }}
                    className="block rounded-2xl border border-slate-200/90 px-4 py-3 text-center text-sm font-semibold text-slate-900"
                  >
                    Book Demo
                  </Link>
                ) : null}
                <Link
                  to="/login"
                  onClick={() => setIsOpen(false)}
                  className="block rounded-2xl border border-slate-200/90 px-4 py-3 text-center text-sm font-semibold text-slate-900"
                >
                  Login
                </Link>
                <Link
                  to="/start-trial"
                  onClick={() => {
                    analytics.trackEvent('start_trial_clicked', { location: 'navbar-mobile' });
                    setIsOpen(false);
                  }}
                  className="block rounded-2xl bg-[linear-gradient(135deg,#020617_0%,#0f172a_35%,#0284c7_100%)] px-4 py-3 text-center text-sm font-semibold text-white"
                >
                  Start Free Trial
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </AdaptiveSurface>
    </header>
  );
}
