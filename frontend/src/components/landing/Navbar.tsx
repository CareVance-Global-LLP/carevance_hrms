import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Download, Menu, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import BrandLogo from '@/components/branding/BrandLogo';
import { desktopDownloadUrl } from '@/lib/runtimeConfig';
import { analytics } from '@/lib/analytics';

const navItems = [
  { label: 'Product', href: '#product' },
  { label: 'Features', href: '#features' },
  { label: 'Pricing', href: '/pricing' },
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
      if (isOpen) return; // never auto-hide while menu is open
      if (currentScrollY < 24) {
        setIsVisible(true);
      } else if (scrollingUp) {
        setIsVisible(true);
      } else if (scrollDelta > 3) {
        setIsVisible(false);
      }
      lastScrollY = currentScrollY;
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [isOpen]);

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
      <div
        className={`mx-auto max-w-7xl rounded-lg border transition-all duration-300 ${
          isScrolled
            ? 'border-slate-200 bg-white shadow-md'
            : 'border-slate-200 bg-white shadow-sm'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 sm:px-5 sm:py-3.5 lg:px-6">
          <Link to="/" onClick={handleBrandClick} className="flex min-w-0 items-center">
            <BrandLogo variant="full" size="sm" className="max-w-[13rem] sm:max-w-[15rem] lg:max-w-[18rem]" />
          </Link>

          {!isDesktopAuthMode && (
            <nav className="hidden items-center gap-6 lg:flex">
              {navItems.map((item) => {
                const isAnchor = item.href.startsWith('#');
                return isAnchor ? (
                  <a
                    key={item.label}
                    href={location.pathname === '/' ? item.href : `/${item.href}`}
                    className="text-sm font-semibold text-slate-600 transition hover:text-slate-900"
                  >
                    {item.label}
                  </a>
                ) : (
                  <Link
                    key={item.label}
                    to={item.href}
                    className="text-sm font-semibold text-slate-600 transition hover:text-slate-900"
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          )}

          <div className="hidden items-center gap-2 lg:flex">
            {desktopDownloadUrl && !isDesktopAuthMode && (
              <a
                href={desktopDownloadUrl}
                target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </a>
            )}
            <Link to="/login" className="rounded-lg px-3.5 py-2 text-sm font-semibold text-slate-600 transition hover:text-slate-900">
              Login
            </Link>
            {!isDesktopAuthMode && (
              <Link
                to="/contact-sales"
                onClick={() => analytics.trackEvent('book_demo_clicked', { location: 'navbar' })}
                className="rounded-lg px-3.5 py-2 text-sm font-semibold text-slate-600 transition hover:text-slate-900"
              >
                Book Demo
              </Link>
            )}
            <Link
              to="/start-trial"
              onClick={() => analytics.trackEvent('start_trial_clicked', { location: 'navbar' })}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 hover:shadow-md"
            >
              Start Free Trial
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-3 text-slate-700 shadow-sm lg:hidden"
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
              className="overflow-hidden border-t border-slate-200 lg:hidden"
            >
              <div className="space-y-1 px-5 py-4">
                {desktopDownloadUrl && !isDesktopAuthMode && (
                  <a
                    href={desktopDownloadUrl}
                    target="_blank" rel="noreferrer"
                    className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3.5 text-sm font-medium text-slate-700 shadow-sm"
                  >
                    <Download className="h-4 w-4" />
                    Download Desktop App
                  </a>
                )}
                {!isDesktopAuthMode && navItems.map((item) => {
                  const isAnchor = item.href.startsWith('#');
                  return isAnchor ? (
                    <a
                      key={item.label}
                      href={location.pathname === '/' ? item.href : `/${item.href}`}
                      onClick={() => setIsOpen(false)}
                      className="block rounded-lg px-3 py-3.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                    >
                      {item.label}
                    </a>
                  ) : (
                    <Link
                      key={item.label}
                      to={item.href}
                      onClick={() => setIsOpen(false)}
                      className="block rounded-lg px-3 py-3.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                    >
                      {item.label}
                    </Link>
                  );
                })}
                {!isDesktopAuthMode && (
                  <Link
                    to="/contact-sales"
                    onClick={() => { analytics.trackEvent('book_demo_clicked', { location: 'navbar-mobile' }); setIsOpen(false); }}
                    className="block rounded-lg border border-slate-200 px-4 py-3.5 text-center text-sm font-semibold text-slate-700"
                  >
                    Book Demo
                  </Link>
                )}
                <Link
                  to="/login"
                  onClick={() => setIsOpen(false)}
                  className="block rounded-lg border border-slate-200 px-4 py-3.5 text-center text-sm font-semibold text-slate-700"
                >
                  Login
                </Link>
                <Link
                  to="/start-trial"
                  onClick={() => { analytics.trackEvent('start_trial_clicked', { location: 'navbar-mobile' }); setIsOpen(false); }}
                  className="block rounded-lg bg-blue-600 px-4 py-3.5 text-center text-sm font-semibold text-white shadow-sm"
                >
                  Start Free Trial
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}
