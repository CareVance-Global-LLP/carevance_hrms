import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Download, Menu, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import BrandLogo from '@/components/branding/BrandLogo';
import ThemeToggle from '@/components/ui/ThemeToggle';
import { desktopDownloadUrl } from '@/lib/runtimeConfig';
import { analytics } from '@/lib/analytics';

const navItems = [
  { label: 'Product', href: '#product' },
  { label: 'Features', href: '#features' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Workflow', href: '#workflow' },
  { label: 'FAQ', href: '#faq' },
];

function smoothScrollToHash(href: string) {
  const id = href.replace('#', '');
  const el = document.getElementById(id);
  if (!el) return;
  const navHeight = 80;
  const y = el.getBoundingClientRect().top + window.scrollY - navHeight;
  window.scrollTo({ top: y, behavior: 'smooth' });
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const location = useLocation();
  const isAnchor = href.startsWith('#');
  const path = location.pathname === '/' ? href : `/${href}`;

  const className = 'group relative px-1 py-1 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900';

  return isAnchor ? (
    <a
      href={path}
      onClick={(e) => {
        e.preventDefault();
        smoothScrollToHash(href);
      }}
      className={className}
    >
      {children}
      <span className="absolute bottom-0 left-0 h-[2px] w-full origin-left scale-x-0 bg-blue-600 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-x-100" />
    </a>
  ) : (
    <Link to={href} className={className}>
      {children}
      <span className="absolute bottom-0 left-0 h-[2px] w-full origin-left scale-x-0 bg-blue-600 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-x-100" />
    </Link>
  );
}

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
      if (isOpen) return;
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
      {/*
        Background and shadow both resolve through the token layer. They used to
        be inline styles (`rgba(255,255,255,…)` plus a slate-tinted shadow), and
        an inline style is the one thing theme.css's `bg-white` remap cannot
        reach — so the pill stayed white in dark mode while its `text-slate-600`
        labels flipped light, leaving light text on a light bar.
      */}
      <div
        data-testid="landing-nav-panel"
        className={`mx-auto max-w-7xl rounded-lg border border-slate-200/80 backdrop-blur-xl transition-all duration-500 ${
          isScrolled
            ? 'bg-surface-card/95 shadow-[var(--glass-shadow-lifted)]'
            : 'bg-surface-card/80 shadow-[var(--glass-shadow)]'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 sm:px-5 sm:py-3.5 lg:px-6">
          <Link to="/" onClick={handleBrandClick} className="flex min-w-0 items-center">
            <BrandLogo variant="full" size="sm" className="max-w-[13rem] sm:max-w-[15rem] lg:max-w-[18rem]" />
          </Link>

          {!isDesktopAuthMode && (
            <nav className="hidden items-center gap-7 lg:flex">
              {navItems.map((item) => (
                <NavLink key={item.label} href={item.href}>
                  {item.label}
                </NavLink>
              ))}
            </nav>
          )}

          <div className="hidden items-center gap-2 lg:flex">
            <ThemeToggle />
            {desktopDownloadUrl && !isDesktopAuthMode && (
              <a
                href={desktopDownloadUrl}
                target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 hover:shadow-md"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </a>
            )}
            <Link to="/login" className="rounded-lg px-3.5 py-2 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900">
              Login
            </Link>
            {!isDesktopAuthMode && (
              <Link
                to="/contact-sales"
                onClick={() => analytics.trackEvent('book_demo_clicked', { location: 'navbar' })}
                className="rounded-lg px-3.5 py-2 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900"
              >
                Book Demo
              </Link>
            )}
            <Link
              to="/start-trial"
              onClick={() => analytics.trackEvent('start_trial_clicked', { location: 'navbar' })}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-blue-700 hover:shadow-md"
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
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden border-t border-slate-200 lg:hidden"
            >
              <motion.div
                className="space-y-1 px-5 py-4"
                initial="hidden"
                animate="visible"
                variants={{
                  hidden: {},
                  visible: { transition: { staggerChildren: 0.04, delayChildren: 0.1 } },
                }}
              >
                <motion.div
                  variants={{ hidden: { opacity: 0, x: -16 }, visible: { opacity: 1, x: 0 } }}
                  className="mb-2 flex items-center justify-between rounded-lg border border-slate-200 px-4 py-2.5"
                >
                  <span className="text-sm font-semibold text-slate-700">Appearance</span>
                  <ThemeToggle />
                </motion.div>
                {desktopDownloadUrl && !isDesktopAuthMode && (
                  <motion.a
                    href={desktopDownloadUrl}
                    target="_blank" rel="noreferrer"
                    variants={{ hidden: { opacity: 0, x: -16 }, visible: { opacity: 1, x: 0 } }}
                    className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3.5 text-sm font-medium text-slate-700 shadow-sm"
                  >
                    <Download className="h-4 w-4" />
                    Download Desktop App
                  </motion.a>
                )}
                {!isDesktopAuthMode && navItems.map((item) => {
                  const isAnchor = item.href.startsWith('#');
                  return isAnchor ? (
                    <motion.a
                      key={item.label}
                      href={location.pathname === '/' ? item.href : `/${item.href}`}
                      onClick={(e) => {
                        e.preventDefault();
                        setIsOpen(false);
                        smoothScrollToHash(item.href);
                      }}
                      variants={{ hidden: { opacity: 0, x: -16 }, visible: { opacity: 1, x: 0 } }}
                      className="block rounded-lg px-3 py-3.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                    >
                      {item.label}
                    </motion.a>
                  ) : (
                    <motion.div
                      key={item.label}
                      variants={{ hidden: { opacity: 0, x: -16 }, visible: { opacity: 1, x: 0 } }}
                    >
                      <Link
                        to={item.href}
                        onClick={() => setIsOpen(false)}
                        className="block rounded-lg px-3 py-3.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                      >
                        {item.label}
                      </Link>
                    </motion.div>
                  );
                })}
                {!isDesktopAuthMode && (
                  <motion.div variants={{ hidden: { opacity: 0, x: -16 }, visible: { opacity: 1, x: 0 } }}>
                    <Link
                      to="/contact-sales"
                      onClick={() => { analytics.trackEvent('book_demo_clicked', { location: 'navbar-mobile' }); setIsOpen(false); }}
                      className="block rounded-lg border border-slate-200 px-4 py-3.5 text-center text-sm font-semibold text-slate-700"
                    >
                      Book Demo
                    </Link>
                  </motion.div>
                )}
                <motion.div variants={{ hidden: { opacity: 0, x: -16 }, visible: { opacity: 1, x: 0 } }}>
                  <Link
                    to="/login"
                    onClick={() => setIsOpen(false)}
                    className="block rounded-lg border border-slate-200 px-4 py-3.5 text-center text-sm font-semibold text-slate-700"
                  >
                    Login
                  </Link>
                </motion.div>
                <motion.div variants={{ hidden: { opacity: 0, x: -16 }, visible: { opacity: 1, x: 0 } }}>
                  <Link
                    to="/start-trial"
                    onClick={() => { analytics.trackEvent('start_trial_clicked', { location: 'navbar-mobile' }); setIsOpen(false); }}
                    className="block rounded-lg bg-blue-600 px-4 py-3.5 text-center text-sm font-semibold text-white shadow-sm"
                  >
                    Start Free Trial
                  </Link>
                </motion.div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}
